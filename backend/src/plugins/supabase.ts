import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { env } from "../env.js";

declare module "fastify" {
  interface FastifyInstance {
    /** Ignora RLS. Usado para toda leitura/escrita de dados de negócio. */
    supabaseAdmin: SupabaseClient;
    /** Anon key. Usado só para as operações de auth (login, refresh de sessão). */
    supabaseAuth: SupabaseClient;
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
});
