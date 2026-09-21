import type { FastifyReply } from "fastify";
import type { Session } from "@supabase/supabase-js";
import { env } from "../env.js";

export const COOKIE_ACCESS = "sb_access";
export const COOKIE_REFRESH = "sb_refresh";

// httpOnly: o token nunca fica acessível ao JavaScript do frontend (mitiga XSS).
// O frontend não conhece nem manipula tokens — só manda as requisições com credentials.
//
// sameSite/secure são configuráveis via env (COOKIE_SAME_SITE / COOKIE_SECURE) mas o default
// aqui é "lax", que NÃO envia o cookie em requisição cross-site. A solução preferida para
// produção é servir front e back sob o mesmo domínio via rewrite da Vercel (/api/* → backend),
// mantendo "lax" — mais simples e mais resistente a CSRF. Só usar "none" (exige secure=true)
// se front e back ficarem mesmo em domínios diferentes; é a alternativa pior, não a preferida.
const baseCookie = {
  httpOnly: true,
  sameSite: env.cookieSameSite,
  secure: env.cookieSecure ?? env.producao,
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
