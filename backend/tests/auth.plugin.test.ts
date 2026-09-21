// Testes do plugin de auth (backend/src/plugins/auth.ts) com mocks dos clients Supabase —
// sem rede real. Sobe uma instância Fastify de verdade só para exercitar o hook `autenticar`
// via `inject`, que é o jeito mais fiel de testar um onRequest sem reimplementar o Fastify.
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import authPlugin from "../src/plugins/auth.js";
import { COOKIE_ACCESS, COOKIE_REFRESH } from "../src/lib/sessao.js";

interface MocksSupabase {
  getClaims: ReturnType<typeof vi.fn>;
  getUser: ReturnType<typeof vi.fn>;
  refreshSession: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  comoUsuario: ReturnType<typeof vi.fn>;
}

function criarMocks(): MocksSupabase {
  const single = vi.fn();
  const comoUsuario = vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single }),
      }),
    }),
  }));

  return {
    getClaims: vi.fn(),
    getUser: vi.fn(),
    refreshSession: vi.fn(),
    single,
    comoUsuario,
  };
}

function criarApp(mocks: MocksSupabase) {
  const app = Fastify();

  app.register(cookie);
  app.register(
    fp(async (fastify) => {
      fastify.decorate("supabaseAuth", {
        auth: {
          getClaims: mocks.getClaims,
          getUser: mocks.getUser,
          refreshSession: mocks.refreshSession,
        },
      } as never);
      fastify.decorate("supabaseComoUsuario", mocks.comoUsuario as never);
      fastify.decorate("supabaseAdmin", {} as never);
    }),
  );
  app.register(authPlugin);

  // A rota precisa ser declarada dentro de um register próprio: `app.autenticar` só existe
  // depois que o boot do Fastify processa o plugin acima, e isso só acontece na sequência de
  // registro (garantida pelo avvio), não no instante síncrono em que este arquivo é executado.
  app.register(async (instance) => {
    instance.get("/protegida", { onRequest: [instance.autenticar] }, async (request) => ({
      usuario: request.usuario,
      accessToken: request.accessToken,
    }));
  });

  return app;
}

describe("plugin de auth", () => {
  let mocks: MocksSupabase;

  beforeEach(() => {
    mocks = criarMocks();
  });

  it("rejeita requisição sem cookie (401)", async () => {
    const app = criarApp(mocks);

    const resposta = await app.inject({ method: "GET", url: "/protegida" });

    expect(resposta.statusCode).toBe(401);
    expect(resposta.json()).toEqual({ erro: "Não autenticado" });
    expect(mocks.getClaims).not.toHaveBeenCalled();
  });

  it("rejeita quando access e refresh token são inválidos (401 sessão expirada)", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: null }, error: { message: "jwt inválido" } });
    mocks.refreshSession.mockResolvedValue({ data: { session: null }, error: { message: "refresh inválido" } });

    const app = criarApp(mocks);

    const resposta = await app.inject({
      method: "GET",
      url: "/protegida",
      cookies: { [COOKIE_ACCESS]: "token-invalido", [COOKIE_REFRESH]: "refresh-invalido" },
    });

    expect(resposta.statusCode).toBe(401);
    expect(resposta.json()).toEqual({ erro: "Sessão expirada" });
  });

  it("rejeita usuário autenticado sem perfil na tabela usuarios (401)", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null });
    mocks.single.mockResolvedValue({ data: null, error: { message: "not found" } });

    const app = criarApp(mocks);

    const resposta = await app.inject({
      method: "GET",
      url: "/protegida",
      cookies: { [COOKIE_ACCESS]: "token-valido" },
    });

    expect(resposta.statusCode).toBe(401);
    expect(resposta.json()).toEqual({ erro: "Usuário sem perfil na plataforma" });
  });

  it("popula request.usuario e request.accessToken no caminho feliz", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null });
    mocks.single.mockResolvedValue({
      data: { id: "user-1", instituicao_id: "inst-1", papel: "professor", nome: "Ana", status: "ativo" },
      error: null,
    });

    const app = criarApp(mocks);

    const resposta = await app.inject({
      method: "GET",
      url: "/protegida",
      cookies: { [COOKIE_ACCESS]: "token-valido" },
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({
      usuario: { id: "user-1", instituicaoId: "inst-1", papel: "professor", nome: "Ana", status: "ativo" },
      accessToken: "token-valido",
    });
    // carregarPerfil deve usar o client do próprio usuário, não a service role.
    expect(mocks.comoUsuario).toHaveBeenCalledWith("token-valido");
  });

  it("rejeita usuário pendente com 403 e código próprio, sem limpar os cookies", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null });
    mocks.single.mockResolvedValue({
      data: { id: "user-1", instituicao_id: "inst-1", papel: "aluno", nome: "Carla", status: "pendente" },
      error: null,
    });

    const app = criarApp(mocks);

    const resposta = await app.inject({
      method: "GET",
      url: "/protegida",
      cookies: { [COOKIE_ACCESS]: "token-valido" },
    });

    expect(resposta.statusCode).toBe(403);
    expect(resposta.json()).toEqual({
      erro: "Cadastro aguardando aprovação da instituição",
      codigo: "cadastro_pendente",
      nome: "Carla",
    });
    // Sessão é legítima — nada de Set-Cookie (nem de troca, nem de limpeza) nessa resposta.
    expect(resposta.cookies).toEqual([]);
  });

  it("rejeita usuário recusado com 403 e código próprio, sem limpar os cookies", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null });
    mocks.single.mockResolvedValue({
      data: { id: "user-1", instituicao_id: "inst-1", papel: "aluno", nome: "Davi", status: "recusado" },
      error: null,
    });

    const app = criarApp(mocks);

    const resposta = await app.inject({
      method: "GET",
      url: "/protegida",
      cookies: { [COOKIE_ACCESS]: "token-valido" },
    });

    expect(resposta.statusCode).toBe(403);
    expect(resposta.json()).toEqual({
      erro: "Cadastro recusado pela instituição",
      codigo: "cadastro_recusado",
      nome: "Davi",
    });
    expect(resposta.cookies).toEqual([]);
  });

  it("renova a sessão quando o access token está expirado mas o refresh é válido", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: null }, error: { message: "jwt expirado" } });
    mocks.refreshSession.mockResolvedValue({
      data: {
        session: {
          access_token: "token-novo",
          refresh_token: "refresh-novo",
          user: { id: "user-1" },
        },
      },
      error: null,
    });
    mocks.single.mockResolvedValue({
      data: { id: "user-1", instituicao_id: "inst-1", papel: "aluno", nome: "Bia", status: "ativo" },
      error: null,
    });

    const app = criarApp(mocks);

    const resposta = await app.inject({
      method: "GET",
      url: "/protegida",
      cookies: { [COOKIE_ACCESS]: "token-expirado", [COOKIE_REFRESH]: "refresh-valido" },
    });

    expect(resposta.statusCode).toBe(200);
    const corpo = resposta.json();
    // O token exposto e usado para carregar o perfil é o NOVO, não o do cookie antigo.
    expect(corpo.accessToken).toBe("token-novo");
    expect(mocks.comoUsuario).toHaveBeenCalledWith("token-novo");
    expect(mocks.refreshSession).toHaveBeenCalledWith({ refresh_token: "refresh-valido" });

    // A sessão renovada deve trocar os cookies pela nova sessão.
    const cookiesResposta = resposta.cookies.map((c) => c.name);
    expect(cookiesResposta).toEqual(expect.arrayContaining([COOKIE_ACCESS, COOKIE_REFRESH]));
  });

  it("usa getClaims (local) e não chama getUser (remoto) no caminho feliz", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null });
    mocks.single.mockResolvedValue({
      data: { id: "user-1", instituicao_id: "inst-1", papel: "professor", nome: "Ana", status: "ativo" },
      error: null,
    });

    const app = criarApp(mocks);

    const resposta = await app.inject({
      method: "GET",
      url: "/protegida",
      cookies: { [COOKIE_ACCESS]: "token-valido" },
    });

    expect(resposta.statusCode).toBe(200);
    // Prova que a validação é local via getClaims, não remota via getUser
    expect(mocks.getClaims).toHaveBeenCalledWith("token-valido");
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("rejeita quando getClaims falha ou não retorna sub (401)", async () => {
    // Cenário 1: getClaims retorna erro
    mocks.getClaims.mockResolvedValue({ data: { claims: null }, error: { message: "validação falhou" } });

    const app = criarApp(mocks);

    const resposta = await app.inject({
      method: "GET",
      url: "/protegida",
      cookies: { [COOKIE_ACCESS]: "token-invalido" },
    });

    expect(resposta.statusCode).toBe(401);
    expect(resposta.json()).toEqual({ erro: "Não autenticado" });
    // Perfil não foi carregado porque o token já falhou na validação
    expect(mocks.single).not.toHaveBeenCalled();

    // Cenário 2: getClaims retorna claims sem sub
    mocks.getClaims.mockResolvedValue({ data: { claims: {} }, error: null });
    const resposta2 = await app.inject({
      method: "GET",
      url: "/protegida",
      cookies: { [COOKIE_ACCESS]: "token-sem-sub" },
    });

    expect(resposta2.statusCode).toBe(401);
    expect(resposta2.json()).toEqual({ erro: "Não autenticado" });
    expect(mocks.single).not.toHaveBeenCalled();
  });
});
