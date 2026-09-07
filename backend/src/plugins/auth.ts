import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { COOKIE_ACCESS, COOKIE_REFRESH, definirCookiesSessao, limparCookiesSessao } from "../lib/sessao.js";

export type Papel = "admin_instituicao" | "professor" | "aluno";

export interface UsuarioAutenticado {
  id: string;
  instituicaoId: string;
  papel: Papel;
  nome: string;
}

declare module "fastify" {
  interface FastifyRequest {
    usuario?: UsuarioAutenticado;
  }
  interface FastifyInstance {
    autenticar: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    exigirPapel: (
      ...papeis: Papel[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async function authPlugin(fastify: FastifyInstance) {
  /** Valida o access token direto com o Supabase Auth — evita ter que guardar o JWT secret. */
  async function idDoToken(token: string): Promise<string | null> {
    const { data, error } = await fastify.supabaseAuth.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  }

  /** Carrega o perfil da tabela usuarios — é ele que define instituição e papel. */
  async function carregarPerfil(usuarioId: string): Promise<UsuarioAutenticado | null> {
    const { data, error } = await fastify.supabaseAdmin
      .from("usuarios")
      .select("id, instituicao_id, papel, nome")
      .eq("id", usuarioId)
      .single();

    if (error || !data) return null;

    return {
      id: data.id,
      instituicaoId: data.instituicao_id,
      papel: data.papel,
      nome: data.nome,
    };
  }

  fastify.decorate("autenticar", async function autenticar(request: FastifyRequest, reply: FastifyReply) {
    const accessToken = request.cookies[COOKIE_ACCESS];
    let usuarioId = accessToken ? await idDoToken(accessToken) : null;

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
      usuarioId = data.session.user.id;
    }

    const perfil = await carregarPerfil(usuarioId);
    if (!perfil) {
      limparCookiesSessao(reply);
      return reply.code(401).send({ erro: "Usuário sem perfil na plataforma" });
    }

    request.usuario = perfil;
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
