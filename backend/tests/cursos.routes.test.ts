// Prova de isolamento multi-tenant em /api/cursos: um usuário da instituição A não pode
// enxergar, editar nem apagar curso de outra instituição, e campos que só a sessão deveria
// decidir (instituicao_id, criado_por) não podem vir do corpo da requisição.
//
// Os mocks NÃO reproduzem o comportamento real do RLS/Postgrest (não filtram nada sozinhos) —
// de propósito: se um teste só checasse a resposta final, ele passaria com ou sem o filtro
// manual de instituicao_id na rota (o mock devolveria o mesmo resultado configurado de qualquer
// jeito). Por isso cada teste de isolamento também inspeciona `chamadas` do query builder para
// garantir que a rota realmente construiu a query com `.eq("instituicao_id", <da sessão>)` —
// removendo esse filtro do código de produção, estes testes falham de verdade.
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import authPlugin from "../src/plugins/auth.js";
import cursosRoutes from "../src/routes/cursos.js";
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
 * (select/eq/order/insert/update/delete) registra a chamada e devolve o próprio builder;
 * `single()` e a resolução direta (`then`, para quando a rota não chama `.single()`) devolvem
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
  const estadoCursos: { resultado: Resultado } = { resultado: { data: null, error: null } };

  const perfilBuilder = criarQueryBuilder(estadoPerfil);
  const cursoBuilder = criarQueryBuilder(estadoCursos);

  const getClaims = vi.fn();
  const getUser = vi.fn();
  const refreshSession = vi.fn();

  // Diferencia por tabela: "usuarios" é a query interna de autenticação (plugins/auth.ts),
  // "cursos" é a query da rota sob teste — cada uma resolve com seu próprio estado mutável.
  const comoUsuario = vi.fn(() => ({
    from: (tabela: string) => (tabela === "usuarios" ? perfilBuilder : cursoBuilder),
  }));

  const app = Fastify();
  app.register(cookie);
  app.register(
    fp(async (fastify) => {
      fastify.decorate("supabaseAuth", { auth: { getClaims, getUser, refreshSession } } as never);
      fastify.decorate("supabaseComoUsuario", comoUsuario as never);
      fastify.decorate("supabaseAdmin", {} as never);
    }),
  );
  app.register(authPlugin);
  app.register(cursosRoutes);

  return { app, estadoPerfil, estadoCursos, perfilBuilder, cursoBuilder, getClaims, getUser };
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

describe("isolamento multi-tenant em /api/cursos", () => {
  it("GET /api/cursos filtra pela instituição da sessão, não por nada vindo da requisição", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-A", instituicaoId: "inst-A", papel: "professor", nome: "Ana" });

    ctx.estadoCursos.resultado = {
      data: [
        {
          id: "curso-1",
          titulo: "Curso da instituição A",
          descricao: null,
          capa_url: null,
          publicado: true,
          criado_por: "user-A",
          criado_em: "2024-01-01T00:00:00.000Z",
        },
      ],
      error: null,
    };

    const resposta = await ctx.app.inject({ method: "GET", url: "/api/cursos", cookies: COOKIES_SESSAO });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual([
      {
        id: "curso-1",
        titulo: "Curso da instituição A",
        descricao: null,
        capaUrl: null,
        publicado: true,
        criadoPor: "user-A",
        criadoEm: "2024-01-01T00:00:00.000Z",
      },
    ]);

    // A prova real: se alguém remover o `.eq("instituicao_id", ...)` da rota, esta asserção
    // falha — independentemente do que o mock devolveria como "resposta".
    expect(fezFiltroInstituicao(ctx.cursoBuilder.chamadas, "inst-A")).toBe(true);
  });

  it("GET /api/cursos/:id não alcança curso de outra instituição (404) e filtra pela instituição da sessão", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-A", instituicaoId: "inst-A", papel: "professor", nome: "Ana" });

    // Simula o efeito real de instituicao_id não bater: nenhuma linha retorna.
    ctx.estadoCursos.resultado = { data: null, error: { message: "no rows" } };

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/cursos/curso-da-instituicao-b",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toEqual({ erro: "Curso não encontrado" });

    const { chamadas } = ctx.cursoBuilder;
    expect(chamadas).toContainEqual({ metodo: "eq", args: ["id", "curso-da-instituicao-b"] });
    // O filtro usa SEMPRE a instituição da sessão (inst-A) — nunca uma instituição vinda da
    // URL/corpo. Removendo esse `.eq`, a asserção abaixo falha.
    expect(fezFiltroInstituicao(chamadas, "inst-A")).toBe(true);
  });

  it("PATCH /api/cursos/:id não alcança curso de outra instituição (404) e ignora instituicaoId/criadoPor do corpo", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-A", instituicaoId: "inst-A", papel: "admin_instituicao", nome: "Ana" });

    ctx.estadoCursos.resultado = { data: null, error: { message: "no rows" } };

    const resposta = await ctx.app.inject({
      method: "PATCH",
      url: "/api/cursos/curso-da-instituicao-b",
      cookies: COOKIES_SESSAO,
      payload: {
        titulo: "Tentativa de sequestro",
        instituicaoId: "inst-B",
        criadoPor: "user-B",
        instituicao_id: "inst-B",
        criado_por: "user-B",
      },
    });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toEqual({ erro: "Curso não encontrado" });

    const { chamadas } = ctx.cursoBuilder;
    expect(fezFiltroInstituicao(chamadas, "inst-A")).toBe(true);

    // O update construído só pode conter os campos do contrato (aqui, só titulo) — nenhum
    // rastro de instituicaoId/criadoPor/instituicao_id/criado_por vindos do corpo.
    expect(ctx.cursoBuilder.update).toHaveBeenCalledWith({ titulo: "Tentativa de sequestro" });
  });

  it("DELETE /api/cursos/:id não alcança curso de outra instituição (404) e filtra pela instituição da sessão", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-A", instituicaoId: "inst-A", papel: "admin_instituicao", nome: "Ana" });

    // Nenhuma linha apagada: é assim que o Postgrest responde quando o filtro não bate com
    // nenhuma linha (curso pertence à instituição B).
    ctx.estadoCursos.resultado = { data: [], error: null };

    const resposta = await ctx.app.inject({
      method: "DELETE",
      url: "/api/cursos/curso-da-instituicao-b",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toEqual({ erro: "Curso não encontrado" });

    const { chamadas } = ctx.cursoBuilder;
    expect(chamadas).toContainEqual({ metodo: "eq", args: ["id", "curso-da-instituicao-b"] });
    expect(fezFiltroInstituicao(chamadas, "inst-A")).toBe(true);
  });

  it("POST /api/cursos ignora instituicaoId e criadoPor do corpo, usando sempre os da sessão", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-A", instituicaoId: "inst-A", papel: "professor", nome: "Ana" });

    ctx.estadoCursos.resultado = {
      data: {
        id: "curso-novo",
        titulo: "Curso Novo",
        descricao: null,
        capa_url: null,
        publicado: false,
        criado_por: "user-A",
        criado_em: "2024-01-01T00:00:00.000Z",
      },
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/cursos",
      cookies: COOKIES_SESSAO,
      payload: {
        titulo: "Curso Novo",
        instituicaoId: "inst-B",
        criadoPor: "user-B",
        instituicao_id: "inst-B",
        criado_por: "user-B",
      },
    });

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json()).toEqual({
      id: "curso-novo",
      titulo: "Curso Novo",
      descricao: null,
      capaUrl: null,
      publicado: false,
      criadoPor: "user-A",
      criadoEm: "2024-01-01T00:00:00.000Z",
    });

    // A prova real de que o corpo foi ignorado: o insert só pode conter os valores da sessão,
    // nunca "inst-B"/"user-B" mandados no payload.
    expect(ctx.cursoBuilder.insert).toHaveBeenCalledWith({
      instituicao_id: "inst-A",
      criado_por: "user-A",
      titulo: "Curso Novo",
      descricao: null,
      publicado: false,
    });
  });

  it("escrita (POST) exige papel admin_instituicao ou professor — aluno recebe 403 e nenhuma query é feita", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-C", instituicaoId: "inst-A", papel: "aluno", nome: "Carla" });

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/cursos",
      cookies: COOKIES_SESSAO,
      payload: { titulo: "Curso qualquer" },
    });

    expect(resposta.statusCode).toBe(403);
    expect(ctx.cursoBuilder.insert).not.toHaveBeenCalled();
  });

  // Estas rotas são o painel do professor: curso não publicado é material em preparação, e um
  // aluno da MESMA instituição não pode listar nem ler isso — só admin_instituicao/professor.
  // A listagem que o aluno usa (matrícula + publicado) é uma rota separada, ainda não escrita.
  it("GET /api/cursos exige papel admin_instituicao ou professor — aluno da própria instituição recebe 403 e nenhuma query é feita", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-C", instituicaoId: "inst-A", papel: "aluno", nome: "Carla" });

    const resposta = await ctx.app.inject({ method: "GET", url: "/api/cursos", cookies: COOKIES_SESSAO });

    expect(resposta.statusCode).toBe(403);
    expect(ctx.cursoBuilder.select).not.toHaveBeenCalled();
  });

  it("GET /api/cursos/:id exige papel admin_instituicao ou professor — aluno da própria instituição recebe 403 e nenhuma query é feita", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-C", instituicaoId: "inst-A", papel: "aluno", nome: "Carla" });

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/cursos/curso-1",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(403);
    expect(ctx.cursoBuilder.select).not.toHaveBeenCalled();
  });
});
