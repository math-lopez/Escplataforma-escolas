// Testes para isolamento multi-tenant e segurança em /api/convites e /api/publico/convites:
// - R1: Escalonamento de privilégio (professor não pode convidar professor/admin)
// - R2: Instituição vem SEMPRE do banco, nunca da requisição
// - R3: Token é criptograficamente seguro
// - R4: Convite expirado ou já aceito não pode ser reutilizado
// - R5: Rotas públicas usam supabaseAdmin
// - R6: Rotas de staff filtram por instituicao_id
import { describe, expect, it, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import authPlugin from "../src/plugins/auth.js";
import convitesRoutes from "../src/routes/convites.js";
import { COOKIE_ACCESS } from "../src/lib/sessao.js";

interface Resultado {
  data: unknown;
  error: unknown;
}

interface Chamada {
  metodo: string;
  args: unknown[];
}

/**
 * Query builder fake, encadeável como o do @supabase/supabase-js: cada método de filtro
 * registra a chamada e devolve o próprio builder; `single()` e resolução direta devolvem
 * o resultado configurado em `estado.resultado`, mutável entre chamadas de `.inject()`.
 */
function criarQueryBuilder(estado: { resultado: Resultado }) {
  const chamadas: Chamada[] = [];
  const builder: Record<string, unknown> = { chamadas };

  const encadeavel = (nome: string) =>
    vi.fn((...args: unknown[]) => {
      chamadas.push({ metodo: nome, args });
      return builder;
    });

  builder.select = encadeavel("select");
  builder.eq = encadeavel("eq");
  builder.is = encadeavel("is");
  builder.order = encadeavel("order");
  builder.insert = encadeavel("insert");
  builder.update = encadeavel("update");
  builder.delete = encadeavel("delete");
  builder.single = vi.fn(() => Promise.resolve(estado.resultado));
  builder.then = (resolve: (v: Resultado) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(estado.resultado).then(resolve, reject);

  return builder as typeof builder & {
    chamadas: Chamada[];
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
  };
}

function fezFiltroInstituicao(chamadas: Chamada[], instituicaoId: string): boolean {
  return chamadas.some((c) => c.metodo === "eq" && c.args[0] === "instituicao_id" && c.args[1] === instituicaoId);
}

interface PerfilSessao {
  id: string;
  instituicaoId: string;
  papel: "admin_instituicao" | "professor" | "aluno";
  nome: string;
}

function criarApp() {
  const estadoPerfil: { resultado: Resultado } = { resultado: { data: null, error: { message: "sem sessão" } } };
  const estadoConvites: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoInstituicoes: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoUsuarios: { resultado: Resultado } = { resultado: { data: null, error: null } };

  const perfilBuilder = criarQueryBuilder(estadoPerfil);
  const convitesBuilder = criarQueryBuilder(estadoConvites);
  const instituicoesBuilder = criarQueryBuilder(estadoInstituicoes);
  const usuariosBuilder = criarQueryBuilder(estadoUsuarios);

  const getClaims = vi.fn();
  const getUser = vi.fn();
  const refreshSession = vi.fn();
  const createUser = vi.fn();
  const deleteUser = vi.fn();
  const signInWithPassword = vi.fn();

  let isAuthCall = true;
  const comoUsuario = vi.fn(() => {
    const resultado = {
      from: (tabela: string) => {
        if (isAuthCall && tabela === "usuarios") {
          isAuthCall = false;
          return perfilBuilder;
        }
        if (tabela === "convites") return convitesBuilder;
        if (tabela === "instituicoes") return instituicoesBuilder;
        if (tabela === "usuarios") return usuariosBuilder;
        return convitesBuilder;
      },
    };
    return resultado as unknown;
  });

  const app = Fastify({ logger: false });
  app.register(cookie);
  app.register(
    fp(async (fastify) => {
      fastify.decorate("supabaseAuth", { auth: { getClaims, getUser, refreshSession, signInWithPassword } } as never);
      fastify.decorate("supabaseComoUsuario", comoUsuario as never);
      fastify.decorate("supabaseAdmin", {
        auth: { admin: { createUser, deleteUser } },
        from: (tabela: string) => {
          if (tabela === "convites") return convitesBuilder;
          if (tabela === "instituicoes") return instituicoesBuilder;
          if (tabela === "usuarios") return usuariosBuilder;
          return convitesBuilder;
        },
      } as never);
    }),
  );
  app.register(authPlugin);
  app.register(convitesRoutes);

  return {
    app,
    estadoPerfil,
    estadoConvites,
    estadoInstituicoes,
    estadoUsuarios,
    perfilBuilder,
    convitesBuilder,
    instituicoesBuilder,
    usuariosBuilder,
    getClaims,
    getUser,
    createUser,
    deleteUser,
    signInWithPassword,
  };
}

/** Autentica a requisição como o perfil dado — sessão sempre ativa nestes testes. */
function logarComo(ctx: ReturnType<typeof criarApp>, perfil: PerfilSessao) {
  ctx.getClaims.mockResolvedValue({ data: { claims: { sub: perfil.id } }, error: null });
  ctx.estadoPerfil.resultado = {
    data: {
      id: perfil.id,
      instituicao_id: perfil.instituicaoId,
      papel: perfil.papel,
      nome: perfil.nome,
      status: "ativo",
    },
    error: null,
  };
}

const COOKIES_SESSAO = { [COOKIE_ACCESS]: "token-valido" };

describe("Convites — Regra R1: Escalonamento de privilégio", () => {
  it("Professor tentando convidar professor → 403 E sem inserir convite", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "prof-id", instituicaoId: "inst-1", papel: "professor", nome: "Prof" });

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/convites",
      cookies: COOKIES_SESSAO,
      payload: { email: "novo@test.com", papel: "professor" },
    });

    expect(resposta.statusCode).toBe(403);
    const body = resposta.json();
    expect(body.erro).toContain("Professores");

    // REFORÇO: verifica que nenhuma linha foi gravada na tabela convites
    expect(ctx.convitesBuilder.insert).not.toHaveBeenCalled();
  });

  it("Professor tentando convidar admin_instituicao → 403 E sem inserir convite", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "prof-id", instituicaoId: "inst-1", papel: "professor", nome: "Prof" });

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/convites",
      cookies: COOKIES_SESSAO,
      payload: { email: "novo@test.com", papel: "admin_instituicao" },
    });

    expect(resposta.statusCode).toBe(403);
    const body = resposta.json();
    expect(body.erro).toContain("Professores");

    // REFORÇO: verifica que nenhuma linha foi gravada na tabela convites
    expect(ctx.convitesBuilder.insert).not.toHaveBeenCalled();
  });

  it("Professor pode convidar aluno (R1 permite)", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "prof-id", instituicaoId: "inst-1", papel: "professor", nome: "Prof" });

    ctx.estadoConvites.resultado = {
      data: null,
      error: { code: "PGRST116", message: "no rows" }, // sem convite pendente
    };

    ctx.instituicoesBuilder.single = vi.fn(() =>
      Promise.resolve({
        data: { nome: "Escola Test" },
        error: null,
      }),
    );

    // Simula que insert vai retornar sucesso
    ctx.convitesBuilder.insert = vi.fn((...args: unknown[]) => {
      ctx.convitesBuilder.chamadas.push({ metodo: "insert", args });
      return {
        ...ctx.convitesBuilder,
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              id: "convite-id",
              email: "novo@test.com",
              papel: "aluno",
              expira_em: "2099-01-01T00:00:00Z",
              criado_em: "2025-01-01T00:00:00Z",
            },
            error: null,
          }),
        ),
      };
    });

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/convites",
      cookies: COOKIES_SESSAO,
      payload: { email: "novo@test.com", papel: "aluno" },
    });

    expect(resposta.statusCode).toBe(201);
    expect(ctx.convitesBuilder.insert).toHaveBeenCalled();
  });

  it("Admin pode convidar professor", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "admin-id", instituicaoId: "inst-1", papel: "admin_instituicao", nome: "Admin" });

    ctx.estadoConvites.resultado = {
      data: null,
      error: { code: "PGRST116", message: "no rows" },
    };

    ctx.convitesBuilder.insert = vi.fn((...args: unknown[]) => {
      ctx.convitesBuilder.chamadas.push({ metodo: "insert", args });
      return {
        ...ctx.convitesBuilder,
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              id: "convite-id",
              email: "novo@test.com",
              papel: "professor",
              expira_em: "2099-01-01T00:00:00Z",
              criado_em: "2025-01-01T00:00:00Z",
            },
            error: null,
          }),
        ),
      };
    });

    ctx.instituicoesBuilder.single = vi.fn(() =>
      Promise.resolve({
        data: { nome: "Escola Test" },
        error: null,
      }),
    );

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/convites",
      cookies: COOKIES_SESSAO,
      payload: { email: "novo@test.com", papel: "professor" },
    });

    expect(resposta.statusCode).toBe(201);
  });
});

describe("Convites — Regra R6: Filtro por instituicao_id", () => {
  it("GET /api/convites filtra por instituicao_id da sessão", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "admin-id", instituicaoId: "inst-1", papel: "admin_instituicao", nome: "Admin" });

    ctx.estadoConvites.resultado = {
      data: [],
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/convites",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(200);
    expect(fezFiltroInstituicao(ctx.convitesBuilder.chamadas, "inst-1")).toBe(true);
  });

  it("GET /api/convites NÃO inclui token na resposta", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "admin-id", instituicaoId: "inst-1", papel: "admin_instituicao", nome: "Admin" });

    ctx.estadoConvites.resultado = {
      data: [
        {
          id: "convite-id",
          email: "test@test.com",
          papel: "aluno",
          expira_em: "2099-01-01T00:00:00Z",
          criado_em: "2025-01-01T00:00:00Z",
        },
      ],
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/convites",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(200);
    const body = resposta.json();
    expect(Array.isArray(body)).toBe(true);
    for (const item of body) {
      expect(item).not.toHaveProperty("token");
    }
  });

  it("DELETE /api/convites/:id de outra instituição → 404", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "admin-id", instituicaoId: "inst-1", papel: "admin_instituicao", nome: "Admin" });

    // Simula: select retorna sem encontrar convite (é de outra instituição)
    ctx.estadoConvites.resultado = {
      data: null,
      error: { message: "no rows" },
    };

    const resposta = await ctx.app.inject({
      method: "DELETE",
      url: "/api/convites/convite-de-outra-inst",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(404);
    expect(fezFiltroInstituicao(ctx.convitesBuilder.chamadas, "inst-1")).toBe(true);
  });
});

describe("Convites — Regra R4: Validação de token e expiração", () => {
  it("GET: Convite já aceito (aceito_em != null) → 404", async () => {
    const ctx = criarApp();

    ctx.convitesBuilder.single = vi.fn(() =>
      Promise.resolve({
        data: {
          id: "convite-id",
          email: "test@test.com",
          papel: "aluno",
          expira_em: "2099-01-01T00:00:00Z",
          aceito_em: "2025-01-01T00:00:00Z", // JÁ ACEITO
          instituicao_id: "inst-1",
          token: "token123",
        },
        error: null,
      }),
    );

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/publico/convites/token123",
    });

    expect(resposta.statusCode).toBe(404);
    const body = resposta.json();
    expect(body.erro).toBe("Convite inválido ou expirado");
  });

  it("GET: Convite expirado (expira_em < agora) → 404", async () => {
    const ctx = criarApp();

    ctx.convitesBuilder.single = vi.fn(() =>
      Promise.resolve({
        data: {
          id: "convite-id",
          email: "test@test.com",
          papel: "aluno",
          expira_em: "2020-01-01T00:00:00Z", // NO PASSADO
          aceito_em: null,
          instituicao_id: "inst-1",
          token: "token123",
        },
        error: null,
      }),
    );

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/publico/convites/token123",
    });

    expect(resposta.statusCode).toBe(404);
    const body = resposta.json();
    expect(body.erro).toBe("Convite inválido ou expirado");
  });

  it("GET: Convite inválido/inexistente → 404 com mensagem genérica", async () => {
    const ctx = criarApp();

    ctx.convitesBuilder.single = vi.fn(() =>
      Promise.resolve({
        data: null,
        error: { code: "PGRST116", message: "no rows" },
      }),
    );

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/publico/convites/token-invalido",
    });

    expect(resposta.statusCode).toBe(404);
    const body = resposta.json();
    expect(body.erro).toBe("Convite inválido ou expirado");
  });
});

describe("Convites — POST /api/publico/convites/:token/aceitar (R2: valores do convite)", () => {
  it("Aceitar convite: insert usa papel DO CONVITE, não do corpo", async () => {
    const ctx = criarApp();

    // Configura o mock para que ambas as chamadas de .single() funcionem
    let primeiraLlamada = true;
    ctx.convitesBuilder.single = vi.fn(() => {
      const resultado = primeiraLlamada
        ? Promise.resolve({
            // Primeira chamada: validação do convite
            data: {
              id: "convite-id",
              email: "user@test.com",
              papel: "aluno", // ← PAPEL É ALUNO
              expira_em: "2099-01-01T00:00:00Z",
              aceito_em: null,
              instituicao_id: "inst-1",
              token: "token123",
            },
            error: null,
          })
        : Promise.resolve({
            // Segunda chamada: select após insert (se houver)
            data: null,
            error: null,
          });

      primeiraLlamada = false;
      return resultado;
    });

    // Mock para insert em usuarios
    ctx.usuariosBuilder.insert = vi.fn((...args: unknown[]) => {
      ctx.usuariosBuilder.chamadas.push({ metodo: "insert", args });
      return {
        ...ctx.usuariosBuilder,
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              id: "user-id",
              nome: "User",
              papel: "aluno",
              status: "ativo",
              instituicao_id: "inst-1",
            },
            error: null,
          }),
        ),
      };
    });

    ctx.createUser.mockResolvedValue({ data: { user: { id: "user-id" } }, error: null });
    ctx.signInWithPassword.mockResolvedValue({
      data: {
        session: {
          access_token: "token",
          refresh_token: "refresh",
          user: { id: "user-id" },
        },
      },
    });

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/publico/convites/token123/aceitar",
      payload: {
        nome: "User",
        senha: "12345678",
        papel: "admin_instituicao", // ← TENTA MANDAR ADMIN MAS CONVITE É ALUNO
        instituicaoId: "outra-instituicao", // ← TENTA MANDAR OUTRA MAS CONVITE É inst-1
      },
    });

    // Verifica que o insert foi chamado
    expect(ctx.usuariosBuilder.insert).toHaveBeenCalled();

    // Verifica o argumento passado ao insert: papel deve ser 'aluno' (do convite)
    const insertCall = ctx.usuariosBuilder.insert.mock.calls[0]?.[0];
    expect((insertCall as Record<string, unknown>).papel).toBe("aluno");
    // E instituicao_id deve ser 'inst-1' (do convite)
    expect((insertCall as Record<string, unknown>).instituicao_id).toBe("inst-1");
  });

  it("Aceitar convite: createUser usa e-mail DO CONVITE, não do corpo", async () => {
    const ctx = criarApp();

    let primeiraLlamada = true;
    ctx.convitesBuilder.single = vi.fn(() => {
      const resultado = primeiraLlamada
        ? Promise.resolve({
            data: {
              id: "convite-id",
              email: "original@test.com", // ← E-MAIL DO CONVITE
              papel: "aluno",
              expira_em: "2099-01-01T00:00:00Z",
              aceito_em: null,
              instituicao_id: "inst-1",
              token: "token123",
            },
            error: null,
          })
        : Promise.resolve({
            data: null,
            error: null,
          });

      primeiraLlamada = false;
      return resultado;
    });

    ctx.usuariosBuilder.insert = vi.fn(() => ({
      ...ctx.usuariosBuilder,
      select: vi.fn().mockReturnThis(),
      single: vi.fn(() =>
        Promise.resolve({
          data: {
            id: "user-id",
            nome: "User",
            papel: "aluno",
            status: "ativo",
            instituicao_id: "inst-1",
          },
          error: null,
        }),
      ),
    }));

    ctx.createUser.mockResolvedValue({ data: { user: { id: "user-id" } }, error: null });
    ctx.signInWithPassword.mockResolvedValue({
      data: {
        session: {
          access_token: "token",
          refresh_token: "refresh",
          user: { id: "user-id" },
        },
      },
    });

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/publico/convites/token123/aceitar",
      payload: {
        nome: "User",
        senha: "12345678",
        email: "outro@test.com", // ← TENTA MANDAR E-MAIL DIFERENTE
      },
    });

    // Verifica que createUser foi chamado com o e-mail DO CONVITE
    expect(ctx.createUser).toHaveBeenCalled();
    const createUserCall = ctx.createUser.mock.calls[0]?.[0];
    expect((createUserCall as Record<string, unknown>).email).toBe("original@test.com");
  });

  it("Aceitar convite já aceito (POST /api/publico/convites/:token/aceitar) → 404", async () => {
    const ctx = criarApp();

    ctx.convitesBuilder.single = vi.fn(() =>
      Promise.resolve({
        data: {
          id: "convite-id",
          email: "test@test.com",
          papel: "aluno",
          expira_em: "2099-01-01T00:00:00Z",
          aceito_em: "2025-01-01T00:00:00Z", // JÁ ACEITO
          instituicao_id: "inst-1",
          token: "token123",
        },
        error: null,
      }),
    );

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/publico/convites/token123/aceitar",
      payload: { nome: "User", senha: "12345678" },
    });

    expect(resposta.statusCode).toBe(404);
    const body = resposta.json();
    expect(body.erro).toBe("Convite inválido ou expirado");

    // Verifica que NENHUM usuário foi criado
    expect(ctx.createUser).not.toHaveBeenCalled();
  });

  it("Aceitar convite expirado (POST /api/publico/convites/:token/aceitar) → 404", async () => {
    const ctx = criarApp();

    ctx.convitesBuilder.single = vi.fn(() =>
      Promise.resolve({
        data: {
          id: "convite-id",
          email: "test@test.com",
          papel: "aluno",
          expira_em: "2020-01-01T00:00:00Z", // NO PASSADO
          aceito_em: null,
          instituicao_id: "inst-1",
          token: "token123",
        },
        error: null,
      }),
    );

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/publico/convites/token123/aceitar",
      payload: { nome: "User", senha: "12345678" },
    });

    expect(resposta.statusCode).toBe(404);
    const body = resposta.json();
    expect(body.erro).toBe("Convite inválido ou expirado");

    // Verifica que NENHUM usuário foi criado
    expect(ctx.createUser).not.toHaveBeenCalled();
  });
});
