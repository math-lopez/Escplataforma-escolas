import type { FastifyInstance } from "fastify";
import { definirCookiesSessao, limparCookiesSessao } from "../lib/sessao.js";

interface LoginBody {
  email: string;
  senha: string;
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

    const { data: perfil } = await fastify.supabaseAdmin
      .from("usuarios")
      .select("id, instituicao_id, papel, nome")
      .eq("id", data.session.user.id)
      .single();

    if (!perfil) {
      return reply.code(403).send({ erro: "Usuário sem perfil na plataforma" });
    }

    definirCookiesSessao(reply, data.session);

    return {
      id: perfil.id,
      nome: perfil.nome,
      papel: perfil.papel,
      instituicaoId: perfil.instituicao_id,
    };
  });

  fastify.post("/api/auth/logout", async (_request, reply) => {
    limparCookiesSessao(reply);
    return { ok: true };
  });

  fastify.get("/api/auth/me", { onRequest: [fastify.autenticar] }, async (request) => {
    const usuario = request.usuario!;
    return {
      id: usuario.id,
      nome: usuario.nome,
      papel: usuario.papel,
      instituicaoId: usuario.instituicaoId,
    };
  });
}
