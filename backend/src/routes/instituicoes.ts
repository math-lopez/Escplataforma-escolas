import type { FastifyInstance } from "fastify";
import { definirCookiesSessao } from "../lib/sessao.js";

interface OnboardingBody {
  nomeInstituicao: string;
  slug: string;
  nomeAdmin: string;
  email: string;
  senha: string;
}

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export default async function instituicoesRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: OnboardingBody }>("/api/instituicoes/onboarding", async (request, reply) => {
    const { nomeInstituicao, slug, nomeAdmin, email, senha } = request.body ?? {};

    if (!nomeInstituicao || !slug || !nomeAdmin || !email || !senha) {
      return reply.code(400).send({ erro: "Campos obrigatórios ausentes" });
    }
    if (!SLUG_REGEX.test(slug)) {
      return reply.code(400).send({ erro: "Slug inválido: use apenas letras minúsculas, números e hífen" });
    }

    const { data: instituicao, error: erroInstituicao } = await fastify.supabaseAdmin
      .from("instituicoes")
      .insert({ nome: nomeInstituicao, slug })
      .select("id")
      .single();

    if (erroInstituicao || !instituicao) {
      request.log.error(erroInstituicao);
      return reply.code(409).send({ erro: "Não foi possível criar a instituição (slug já existe?)" });
    }

    const { data: usuarioAuth, error: erroAuth } = await fastify.supabaseAdmin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
    });

    if (erroAuth || !usuarioAuth.user) {
      request.log.error(erroAuth);
      await fastify.supabaseAdmin.from("instituicoes").delete().eq("id", instituicao.id);
      return reply.code(409).send({ erro: "Não foi possível criar o usuário admin" });
    }

    const { error: erroPerfil } = await fastify.supabaseAdmin.from("usuarios").insert({
      id: usuarioAuth.user.id,
      instituicao_id: instituicao.id,
      papel: "admin_instituicao",
      nome: nomeAdmin,
    });

    if (erroPerfil) {
      request.log.error(erroPerfil);
      await fastify.supabaseAdmin.auth.admin.deleteUser(usuarioAuth.user.id);
      await fastify.supabaseAdmin.from("instituicoes").delete().eq("id", instituicao.id);
      return reply.code(500).send({ erro: "Não foi possível criar o perfil do admin" });
    }

    // Já autentica o admin recém-criado: o frontend sai do cadastro direto logado.
    const { data: sessao } = await fastify.supabaseAuth.auth.signInWithPassword({
      email,
      password: senha,
    });

    if (sessao?.session) {
      definirCookiesSessao(reply, sessao.session);
    }

    return reply.code(201).send({
      id: usuarioAuth.user.id,
      nome: nomeAdmin,
      papel: "admin_instituicao",
      instituicaoId: instituicao.id,
    });
  });
}
