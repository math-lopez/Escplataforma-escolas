import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { env } from "../env.js";
import { enviarEmailConvite } from "../services/email.js";
import { montarRespostaPerfil } from "./auth.js";
import { definirCookiesSessao } from "../lib/sessao.js";

interface CriarConviteBody {
  email?: unknown;
  papel?: unknown;
}

interface LinhaConvite {
  id: string;
  email: string;
  papel: string;
  expira_em: string;
  criado_em: string;
}

interface LinhaConviteCompleta extends LinhaConvite {
  token: string;
  aceito_em: string | null;
  instituicao_id: string;
  criado_por: string | null;
}

interface ValidarConviteBody {
  nome?: unknown;
  senha?: unknown;
}

function paraApiConvite(linha: LinhaConvite) {
  return {
    id: linha.id,
    email: linha.email,
    papel: linha.papel,
    expiraEm: linha.expira_em,
    criadoEm: linha.criado_em,
  };
}

function gerarToken(): string {
  return randomBytes(32).toString("base64url");
}

function validarEmail(email: unknown): boolean {
  return typeof email === "string" && email.trim().length > 0;
}

function validarPapel(papel: unknown): papel is "admin_instituicao" | "professor" | "aluno" {
  return papel === "admin_instituicao" || papel === "professor" || papel === "aluno";
}

export default async function convitesRoutes(fastify: FastifyInstance) {
  // ── Rotas de staff (exigem autenticação) ───────────────────────────────────

  // POST /api/convites — cria novo convite
  fastify.post<{ Body: CriarConviteBody }>(
    "/api/convites",
    { onRequest: [fastify.exigirPapel("admin_instituicao", "professor")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const corpo = request.body ?? {};

      // Valida campos
      if (!validarEmail(corpo.email)) {
        return reply
          .code(400)
          .send({ erro: "E-mail é obrigatório e não pode estar vazio" });
      }

      if (!validarPapel(corpo.papel)) {
        return reply
          .code(400)
          .send({ erro: "Papel inválido: use admin_instituicao, professor ou aluno" });
      }

      const email = (corpo.email as string).trim();
      const papel = corpo.papel as "admin_instituicao" | "professor" | "aluno";

      // ── R1: Escalonamento de privilégio ──
      // Um professor só pode convidar alunos. Apenas admin_instituicao pode convidar
      // professor ou admin_instituicao.
      if (usuario.papel === "professor") {
        if (papel !== "aluno") {
          return reply.code(403).send({
            erro: "Professores só podem convidar alunos",
          });
        }
      }

      // Verifica se já existe convite pendente para este e-mail nesta instituição
      const { data: conviteExistente, error: erroSelect } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("convites")
        .select("id")
        .eq("instituicao_id", usuario.instituicaoId)
        .eq("email", email)
        .is("aceito_em", null)
        .single();

      // "single()" retorna erro se encontrar 0 ou >1 linha. 0 é ok (não queremos duplicata).
      if (erroSelect && erroSelect.code !== "PGRST116") {
        // PGRST116 = "No rows found" — é o que queremos
        request.log.error(erroSelect);
        return reply.code(500).send({ erro: "Erro ao verificar convites existentes" });
      }

      if (conviteExistente) {
        return reply.code(409).send({
          erro: "Já existe um convite pendente para este e-mail nesta instituição",
        });
      }

      // Gera token e define expiração (7 dias)
      const token = gerarToken();
      const expiraEm = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      // Insere o convite no banco (usando supabaseComoUsuario para manter RLS)
      const { data: convidePerfil, error: erroInsert } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("convites")
        .insert({
          instituicao_id: usuario.instituicaoId,
          email,
          papel,
          token,
          expira_em: expiraEm,
          criado_por: usuario.id,
        })
        .select("id, email, papel, expira_em, criado_em")
        .single();

      if (erroInsert || !convidePerfil) {
        request.log.error(erroInsert);
        return reply.code(500).send({ erro: "Não foi possível criar o convite" });
      }

      // Busca dados da instituição para enviar no e-mail
      const { data: instituicao } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("instituicoes")
        .select("nome")
        .eq("id", usuario.instituicaoId)
        .single();

      const linkConvite = `${env.frontendUrl}/convite/${token}`;

      // Envia e-mail (falha não derruba a criação do convite)
      if (instituicao) {
        await enviarEmailConvite(fastify, {
          paraEmail: email,
          instituicaoNome: (instituicao as Record<string, unknown>).nome as string,
          linkConvite,
        });
      }

      const linha = convidePerfil as unknown as LinhaConvite;
      return reply.code(201).send({
        ...paraApiConvite(linha),
        linkConvite,
      });
    },
  );

  // GET /api/convites — lista convites pendentes da instituição
  fastify.get(
    "/api/convites",
    { onRequest: [fastify.exigirPapel("admin_instituicao", "professor")] },
    async (request, reply) => {
      const usuario = request.usuario!;

      const { data, error } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("convites")
        .select("id, email, papel, expira_em, criado_em")
        .eq("instituicao_id", usuario.instituicaoId)
        .is("aceito_em", null)
        .order("criado_em", { ascending: false });

      if (error) {
        request.log.error(error);
        return reply.code(500).send({ erro: "Não foi possível listar os convites" });
      }

      return (data as unknown as LinhaConvite[]).map(paraApiConvite);
    },
  );

  // DELETE /api/convites/:id — revoga um convite
  fastify.delete<{ Params: { id: string } }>(
    "/api/convites/:id",
    { onRequest: [fastify.exigirPapel("admin_instituicao", "professor")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { id } = request.params;

      // Primeiro verifica se o convite pertence à instituição
      const { data: convite, error: erroSelect } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("convites")
        .select("id")
        .eq("id", id)
        .eq("instituicao_id", usuario.instituicaoId)
        .single();

      if (erroSelect || !convite) {
        return reply.code(404).send({ erro: "Convite não encontrado" });
      }

      // Deleta o convite
      const { error: erroDelete } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("convites")
        .delete()
        .eq("id", id);

      if (erroDelete) {
        request.log.error(erroDelete);
        return reply.code(500).send({ erro: "Não foi possível revogar o convite" });
      }

      return reply.code(204).send();
    },
  );

  // ── Rotas públicas (SEM autenticação) ───────────────────────────────────

  // GET /api/publico/convites/:token — busca dados do convite para mostrar na tela de aceite
  fastify.get<{ Params: { token: string } }>(
    "/api/publico/convites/:token",
    async (request, reply) => {
      const { token } = request.params;

      // Busca o convite pelo token. Usa supabaseAdmin porque não há sessão de usuário.
      const { data: convite, error: erroSelect } = await fastify.supabaseAdmin
        .from("convites")
        .select(
          "id, email, papel, expira_em, aceito_em, instituicao_id",
        )
        .eq("token", token)
        .single();

      if (erroSelect || !convite) {
        // R4: Mensagem genérica para não revelar qual das três verificações falhou
        return reply.code(404).send({ erro: "Convite inválido ou expirado" });
      }

      const linhaConvite = convite as unknown as LinhaConviteCompleta;

      // R4: Aplica as três verificações obrigatórias
      if (linhaConvite.aceito_em !== null) {
        return reply.code(404).send({ erro: "Convite inválido ou expirado" });
      }

      if (new Date(linhaConvite.expira_em) < new Date()) {
        return reply.code(404).send({ erro: "Convite inválido ou expirado" });
      }

      // Busca dados da instituição (leitura pública via RLS)
      const { data: instituicao } = await fastify.supabaseAdmin
        .from("instituicoes")
        .select("nome, slug, logo_url, cor_primaria")
        .eq("id", linhaConvite.instituicao_id)
        .single();

      const inst = instituicao as Record<string, unknown> | null;

      return reply.code(200).send({
        email: linhaConvite.email,
        papel: linhaConvite.papel,
        instituicao: inst
          ? {
              nome: inst.nome,
              slug: inst.slug,
              logoUrl: inst.logo_url,
              corPrimaria: inst.cor_primaria,
            }
          : null,
      });
    },
  );

  // POST /api/publico/convites/:token/aceitar — aceita o convite e cria o usuário
  fastify.post<{ Params: { token: string }; Body: ValidarConviteBody }>(
    "/api/publico/convites/:token/aceitar",
    async (request, reply) => {
      const { token } = request.params;
      const corpo = request.body ?? {};

      // Valida campos da requisição
      if (!corpo.nome || typeof corpo.nome !== "string" || corpo.nome.trim().length === 0) {
        return reply.code(400).send({ erro: "Nome é obrigatório e não pode estar vazio" });
      }

      if (!corpo.senha || typeof corpo.senha !== "string" || corpo.senha.length < 8) {
        return reply
          .code(400)
          .send({ erro: "Senha é obrigatória e deve ter no mínimo 8 caracteres" });
      }

      const nome = (corpo.nome as string).trim();
      const senha = corpo.senha as string;

      // Busca o convite novamente (R4: valida de novo antes de qualquer operação)
      const { data: convite, error: erroSelect } = await fastify.supabaseAdmin
        .from("convites")
        .select("id, email, papel, expira_em, aceito_em, instituicao_id")
        .eq("token", token)
        .single();

      if (erroSelect || !convite) {
        return reply.code(404).send({ erro: "Convite inválido ou expirado" });
      }

      const linhaConvite = convite as unknown as LinhaConviteCompleta;

      // R4: Valida as três condições
      if (linhaConvite.aceito_em !== null) {
        return reply.code(404).send({ erro: "Convite inválido ou expirado" });
      }

      if (new Date(linhaConvite.expira_em) < new Date()) {
        return reply.code(404).send({ erro: "Convite inválido ou expirado" });
      }

      // Passo 1: Cria usuário no Supabase Auth (usa supabaseAdmin)
      const { data: usuarioAuth, error: erroAuth } = await fastify.supabaseAdmin.auth.admin.createUser({
        email: linhaConvite.email, // R2: E-mail vem do convite, NUNCA do corpo
        password: senha,
        email_confirm: true,
      });

      if (erroAuth || !usuarioAuth.user) {
        request.log.error(erroAuth);
        return reply.code(409).send({ erro: "Não foi possível criar a conta de usuário" });
      }

      // Passo 2: Insere em `usuarios` com papel e instituição do convite (R2)
      const { data: usuarioPerfil, error: erroPerfil } = await fastify.supabaseAdmin
        .from("usuarios")
        .insert({
          id: usuarioAuth.user.id,
          instituicao_id: linhaConvite.instituicao_id, // R2: vem do convite
          papel: linhaConvite.papel, // R2: vem do convite
          nome,
          status: "ativo",
        })
        .select("id, nome, papel, status, instituicao_id")
        .single();

      if (erroPerfil) {
        request.log.error(erroPerfil);
        // Rollback: deleta o usuário do Auth que acabou de ser criado
        await fastify.supabaseAdmin.auth.admin.deleteUser(usuarioAuth.user.id);
        return reply.code(500).send({ erro: "Não foi possível criar o perfil do usuário" });
      }

      // Passo 3: Marca o convite como aceito
      const { error: erroUpdate } = await fastify.supabaseAdmin
        .from("convites")
        .update({ aceito_em: new Date().toISOString() })
        .eq("id", linhaConvite.id);

      if (erroUpdate) {
        // Não desfaz o usuário — ele já existe e é útil. Apenas registra no log.
        request.log.error(
          `Erro ao marcar convite como aceito (usuário ${usuarioAuth.user.id} foi criado): ${erroUpdate}`,
        );
      }

      // Passo 4: Faz login e seta cookies de sessão
      const { data: sessao } = await fastify.supabaseAuth.auth.signInWithPassword({
        email: linhaConvite.email,
        password: senha,
      });

      if (sessao?.session) {
        definirCookiesSessao(reply, sessao.session);
      }

      // Monta resposta de perfil (mesmo formato de login e /me)
      const resposta = await montarRespostaPerfil(fastify, fastify.supabaseAdmin, {
        id: usuarioAuth.user.id,
        nome,
        papel: linhaConvite.papel as "admin_instituicao" | "professor" | "aluno",
        instituicaoId: linhaConvite.instituicao_id,
      });

      return reply.code(201).send(resposta);
    },
  );
}
