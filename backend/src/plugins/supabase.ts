import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { env } from "../env.js";

declare module "fastify" {
  interface FastifyInstance {
    /**
     * Service role: ignora RLS. Uso restrito a onboarding, criação de usuário e outras
     * operações administrativas que legitimamente cruzam instituições — nunca em rota de
     * negócio comum. Um guard de teste (backend/tests/) falha o build se alguma rota fora
     * da allowlist usar este client.
     */
    supabaseAdmin: SupabaseClient;
    /** Anon key, sem sessão. Usado só para as operações de auth (login, refresh de sessão). */
    supabaseAuth: SupabaseClient;
    /**
     * Anon key + access token do usuário autenticado: o RLS volta a valer. É o client que
     * toda rota de negócio deve usar (`request.accessToken`, populado por `fastify.autenticar`).
     * O filtro manual por instituicao_id continua existindo, mas passa a ser a segunda linha
     * de defesa, não a única — se ele for esquecido em algum ponto, o RLS ainda barra o
     * acesso entre instituições.
     */
    supabaseComoUsuario: (accessToken: string) => SupabaseClient;
  }
}

export default fp(async function supabasePlugin(fastify: FastifyInstance) {
  const semSessaoLocal = {
    auth: { autoRefreshToken: false, persistSession: false },
  };

  fastify.decorate(
    "supabaseAdmin",
    createClient(env.supabaseUrl, env.supabaseServiceRoleKey, semSessaoLocal),
  );

  fastify.decorate(
    "supabaseAuth",
    createClient(env.supabaseUrl, env.supabaseAnonKey, semSessaoLocal),
  );

  fastify.decorate("supabaseComoUsuario", (accessToken: string) =>
    createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }),
  );
});
