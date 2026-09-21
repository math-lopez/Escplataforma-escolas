// Prova de isolamento multi-tenant em /api/cursos/:cursoId/modulos e /api/modulos/:id.
//
// Diferente de cursos.routes.test.ts: `modulos` não tem `instituicao_id` — a única forma de
// isolar é via join até `cursos` (ver services/conteudoCurso.ts). Por isso o mock aqui, além de
// registrar as chamadas de query builder por tabela (mesma técnica de cursos.routes.test.ts),
// dá a cada tabela uma FILA de resultados: uma mesma requisição frequentemente faz mais de uma
// query na mesma tabela (ex.: POST módulo conta os existentes e depois insere), e cada uma
// precisa poder responder algo diferente.
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import authPlugin from "../src/plugins/auth.js";
import modulosRoutes from "../src/routes/modulos.js";
import { COOKIE_ACCESS } from "../src/lib/sessao.js";

interface Resultado {
  data: unknown;
  error: unknown;
  count?: number | null;
}

interface Chamada {
  metodo: string;
  args: unknown[];
}

interface TabelaFake {
  filaResultados: Resultado[];
  chamadas: Chamada[];
}

function criarTabela(...resultados: Resultado[]): TabelaFake {
  return { filaResultados: resultados.length > 0 ? resultados : [{ data: null, error: null }], chamadas: [] };
}

/**
 * Cada `.from(tabela)` devolve um builder NOVO (mais fiel ao client real: cada query é
 * independente), mas todos os builders da mesma tabela compartilham `chamadas` (log combinado,
 * usado nas asserções de isolamento) e `filaResultados` (consumida em ordem — depois de
 * esgotada, repete o último resultado configurado em vez de quebrar o teste).
 */
function criarQueryBuilder(tabela: TabelaFake) {
  const builder: Record<string, unknown> = {};

  const encadeavel = (metodo: string) =>
    vi.fn((...args: unknown[]) => {
      tabela.chamadas.push({ metodo, args });
      return builder;
    });

  builder.select = encadeavel("select");
  builder.eq = encadeavel("eq");
  builder.order = encadeavel("order");
  builder.insert = encadeavel("insert");
  builder.update = encadeavel("update");
  builder.delete = encadeavel("delete");

  function proximoResultado(): Resultado {
    if (tabela.filaResultados.length > 1) return tabela.filaResultados.shift()!;
    return tabela.filaResultados[0];
  }

  builder.single = vi.fn(() => Promise.resolve(proximoResultado()));
  builder.then = (resolve: (v: Resultado) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(proximoResultado()).then(resolve, reject);

  return builder;
}

function fezFiltro(chamadas: Chamada[], coluna: string, valor: unknown): boolean {
  return chamadas.some((c) => c.metodo === "eq" && c.args[0] === coluna && c.args[1] === valor);
}

interface PerfilSessao {
  id: string;
  instituicaoId: string;
  papel: "admin_instituicao" | "professor" | "aluno";
  nome: string;
}

function criarApp() {
  const tabelas: Record<string, TabelaFake> = {
    usuarios: criarTabela({ data: null, error: { message: "sem sessão" } }),
    cursos: criarTabela({ data: null, error: null }),
    modulos: criarTabela({ data: null, error: null }),
  };

  const getClaims = vi.fn();
  const getUser = vi.fn();

  const comoUsuario = vi.fn(() => ({
    from: (nomeTabela: string) => criarQueryBuilder(tabelas[nomeTabela] ?? (tabelas[nomeTabela] = criarTabela())),
  }));

  const app = Fastify();
  app.register(cookie);
  app.register(
    fp(async (fastify) => {
      fastify.decorate("supabaseAuth", { auth: { getClaims, getUser, refreshSession: vi.fn() } } as never);
      fastify.decorate("supabaseComoUsuario", comoUsuario as never);
      fastify.decorate("supabaseAdmin", {} as never);
    }),
  );
  app.register(authPlugin);
  app.register(modulosRoutes);

  return { app, tabelas, getClaims, getUser };
}

function logarComo(ctx: ReturnType<typeof criarApp>, perfil: PerfilSessao) {
  ctx.getClaims.mockResolvedValue({ data: { claims: { sub: perfil.id } }, error: null });
  ctx.tabelas.usuarios.filaResultados = [
    {
      data: {
        id: perfil.id,
        instituicao_id: perfil.instituicaoId,
        papel: perfil.papel,
        nome: perfil.nome,
        status: "ativo",
      },
      error: null,
    },
  ];
}

const COOKIES_SESSAO = { [COOKIE_ACCESS]: "token-valido" };
const SESSAO_A: PerfilSessao = { id: "user-A", instituicaoId: "inst-A", papel: "professor", nome: "Ana" };

describe("isolamento multi-tenant em modulos", () => {
  it("GET /api/cursos/:cursoId/modulos: curso de outra instituição não é encontrado (404)", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.cursos.filaResultados = [{ data: null, error: { message: "no rows" } }];

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/cursos/curso-da-instituicao-b/modulos",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(404);
    // A prova real: se o `.eq("instituicao_id", ...)` sumir da verificação do curso, isto falha
    // (a query de módulos nem deveria ter sido tentada).
    expect(fezFiltro(ctx.tabelas.cursos.chamadas, "instituicao_id", "inst-A")).toBe(true);
    expect(ctx.tabelas.modulos.chamadas.some((c) => c.metodo === "select")).toBe(false);
  });

  it("GET /api/cursos/:cursoId/modulos: caminho feliz devolve módulos com aulas aninhadas", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.cursos.filaResultados = [{ data: { id: "curso-1" }, error: null }];
    ctx.tabelas.modulos.filaResultados = [
      {
        data: [
          { id: "mod-1", curso_id: "curso-1", titulo: "Módulo 1", ordem: 0, aulas: [] },
        ],
        error: null,
      },
    ];

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/cursos/curso-1/modulos",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual([
      { id: "mod-1", cursoId: "curso-1", titulo: "Módulo 1", ordem: 0, aulas: [] },
    ]);
  });

  it("POST /api/cursos/:cursoId/modulos: curso de outra instituição não é encontrado (404), sem insert", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.cursos.filaResultados = [{ data: null, error: { message: "no rows" } }];

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/cursos/curso-da-instituicao-b/modulos",
      cookies: COOKIES_SESSAO,
      payload: { titulo: "Módulo novo" },
    });

    expect(resposta.statusCode).toBe(404);
    expect(ctx.tabelas.modulos.chamadas.some((c) => c.metodo === "insert")).toBe(false);
  });

  it("POST /api/cursos/:cursoId/modulos: caminho feliz cria com ordem = contagem atual", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.cursos.filaResultados = [{ data: { id: "curso-1" }, error: null }];
    ctx.tabelas.modulos.filaResultados = [
      { data: null, error: null, count: 2 }, // contagem
      { data: { id: "mod-novo", curso_id: "curso-1", titulo: "Módulo novo", ordem: 2 }, error: null }, // insert
    ];

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/cursos/curso-1/modulos",
      cookies: COOKIES_SESSAO,
      payload: { titulo: "Módulo novo" },
    });

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json()).toEqual({ id: "mod-novo", cursoId: "curso-1", titulo: "Módulo novo", ordem: 2, aulas: [] });
    expect(ctx.tabelas.modulos.chamadas).toContainEqual({
      metodo: "insert",
      args: [{ curso_id: "curso-1", titulo: "Módulo novo", ordem: 2 }],
    });
  });

  it("PATCH /api/modulos/:id: módulo de curso de outra instituição não é encontrado (404), sem update", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    // A verificação de posse (join com cursos!inner) não encontra linha — simula módulo de outra instituição.
    ctx.tabelas.modulos.filaResultados = [{ data: null, error: { message: "no rows" } }];

    const resposta = await ctx.app.inject({
      method: "PATCH",
      url: "/api/modulos/modulo-da-instituicao-b",
      cookies: COOKIES_SESSAO,
      payload: { titulo: "Sequestro" },
    });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toEqual({ erro: "Módulo não encontrado" });
    // A prova de que a verificação usou a instituição da SESSÃO (nunca uma vinda da URL/corpo).
    expect(fezFiltro(ctx.tabelas.modulos.chamadas, "cursos.instituicao_id", "inst-A")).toBe(true);
    expect(ctx.tabelas.modulos.chamadas.some((c) => c.metodo === "update")).toBe(false);
  });

  it("DELETE /api/modulos/:id: módulo de curso de outra instituição não é encontrado (404), sem delete", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.modulos.filaResultados = [{ data: null, error: { message: "no rows" } }];

    const resposta = await ctx.app.inject({
      method: "DELETE",
      url: "/api/modulos/modulo-da-instituicao-b",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(404);
    expect(fezFiltro(ctx.tabelas.modulos.chamadas, "cursos.instituicao_id", "inst-A")).toBe(true);
    expect(ctx.tabelas.modulos.chamadas.some((c) => c.metodo === "delete")).toBe(false);
  });

  it("PUT /api/cursos/:cursoId/modulos/ordem: id que não pertence ao curso é rejeitado (400), sem update", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.cursos.filaResultados = [{ data: { id: "curso-1" }, error: null }];
    // Só "mod-1" e "mod-2" pertencem de fato ao curso.
    ctx.tabelas.modulos.filaResultados = [{ data: [{ id: "mod-1" }, { id: "mod-2" }], error: null }];

    const resposta = await ctx.app.inject({
      method: "PUT",
      url: "/api/cursos/curso-1/modulos/ordem",
      cookies: COOKIES_SESSAO,
      payload: { ids: ["mod-1", "modulo-de-outro-curso"] },
    });

    expect(resposta.statusCode).toBe(400);
    expect(ctx.tabelas.modulos.chamadas.some((c) => c.metodo === "update")).toBe(false);
  });

  it("PUT /api/cursos/:cursoId/modulos/ordem: caminho feliz atualiza ordem de todos os ids", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.cursos.filaResultados = [{ data: { id: "curso-1" }, error: null }];
    ctx.tabelas.modulos.filaResultados = [
      { data: [{ id: "mod-1" }, { id: "mod-2" }], error: null }, // existentes
      { data: null, error: null }, // update mod-2
      { data: null, error: null }, // update mod-1
    ];

    const resposta = await ctx.app.inject({
      method: "PUT",
      url: "/api/cursos/curso-1/modulos/ordem",
      cookies: COOKIES_SESSAO,
      payload: { ids: ["mod-2", "mod-1"] },
    });

    expect(resposta.statusCode).toBe(204);
    expect(ctx.tabelas.modulos.chamadas).toContainEqual({ metodo: "update", args: [{ ordem: 0 }] });
    expect(ctx.tabelas.modulos.chamadas).toContainEqual({ metodo: "update", args: [{ ordem: 1 }] });
  });

  it("escrita (POST) exige papel admin_instituicao ou professor — aluno recebe 403, sem query em modulos", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-C", instituicaoId: "inst-A", papel: "aluno", nome: "Carla" });

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/cursos/curso-1/modulos",
      cookies: COOKIES_SESSAO,
      payload: { titulo: "Módulo qualquer" },
    });

    expect(resposta.statusCode).toBe(403);
    expect(ctx.tabelas.modulos.chamadas).toHaveLength(0);
  });
});
