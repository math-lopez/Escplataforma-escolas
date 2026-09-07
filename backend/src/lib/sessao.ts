import type { FastifyReply } from "fastify";
import type { Session } from "@supabase/supabase-js";
import { env } from "../env.js";

export const COOKIE_ACCESS = "sb_access";
export const COOKIE_REFRESH = "sb_refresh";

// httpOnly: o token nunca fica acessível ao JavaScript do frontend (mitiga XSS).
// O frontend não conhece nem manipula tokens — só manda as requisições com credentials.
const baseCookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.producao,
  path: "/",
};

const UMA_HORA = 60 * 60;
const TRINTA_DIAS = 60 * 60 * 24 * 30;

export function definirCookiesSessao(reply: FastifyReply, session: Session) {
  reply.setCookie(COOKIE_ACCESS, session.access_token, { ...baseCookie, maxAge: UMA_HORA });
  if (session.refresh_token) {
    reply.setCookie(COOKIE_REFRESH, session.refresh_token, { ...baseCookie, maxAge: TRINTA_DIAS });
  }
}

export function limparCookiesSessao(reply: FastifyReply) {
  reply.clearCookie(COOKIE_ACCESS, baseCookie);
  reply.clearCookie(COOKIE_REFRESH, baseCookie);
}
