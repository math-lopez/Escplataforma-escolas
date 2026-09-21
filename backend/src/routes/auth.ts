import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { definirCookiesSessao, limparCookiesSessao } from "../lib/sessao.js";
import type { Papel } from "../plugins/auth.js";

interface LoginBody {
  email: string;
  senha: string;
}

interface LinhaInstituicao {
  id: string;
  nome: string;
  slug: string;
  logo_url: string | null;
  cor_primaria: string | null;
}

/**
 * Subconjunto de UsuarioAutenticado que basta para montar a resposta de sessão — sem `status`,
 * que é decisão interna de autorização (autorizarPerfil), não parte do contrato público da API.
 * Definido separado (em vez de reusar UsuarioAutenticado inteiro) porque o onboarding
 * (routes/instituicoes.ts) monta esse objeto na mão logo após criar o usuário, sem nunca ter
 * passado por `autorizarPerfil` — não tem `status` disponível, nem precisa.
 */
export interface PerfilParaResposta {
  id: string;
  nome: string;
  papel: Papel;
  instituicaoId: string;
}

/**
 * Monta a resposta de perfil com os dados de branding da instituição — ponto ÚNICO usado por
 * login, `/api/auth/me` E o onboarding de instituição (routes/instituicoes.ts), para as três
 * rotas nunca divergirem no formato. Isto já rendeu um bug real duas vezes nesta fatia: primeiro
 * a regra de status (login vs /me — resolvida extraindo `autorizarPerfil` em plugins/auth.ts),
 * depois o próprio formato do perfil (login/me tinham cada um sua cópia antes desta função
 * existir). Se o onboarding tivesse ficado com sua própria construção do objeto — como estava
 * antes desta revisão —, seria a TERCEIRA cópia da mesma regra divergindo com o tempo (e
 * divergiu: onboarding não devolvia `instituicao`, deixando quem acabou de criar a conta sem
 * o próprio branding até a próxima chamada a /me).
 *
 * Recebe o CLIENT Supabase já pronto (não o accessToken) porque quem chama nem sempre tem um
 * access token utilizável no momento da chamada: login e /me usam
 * `supabaseComoUsuario(accessToken)` (sessão já existe), mas o onboarding chama isto logo após
 * criar o usuário, quando `sessao?.session` (o sign-in feito ali dentro) pode ser undefined por
 * qualquer falha transitória — ver comentário em routes/instituicoes.ts sobre por que ele passa
 * `supabaseAdmin` em vez de tentar montar um accessToken que pode não existir.
 *
 * Isso é seguro com qualquer um dos dois clients: `instituicoes_select_publico` (0008) é
 * `using (true)` — a leitura já é pública via RLS, então usar o client admin aqui não contorna
 * isolamento nenhum (não há o que isolar numa tabela de leitura pública).
 */
export async function montarRespostaPerfil(
  fastify: FastifyInstance,
  cliente: SupabaseClient,
  perfil: PerfilParaResposta,
) {
  const { data, error } = await cliente
    .from("instituicoes")
    .select("id, nome, slug, logo_url, cor_primaria")
    .eq("id", perfil.instituicaoId)
    .single();

  if (error || !data) {
    fastify.log.error(error);
  }

  const instituicao = data as unknown as LinhaInstituicao | null;

  return {
    id: perfil.id,
    nome: perfil.nome,
    papel: perfil.papel,
    instituicaoId: perfil.instituicaoId,
    instituicao: instituicao
      ? {
          id: instituicao.id,
          nome: instituicao.nome,
          slug: instituicao.slug,
          logoUrl: instituicao.logo_url,
          corPrimaria: instituicao.cor_primaria,
        }
      : null,
  };
}

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: LoginBody }>("/api/auth/login", async (request, reply) => {
    const { email, senha } = request.body ?? {};

    if (!email || !senha) {
      return reply.code(400).send({ erro: "E-mail e senha são obrigatórios" });
    }

    const { data, error } = await fastify.supabaseAuth.auth.signInWithPassword({
      email,
      password: senha,
    });

    if (error || !data.session) {
      return reply.code(401).send({ erro: "E-mail ou senha inválidos" });
    }

    // Seta o cookie ANTES de checar o perfil — espelha o que `autenticar` faz no fluxo de
    // refresh. A sessão do Supabase já é legítima neste ponto (credenciais corretas); se o
    // perfil estiver pendente/recusado, `autorizarPerfil` responde 403 SEM limpar o cookie, e
    // esta mesma sessão continua valendo (necessário: no instante em que um admin aprovar o
    // cadastro, ela passa a funcionar sem exigir login de novo). Só no caso "sem perfil" (401)
    // é que `autorizarPerfil` limpa os cookies que acabamos de setar.
    definirCookiesSessao(reply, data.session);

    // Mesma função usada pelo hook `autenticar` — garante que login e `/api/auth/me` respondem
    // exatamente igual para o mesmo usuário (mesmo formato de perfil, mesmo 401/403 com o mesmo
    // `codigo`), em vez de duas cópias da regra de status divergindo com o tempo.
    const perfil = await fastify.autorizarPerfil(reply, data.session.user.id, data.session.access_token);
    if (!perfil) return; // 401 ou 403 já respondido dentro de autorizarPerfil

    return montarRespostaPerfil(fastify, fastify.supabaseComoUsuario(data.session.access_token), perfil);
  });

  fastify.post("/api/auth/logout", async (_request, reply) => {
    limparCookiesSessao(reply);
    return { ok: true };
  });

  fastify.get("/api/auth/me", { onRequest: [fastify.autenticar] }, async (request) => {
    const usuario = request.usuario!;
    return montarRespostaPerfil(fastify, fastify.supabaseComoUsuario(request.accessToken!), usuario);
  });
}
