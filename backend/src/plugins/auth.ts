import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { COOKIE_ACCESS, COOKIE_REFRESH, definirCookiesSessao, limparCookiesSessao } from "../lib/sessao.js";

export type Papel = "admin_instituicao" | "professor" | "aluno";
export type StatusUsuario = "ativo" | "pendente" | "recusado";

export interface UsuarioAutenticado {
  id: string;
  instituicaoId: string;
  papel: Papel;
  nome: string;
  status: StatusUsuario;
}

declare module "fastify" {
  interface FastifyRequest {
    usuario?: UsuarioAutenticado;
    /**
     * Access token válido desta requisição: o do cookie, ou o novo emitido por um refresh
     * feito durante a própria requisição (nesse caso o do cookie antigo já não vale mais).
     * Rotas de negócio usam este token para abrir `fastify.supabaseComoUsuario(token)` e
     * manter o RLS ativo.
     */
    accessToken?: string;
  }
  interface FastifyInstance {
    autenticar: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    exigirPapel: (
      ...papeis: Papel[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /**
     * Carrega o perfil de `usuarioId` e decide se a sessão pode prosseguir, respondendo
     * diretamente quando não pode: sem perfil → 401 (e limpa os cookies); status
     * pendente/recusado → 403 com `codigo` (mantém os cookies). Só devolve um valor não-nulo
     * quando o perfil está ativo — nesse caso nada foi escrito na `reply` ainda.
     *
     * Único ponto que decide essa regra. Usado por `autenticar` (toda rota protegida) e por
     * `POST /api/auth/login` (`routes/auth.ts`): sem isso, as duas cópias da mesma regra
     * divergem silenciosamente a cada mudança em uma sem a outra — foi exatamente o que
     * aconteceu aqui quando a checagem de status entrou só no `autenticar`.
     */
    autorizarPerfil: (
      reply: FastifyReply,
      usuarioId: string,
      accessToken: string,
    ) => Promise<UsuarioAutenticado | null>;
  }
}

export default fp(async function authPlugin(fastify: FastifyInstance) {
  /**
   * Valida o access token **localmente** via JWT claims (JWKS cacheado), sem ida de rede.
   *
   * **Por que getClaims em vez de getUser?**
   *
   * `getUser(token)` faz uma requisição ao servidor Supabase a cada chamada, custando 147–381ms.
   * `getClaims(token)` valida a assinatura e expiração localmente (com chaves públicas cacheadas),
   * custa 396ms apenas na primeira chamada (carregamento do JWKS), depois 0–1ms.
   *
   * Essa otimização depende do projeto usar chaves assimétricas (ES256, não HS256). Se um dia
   * o projeto voltar para segredo compartilhado legado, a biblioteca automaticamente cai de volta
   * em validação remota — não quebra, só fica lento de novo.
   *
   * **Trade-off de segurança (real e aceitável aqui):**
   *
   * `getUser` enxerga uma sessão revogada no mesmo instante (consultando o servidor).
   * `getClaims` valida só a assinatura, logo um token continua aceito até expirar, mesmo que
   * a sessão tenha sido encerrada no servidor.
   *
   * Isso é aceitável porque o perfil é **sempre** recarregado do banco a cada requisição
   * (via `autorizarPerfil`). Usuário apagado, desativado ou com status alterado é barrado no
   * mesmo instante — a janela residual de acesso com token revogado se limita ao tempo de vida
   * do access token (típico: 1h), e é mitigada pelo reload do perfil a cada requisição.
   */
  async function idDoToken(token: string): Promise<string | null> {
    const { data, error } = await fastify.supabaseAuth.auth.getClaims(token);
    if (error || !data?.claims?.sub) return null;
    return data.claims.sub;
  }

  // Carrega o perfil com o client do próprio usuário (anon key + access token), não com a
  // service role: a policy "usuarios_select_propria_linha" (migration 0009) garante que o
  // usuário sempre lê a própria linha, mesmo pendente/recusado — é isso que permite, logo
  // abaixo, diferenciar "sem perfil" (linha não existe) de "perfil existe mas não está ativo".
  async function carregarPerfil(usuarioId: string, accessToken: string): Promise<UsuarioAutenticado | null> {
    const { data, error } = await fastify
      .supabaseComoUsuario(accessToken)
      .from("usuarios")
      .select("id, instituicao_id, papel, nome, status")
      .eq("id", usuarioId)
      .single();

    if (error || !data) return null;

    return {
      id: data.id,
      instituicaoId: data.instituicao_id,
      papel: data.papel,
      nome: data.nome,
      status: data.status,
    };
  }

  // Ponto único de decisão sobre status — ver justificativa no `declare module "fastify"` acima.
  // Recebe a `reply` porque responde diretamente nos dois casos de saída (401 sem perfil, 403
  // pendente/recusado); só devolve o perfil quando pode seguir (status ativo).
  fastify.decorate(
    "autorizarPerfil",
    async function autorizarPerfil(
      reply: FastifyReply,
      usuarioId: string,
      accessToken: string,
    ): Promise<UsuarioAutenticado | null> {
      const perfil = await carregarPerfil(usuarioId, accessToken);
      if (!perfil) {
        limparCookiesSessao(reply);
        reply.code(401).send({ erro: "Usuário sem perfil na plataforma" });
        return null;
      }

      // Pendente/recusado é caso de AUTORIZAÇÃO, não de autenticação: a sessão é legítima (o
      // usuário provou quem é), só falta aprovação da instituição. Por isso 403, não 401 — e
      // por isso NÃO limpamos os cookies aqui. Um 401 (ou limpar sessão) faria um interceptor
      // de frontend tratar isso como "não autenticado"/"sessão expirada" e forçar novo login só
      // para ver de novo a mesma tela de espera. Vale tanto para quem já tinha sessão
      // (`autenticar`) quanto para quem acabou de logar (`routes/auth.ts`): a sessão de um
      // pendente PRECISA continuar valendo, porque no instante em que um admin aprovar o
      // cadastro é essa mesma sessão que passa a funcionar — exigir login de novo depois de
      // aprovado seria um passo extra sem motivo. O `codigo` deixa o frontend (Fatia 3) decidir
      // programaticamente qual tela mostrar, sem parsear a mensagem em português.
      if (perfil.status !== "ativo") {
        const codigo = perfil.status === "pendente" ? "cadastro_pendente" : "cadastro_recusado";
        const erro =
          perfil.status === "pendente"
            ? "Cadastro aguardando aprovação da instituição"
            : "Cadastro recusado pela instituição";
        reply.code(403).send({ erro, codigo, nome: perfil.nome });
        return null;
      }

      return perfil;
    },
  );

  fastify.decorate("autenticar", async function autenticar(request: FastifyRequest, reply: FastifyReply) {
    let accessToken = request.cookies[COOKIE_ACCESS];
    let usuarioId: string | null = accessToken ? await idDoToken(accessToken) : null;

    // Access token ausente ou expirado: tenta renovar a sessão com o refresh token,
    // de forma transparente para o frontend (que não sabe que tokens existem).
    if (!usuarioId) {
      const refreshToken = request.cookies[COOKIE_REFRESH];
      if (!refreshToken) {
        return reply.code(401).send({ erro: "Não autenticado" });
      }

      const { data, error } = await fastify.supabaseAuth.auth.refreshSession({
        refresh_token: refreshToken,
      });

      if (error || !data.session) {
        limparCookiesSessao(reply);
        return reply.code(401).send({ erro: "Sessão expirada" });
      }

      definirCookiesSessao(reply, data.session);
      // A partir daqui o token válido é o novo emitido pelo refresh — o do cookie antigo
      // já foi substituído e não deve mais ser usado nesta requisição.
      accessToken = data.session.access_token;
      usuarioId = data.session.user.id;
    }

    // Neste ponto accessToken sempre está definido: ou validou direto (idDoToken exigiu
    // um accessToken truthy para usuarioId sair truthy), ou foi substituído pelo refresh acima.
    const tokenValido = accessToken as string;

    const perfil = await fastify.autorizarPerfil(reply, usuarioId, tokenValido);
    if (!perfil) return; // 401 ou 403 já respondido dentro de autorizarPerfil

    request.usuario = perfil;
    request.accessToken = tokenValido;
  });

  fastify.decorate("exigirPapel", function exigirPapel(...papeis: Papel[]) {
    return async function verificarPapel(request: FastifyRequest, reply: FastifyReply) {
      await fastify.autenticar(request, reply);
      if (reply.sent) return;

      if (!request.usuario || !papeis.includes(request.usuario.papel)) {
        return reply.code(403).send({ erro: "Sem permissão para esta ação" });
      }
    };
  });
});
