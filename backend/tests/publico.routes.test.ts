// Testes para rotas públicas: auto-cadastro e dados da instituição.
// Tópicos testados:
// - R1: auto-cadastro só funciona com modo_ingresso = 'auto_aprovacao'
// - R2: auto-cadastro entra sempre com papel='aluno' e status='pendente'
// - R3: instituição resolvida pelo slug
// - R4: dados de branding retornados
// - R5: não revelar existência de e-mail duplicado
// - GET /api/publico/instituicoes/:slug filtra apenas cursos publicados
// - PATCH /api/instituicoes/atual valida cor e modoIngresso
// - PATCH /api/instituicoes/atual exige admin_instituicao
import { describe, expect, it, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import authPlugin from "../src/plugins/auth.js";
import publicoRoutes from "../src/routes/publico.js";
import instituicoesRoutes from "../src/routes/instituicoes.js";
import { COOKIE_ACCESS } from "../src/lib/sessao.js";

interface Resultado {
  data: unknown;
  error: unknown;
}

interface Chamada {
  metodo: string;
  args: unknown[];
}

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

interface PerfilSessao {
  id: string;
  instituicaoId: string;
  papel: "admin_instituicao" | "professor" | "aluno";
  nome: string;
}

function criarApp() {
  const estadoPerfil: { resultado: Resultado } = { resultado: { data: null, error: { message: "sem sessão" } } };
  const estadoInstituicoes: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoUsuarios: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoCursos: { resultado: Resultado } = { resultado: { data: null, error: null } };

  const perfilBuilder = criarQueryBuilder(estadoPerfil);
  const instituicoesBuilder = criarQueryBuilder(estadoInstituicoes);
  const usuariosBuilder = criarQueryBuilder(estadoUsuarios);
  const cursosBuilder = criarQueryBuilder(estadoCursos);

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
        if (tabela === "instituicoes") return instituicoesBuilder;
        if (tabela === "usuarios") return usuariosBuilder;
        if (tabela === "cursos") return cursosBuilder;
        return instituicoesBuilder;
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
          if (tabela === "instituicoes") return instituicoesBuilder;
          if (tabela === "usuarios") return usuariosBuilder;
          if (tabela === "cursos") return cursosBuilder;
          return instituicoesBuilder;
        },
      } as never);
    }),
  );
  app.register(authPlugin);
  app.register(publicoRoutes);
  app.register(instituicoesRoutes);

  return {
    app,
    estadoPerfil,
    estadoInstituicoes,
    estadoUsuarios,
    estadoCursos,
    perfilBuilder,
    instituicoesBuilder,
    usuariosBuilder,
    cursosBuilder,
    getClaims,
    getUser,
    createUser,
    deleteUser,
    signInWithPassword,
  };
}

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

describe("POST /api/publico/instituicoes/:slug/inscricao — Auto-cadastro (R1: validação de modo_ingresso)", () => {
  it("modo_ingresso='manual' → 403 E createUser NÃO é chamado", async () => {
    const ctx = criarApp();

    ctx.instituicoesBuilder.single = vi.fn(() =>
      Promise.resolve({
        data: {
          id: "inst-1",
          modo_ingresso: "manual",
        },
        error: null,
      }),
    );

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/publico/instituicoes/test-school/inscricao",
      payload: {
        nome: "João Silva",
        email: "joao@test.com",
        senha: "12345678",
      },
    });

    expect(resposta.statusCode).toBe(403);
    const body = resposta.json();
    expect(body.erro).toContain("Auto-cadastro não está habilitado");

    // REFORÇO: verifica que createUser NÃO foi chamado
    expect(ctx.createUser).not.toHaveBeenCalled();
  });

  it("modo_ingresso='convite' → 403 E createUser NÃO é chamado", async () => {
    const ctx = criarApp();

    ctx.instituicoesBuilder.single = vi.fn(() =>
      Promise.resolve({
        data: {
          id: "inst-1",
          modo_ingresso: "convite",
        },
        error: null,
      }),
    );

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/publico/instituicoes/test-school/inscricao",
      payload: {
        nome: "João Silva",
        email: "joao@test.com",
        senha: "12345678",
      },
    });

    expect(resposta.statusCode).toBe(403);
    const body = resposta.json();
    expect(body.erro).toContain("Auto-cadastro não está habilitado");

    // REFORÇO: verifica que createUser NÃO foi chamado
    expect(ctx.createUser).not.toHaveBeenCalled();
  });

  it("modo_ingresso='auto_aprovacao' → 201 com papel='aluno' e status='pendente' (R2)", async () => {
    const ctx = criarApp();

    ctx.instituicoesBuilder.single = vi.fn(() =>
      Promise.resolve({
        data: {
          id: "inst-1",
          modo_ingresso: "auto_aprovacao",
        },
        error: null,
      }),
    );

    ctx.createUser.mockResolvedValue({ data: { user: { id: "user-id" } }, error: null });

    ctx.usuariosBuilder.insert = vi.fn((...args: unknown[]) => {
      ctx.usuariosBuilder.chamadas.push({ metodo: "insert", args });
      return {
        ...ctx.usuariosBuilder,
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              id: "user-id",
              nome: "João Silva",
              papel: "aluno",
              status: "pendente",
              instituicao_id: "inst-1",
            },
            error: null,
          }),
        ),
      };
    });

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/publico/instituicoes/test-school/inscricao",
      payload: {
        nome: "João Silva",
        email: "joao@test.com",
        senha: "12345678",
      },
    });

    expect(resposta.statusCode).toBe(201);
    const body = resposta.json();
    expect(body.status).toBe("pendente");

    // REFORÇO: verifica que insert foi chamado com papel='aluno' e status='pendente'
    const insertCall = ctx.usuariosBuilder.insert.mock.calls[0]?.[0];
    expect((insertCall as Record<string, unknown>).papel).toBe("aluno");
    expect((insertCall as Record<string, unknown>).status).toBe("pendente");
  });

  it("corpo enviando papel='admin_instituicao' → ignora e usa 'aluno' (R2)", async () => {
    const ctx = criarApp();

    ctx.instituicoesBuilder.single = vi.fn(() =>
      Promise.resolve({
        data: {
          id: "inst-1",
          modo_ingresso: "auto_aprovacao",
        },
        error: null,
      }),
    );

    ctx.createUser.mockResolvedValue({ data: { user: { id: "user-id" } }, error: null });

    ctx.usuariosBuilder.insert = vi.fn((...args: unknown[]) => {
      ctx.usuariosBuilder.chamadas.push({ metodo: "insert", args });
      return {
        ...ctx.usuariosBuilder,
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              id: "user-id",
              nome: "João Silva",
              papel: "aluno",
              status: "pendente",
              instituicao_id: "inst-1",
            },
            error: null,
          }),
        ),
      };
    });

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/publico/instituicoes/test-school/inscricao",
      payload: {
        nome: "João Silva",
        email: "joao@test.com",
        senha: "12345678",
        papel: "admin_instituicao", // Tenta definir mas será ignorado
        instituicaoId: "outra-inst", // Tenta definir mas será ignorado
        status: "ativo", // Tenta definir mas será ignorado
      },
    });

    expect(resposta.statusCode).toBe(201);

    // Verifica que insert usou os valores corretos
    const insertCall = ctx.usuariosBuilder.insert.mock.calls[0]?.[0];
    expect((insertCall as Record<string, unknown>).papel).toBe("aluno");
    expect((insertCall as Record<string, unknown>).status).toBe("pendente");
  });

  it("senha com menos de 8 caracteres → 400 E createUser NÃO é chamado", async () => {
    const ctx = criarApp();

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/publico/instituicoes/test-school/inscricao",
      payload: {
        nome: "João Silva",
        email: "joao@test.com",
        senha: "1234567", // 7 caracteres
      },
    });

    expect(resposta.statusCode).toBe(400);
    const body = resposta.json();
    expect(body.erro).toContain("mínimo 8");

    // REFORÇO: verifica que createUser NÃO foi chamado
    expect(ctx.createUser).not.toHaveBeenCalled();
  });

  it("nome vazio → 400", async () => {
    const ctx = criarApp();

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/publico/instituicoes/test-school/inscricao",
      payload: {
        nome: "",
        email: "joao@test.com",
        senha: "12345678",
      },
    });

    expect(resposta.statusCode).toBe(400);
    expect(ctx.createUser).not.toHaveBeenCalled();
  });

  it("email vazio → 400", async () => {
    const ctx = criarApp();

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/publico/instituicoes/test-school/inscricao",
      payload: {
        nome: "João Silva",
        email: "",
        senha: "12345678",
      },
    });

    expect(resposta.statusCode).toBe(400);
    expect(ctx.createUser).not.toHaveBeenCalled();
  });

  it("R5: e-mail novo e e-mail duplicado produzem respostas IDÊNTICAS (não revelam diferença)", async () => {
    const ctx = criarApp();

    // Teste 1: e-mail novo (sucesso real)
    ctx.instituicoesBuilder.single = vi.fn(() =>
      Promise.resolve({
        data: {
          id: "inst-1",
          nome: "Escola Test",
          modo_ingresso: "auto_aprovacao",
        },
        error: null,
      }),
    );

    ctx.createUser.mockResolvedValueOnce({ data: { user: { id: "user-id" } }, error: null });

    ctx.usuariosBuilder.insert = vi.fn((...args: unknown[]) => {
      ctx.usuariosBuilder.chamadas.push({ metodo: "insert", args });
      return {
        ...ctx.usuariosBuilder,
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              id: "user-id",
              nome: "João Silva",
              papel: "aluno",
              status: "pendente",
              instituicao_id: "inst-1",
            },
            error: null,
          }),
        ),
      };
    });

    const respostaNovo = await ctx.app.inject({
      method: "POST",
      url: "/api/publico/instituicoes/test-school/inscricao",
      payload: {
        nome: "João Silva",
        email: "joao@test.com",
        senha: "12345678",
      },
    });

    const corpoNovo = respostaNovo.json();

    // Teste 2: e-mail duplicado (já existe)
    ctx.instituicoesBuilder.single = vi.fn(() =>
      Promise.resolve({
        data: {
          id: "inst-1",
          nome: "Escola Test",
          modo_ingresso: "auto_aprovacao",
        },
        error: null,
      }),
    );

    ctx.createUser.mockResolvedValueOnce({
      data: null,
      error: { message: "User already exists" },
    });

    const respostaDuplicado = await ctx.app.inject({
      method: "POST",
      url: "/api/publico/instituicoes/test-school/inscricao",
      payload: {
        nome: "João Silva",
        email: "joao@test.com",
        senha: "12345678",
      },
    });

    const corpoDuplicado = respostaDuplicado.json();

    // Ambas as respostas devem ser IDÊNTICAS
    expect(respostaNovo.statusCode).toBe(respostaDuplicado.statusCode);
    expect(respostaNovo.statusCode).toBe(201);

    // Status e mensagem devem ser exatamente iguais
    expect(corpoNovo.status).toBe(corpoDuplicado.status);
    expect(corpoNovo.status).toBe("pendente");

    expect(corpoNovo.mensagem).toBe(corpoDuplicado.mensagem);

    // A mensagem deve ser verdadeira em ambos os casos (não revelando qual é qual)
    const mensagem = corpoNovo.mensagem as string;
    expect(mensagem).toContain("Se este e-mail ainda não tiver cadastro");
    expect(mensagem).toContain("Se você já tem conta");
    expect(mensagem).toContain("faça login");

    // Instituição também deve ser igual
    expect(corpoNovo.instituicao).toEqual(corpoDuplicado.instituicao);
  });
});

describe("GET /api/publico/instituicoes/:slug — Dados públicos da instituição", () => {
  it("retorna instituição e filtra apenas cursos publicados", async () => {
    const ctx = criarApp();

    ctx.instituicoesBuilder.single = vi.fn(() =>
      Promise.resolve({
        data: {
          id: "inst-1",
          nome: "Escola Test",
          slug: "escola-test",
          logo_url: "https://logo.jpg",
          cor_primaria: "#FF0000",
          modo_ingresso: "auto_aprovacao",
        },
        error: null,
      }),
    );

    // Configura o builder de cursos para retornar um array
    ctx.estadoCursos.resultado = {
      data: [
        {
          id: "curso-1",
          titulo: "Curso 1",
          descricao: "Descrição 1",
          capa_url: "https://capa1.jpg",
        },
        {
          id: "curso-2",
          titulo: "Curso 2",
          descricao: "Descrição 2",
          capa_url: "https://capa2.jpg",
        },
      ],
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/publico/instituicoes/escola-test",
    });

    expect(resposta.statusCode).toBe(200);
    const body = resposta.json();
    expect(body.nome).toBe("Escola Test");
    expect(body.slug).toBe("escola-test");
    expect(body.modoIngresso).toBe("auto_aprovacao");
    expect(body.logoUrl).toBe("https://logo.jpg");
    expect(body.corPrimaria).toBe("#FF0000");

    // Verifica que a query filtrou por publicado = true
    const chamadas = ctx.cursosBuilder.chamadas;
    const filtroPublicado = chamadas.some(
      (c) => c.metodo === "eq" && c.args[0] === "publicado" && c.args[1] === true,
    );
    expect(filtroPublicado).toBe(true);
  });

  it("slug inexistente → 404", async () => {
    const ctx = criarApp();

    ctx.instituicoesBuilder.single = vi.fn(() =>
      Promise.resolve({
        data: null,
        error: { code: "PGRST116", message: "no rows" },
      }),
    );

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/publico/instituicoes/inexistente",
    });

    expect(resposta.statusCode).toBe(404);
  });
});

describe("PATCH /api/instituicoes/atual — Atualização de configuração (admin_instituicao only)", () => {
  it("modoIngresso inválido (ex.: 'xpto') → 400", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "admin-id", instituicaoId: "inst-1", papel: "admin_instituicao", nome: "Admin" });

    const resposta = await ctx.app.inject({
      method: "PATCH",
      url: "/api/instituicoes/atual",
      cookies: COOKIES_SESSAO,
      payload: {
        modoIngresso: "xpto",
      },
    });

    expect(resposta.statusCode).toBe(400);
    const body = resposta.json();
    expect(body.erro).toContain("inválido");
  });

  it("corPrimaria com cor inválida (ex.: 'vermelho') → 400", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "admin-id", instituicaoId: "inst-1", papel: "admin_instituicao", nome: "Admin" });

    const resposta = await ctx.app.inject({
      method: "PATCH",
      url: "/api/instituicoes/atual",
      cookies: COOKIES_SESSAO,
      payload: {
        corPrimaria: "vermelho",
      },
    });

    expect(resposta.statusCode).toBe(400);
    const body = resposta.json();
    expect(body.erro).toContain("hexadecimal");
  });

  it("papel 'professor' tentando fazer PATCH → 403", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "prof-id", instituicaoId: "inst-1", papel: "professor", nome: "Professor" });

    const resposta = await ctx.app.inject({
      method: "PATCH",
      url: "/api/instituicoes/atual",
      cookies: COOKIES_SESSAO,
      payload: {
        nome: "Novo Nome",
      },
    });

    expect(resposta.statusCode).toBe(403);
  });

  it("PATCH com modoIngresso válido → 200 E atualiza apenas a instituição da sessão", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "admin-id", instituicaoId: "inst-1", papel: "admin_instituicao", nome: "Admin" });

    ctx.instituicoesBuilder.update = vi.fn((...args: unknown[]) => {
      ctx.instituicoesBuilder.chamadas.push({ metodo: "update", args });
      return {
        ...ctx.instituicoesBuilder,
        eq: vi.fn((...eqArgs: unknown[]) => {
          ctx.instituicoesBuilder.chamadas.push({ metodo: "eq", args: eqArgs });
          return {
            ...ctx.instituicoesBuilder,
            select: vi.fn((...selectArgs: unknown[]) => {
              ctx.instituicoesBuilder.chamadas.push({ metodo: "select", args: selectArgs });
              return {
                ...ctx.instituicoesBuilder,
                single: vi.fn(() =>
                  Promise.resolve({
                    data: {
                      id: "inst-1",
                      nome: "Escola Test",
                      slug: "escola-test",
                      logo_url: null,
                      cor_primaria: null,
                      modo_ingresso: "convite",
                    },
                    error: null,
                  }),
                ),
              };
            }),
          };
        }),
      };
    });

    const resposta = await ctx.app.inject({
      method: "PATCH",
      url: "/api/instituicoes/atual",
      cookies: COOKIES_SESSAO,
      payload: {
        modoIngresso: "convite",
      },
    });

    expect(resposta.statusCode).toBe(200);

    // Verifica que update foi chamado
    expect(ctx.instituicoesBuilder.update).toHaveBeenCalled();

    // Verifica que o .eq("id", ...) filtra pela instituição da sessão
    const chamadasEq = ctx.instituicoesBuilder.chamadas.filter((c) => c.metodo === "eq");
    const filtroInstituicao = chamadasEq.some(
      (c) => c.args[0] === "id" && c.args[1] === "inst-1",
    );
    expect(filtroInstituicao).toBe(true);
  });

  it("corPrimaria com formato #RRGGBB válido → 200", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "admin-id", instituicaoId: "inst-1", papel: "admin_instituicao", nome: "Admin" });

    ctx.instituicoesBuilder.update = vi.fn(() => ({
      ...ctx.instituicoesBuilder,
      eq: vi.fn(() => ({
        ...ctx.instituicoesBuilder,
        select: vi.fn(() => ({
          ...ctx.instituicoesBuilder,
          single: vi.fn(() =>
            Promise.resolve({
              data: {
                id: "inst-1",
                nome: "Escola Test",
                slug: "escola-test",
                logo_url: null,
                cor_primaria: "#FF0000",
                modo_ingresso: "manual",
              },
              error: null,
            }),
          ),
        })),
      })),
    }));

    const resposta = await ctx.app.inject({
      method: "PATCH",
      url: "/api/instituicoes/atual",
      cookies: COOKIES_SESSAO,
      payload: {
        corPrimaria: "#FF0000",
      },
    });

    expect(resposta.statusCode).toBe(200);
  });

  it("corPrimaria com formato #RGB válido → 200", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "admin-id", instituicaoId: "inst-1", papel: "admin_instituicao", nome: "Admin" });

    ctx.instituicoesBuilder.update = vi.fn(() => ({
      ...ctx.instituicoesBuilder,
      eq: vi.fn(() => ({
        ...ctx.instituicoesBuilder,
        select: vi.fn(() => ({
          ...ctx.instituicoesBuilder,
          single: vi.fn(() =>
            Promise.resolve({
              data: {
                id: "inst-1",
                nome: "Escola Test",
                slug: "escola-test",
                logo_url: null,
                cor_primaria: "#F00",
                modo_ingresso: "manual",
              },
              error: null,
            }),
          ),
        })),
      })),
    }));

    const resposta = await ctx.app.inject({
      method: "PATCH",
      url: "/api/instituicoes/atual",
      cookies: COOKIES_SESSAO,
      payload: {
        corPrimaria: "#F00",
      },
    });

    expect(resposta.statusCode).toBe(200);
  });
});
