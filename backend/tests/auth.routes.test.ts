// Prova de que login (`POST /api/auth/login`) e `/api/auth/me` compartilham a mesma decisão de
// autorização (`fastify.autorizarPerfil`, em backend/src/plugins/auth.ts) em vez de duas cópias
// da regra de status divergindo com o tempo — foi exatamente isso que aconteceu antes desta
// extração: a checagem de pendente/recusado só existia em `autenticar`, não no login.
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import authPlugin from "../src/plugins/auth.js";
import authRoutes from "../src/routes/auth.js";
import { COOKIE_ACCESS, COOKIE_REFRESH } from "../src/lib/sessao.js";

// Instituição-padrão devolvida pelo mock quando o teste não define outro valor: os testes que
// não têm branding como foco só precisam que a chamada não quebre.
const INSTITUICAO_PADRAO = {
  id: "inst-1",
  nome: "Escola Teste",
  slug: "escola-teste",
  logo_url: null,
  cor_primaria: null,
};

function criarApp() {
  const singleUsuario = vi.fn();
  const singleInstituicao = vi.fn().mockResolvedValue({ data: INSTITUICAO_PADRAO, error: null });
  // `from(tabela)` precisa diferenciar a tabela: login e /me agora buscam tanto o perfil
  // (usuarios, via carregarPerfil no plugin) quanto o branding (instituicoes, via
  // montarRespostaPerfil na rota) através do mesmo client comoUsuario.
  const from = vi.fn((tabela: string) => ({
    select: () => ({
      eq: () => ({ single: tabela === "usuarios" ? singleUsuario : singleInstituicao }),
    }),
  }));
  const comoUsuario = vi.fn(() => ({ from }));
  const signInWithPassword = vi.fn();
  const getClaims = vi.fn();
  const getUser = vi.fn();
  const refreshSession = vi.fn();

  const app = Fastify();
  app.register(cookie);
  app.register(
    fp(async (fastify) => {
      fastify.decorate("supabaseAuth", {
        auth: { signInWithPassword, getClaims, getUser, refreshSession },
      } as never);
      fastify.decorate("supabaseComoUsuario", comoUsuario as never);
      fastify.decorate("supabaseAdmin", {} as never);
    }),
  );
  app.register(authPlugin);
  app.register(authRoutes);

  return {
    app,
    mocks: { single: singleUsuario, singleInstituicao, comoUsuario, signInWithPassword, getClaims, getUser, refreshSession },
  };
}

describe("login e /me para o mesmo usuário", () => {
  it("login de usuário pendente devolve 403 com cookie setado, e /me com o mesmo cookie repete a resposta", async () => {
    const { app, mocks } = criarApp();

    mocks.signInWithPassword.mockResolvedValue({
      data: {
        session: {
          access_token: "token-login",
          refresh_token: "refresh-login",
          user: { id: "user-1" },
        },
      },
      error: null,
    });
    mocks.single.mockResolvedValue({
      data: { id: "user-1", instituicao_id: "inst-1", papel: "aluno", nome: "Carla", status: "pendente" },
      error: null,
    });

    const respostaLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "carla@escola.com", senha: "123456" },
    });

    expect(respostaLogin.statusCode).toBe(403);
    expect(respostaLogin.json()).toEqual({
      erro: "Cadastro aguardando aprovação da instituição",
      codigo: "cadastro_pendente",
      nome: "Carla",
    });

    // A sessão precisa continuar valendo: o cookie foi setado apesar do 403, porque a decisão
    // de bloquear é de autorização (pendente), não de autenticação (credenciais inválidas).
    const nomesCookiesLogin = respostaLogin.cookies.map((c) => c.name);
    expect(nomesCookiesLogin).toEqual(expect.arrayContaining([COOKIE_ACCESS, COOKIE_REFRESH]));

    // Reusa o cookie que o login setou para chamar /me — se as duas rotas realmente
    // compartilham a mesma regra, a resposta tem que ser idêntica, não só "parecida".
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null });
    const cookiesLogin = Object.fromEntries(respostaLogin.cookies.map((c) => [c.name, c.value]));

    const respostaMe = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: cookiesLogin,
    });

    expect(respostaMe.statusCode).toBe(respostaLogin.statusCode);
    expect(respostaMe.json()).toEqual(respostaLogin.json());
  });

  it("login de usuário ativo devolve o mesmo formato de perfil que /me", async () => {
    const { app, mocks } = criarApp();

    mocks.signInWithPassword.mockResolvedValue({
      data: {
        session: {
          access_token: "token-login",
          refresh_token: "refresh-login",
          user: { id: "user-1" },
        },
      },
      error: null,
    });
    mocks.single.mockResolvedValue({
      data: { id: "user-1", instituicao_id: "inst-1", papel: "professor", nome: "Ana", status: "ativo" },
      error: null,
    });

    const respostaLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "ana@escola.com", senha: "123456" },
    });

    expect(respostaLogin.statusCode).toBe(200);
    expect(respostaLogin.json()).toEqual({
      id: "user-1",
      nome: "Ana",
      papel: "professor",
      instituicaoId: "inst-1",
      instituicao: {
        id: "inst-1",
        nome: "Escola Teste",
        slug: "escola-teste",
        logoUrl: null,
        corPrimaria: null,
      },
    });

    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null });
    const cookiesLogin = Object.fromEntries(respostaLogin.cookies.map((c) => [c.name, c.value]));

    const respostaMe = await app.inject({ method: "GET", url: "/api/auth/me", cookies: cookiesLogin });

    expect(respostaMe.statusCode).toBe(200);
    expect(respostaMe.json()).toEqual(respostaLogin.json());
  });

  it("expõe logoUrl e corPrimaria da instituição no formato camelCase", async () => {
    const { app, mocks } = criarApp();

    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null });
    mocks.single.mockResolvedValue({
      data: { id: "user-1", instituicao_id: "inst-2", papel: "admin_instituicao", nome: "Bruno", status: "ativo" },
      error: null,
    });
    mocks.singleInstituicao.mockResolvedValue({
      data: {
        id: "inst-2",
        nome: "Colégio XPTO",
        slug: "colegio-xpto",
        logo_url: "https://cdn.exemplo.com/logo.png",
        cor_primaria: "#123456",
      },
      error: null,
    });

    const resposta = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { [COOKIE_ACCESS]: "token-valido" },
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({
      id: "user-1",
      nome: "Bruno",
      papel: "admin_instituicao",
      instituicaoId: "inst-2",
      instituicao: {
        id: "inst-2",
        nome: "Colégio XPTO",
        slug: "colegio-xpto",
        logoUrl: "https://cdn.exemplo.com/logo.png",
        corPrimaria: "#123456",
      },
    });
  });
});
