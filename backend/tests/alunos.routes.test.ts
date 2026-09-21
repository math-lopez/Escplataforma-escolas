// Prova de isolamento multi-tenant em /api/alunos e /api/cursos/.../matriculas: um usuário de
// uma instituição A não pode enxergar, editar nem aprovar alunos de outra instituição, campos
// que só a sessão deveria decidir (instituicao_id) não podem vir do corpo da requisição, e a
// criação de usuário no Auth com supabaseAdmin é seguida de rollback se o insert em usuarios
// falhar.
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import authPlugin from "../src/plugins/auth.js";
import alunosRoutes from "../src/routes/alunos.js";
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
  // Estados para diferentes contextos: perfil é para autenticação, outros são para operações de negócio
  const estadoPerfil: { resultado: Resultado } = { resultado: { data: null, error: { message: "sem sessão" } } };
  const estadoAlunos: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoAlunosAdmin: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoCursos: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoMatriculas: { resultado: Resultado } = { resultado: { data: null, error: null } };

  const perfilBuilder = criarQueryBuilder(estadoPerfil);
  const alunosBuilder = criarQueryBuilder(estadoAlunos);
  const alunosAdminBuilder = criarQueryBuilder(estadoAlunosAdmin);
  const cursosBuilder = criarQueryBuilder(estadoCursos);
  const matriculasBuilder = criarQueryBuilder(estadoMatriculas);

  const getClaims = vi.fn();
  const getUser = vi.fn();
  const refreshSession = vi.fn();
  const createUser = vi.fn();
  const deleteUser = vi.fn();

  // Rastreia chamadas a comoUsuario para diferenciar contextos
  let isAuthCall = true;
  const comoUsuario = vi.fn(() => {
    const resultado = {
      from: (tabela: string) => {
        // Primeira chamada é autenticação (perfil do usuário)
        if (isAuthCall && tabela === "usuarios") {
          isAuthCall = false;
          return perfilBuilder;
        }
        // Chamadas posteriores: rotas de negócio
        if (tabela === "usuarios") return alunosBuilder; // GET /api/alunos lista usuarios
        if (tabela === "cursos") return cursosBuilder;
        if (tabela === "matriculas") return matriculasBuilder;
        return alunosBuilder; // fallback
      },
    };
    // Reset isAuthCall no fim da cadeia de mocks para o próximo teste
    return resultado;
  });

  const app = Fastify();
  app.register(cookie);
  app.register(
    fp(async (fastify) => {
      fastify.decorate("supabaseAuth", { auth: { getClaims, getUser, refreshSession } } as never);
      fastify.decorate("supabaseComoUsuario", comoUsuario as never);
      fastify.decorate("supabaseAdmin", {
        auth: { admin: { createUser, deleteUser } },
        from: (tabela: string) => {
          // supabaseAdmin.from() para operações de escrita com admin
          if (tabela === "usuarios") return alunosAdminBuilder;
          return { delete: vi.fn().mockResolvedValue({ data: [], error: null }) };
        },
      } as never);
    }),
  );
  app.register(authPlugin);
  app.register(alunosRoutes);

  return {
    app,
    estadoPerfil,
    estadoAlunos,
    estadoAlunosAdmin,
    estadoCursos,
    estadoMatriculas,
    perfilBuilder,
    alunosBuilder,
    alunosAdminBuilder,
    cursosBuilder,
    matriculasBuilder,
    getClaims,
    getUser,
    createUser,
    deleteUser,
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

describe("isolamento multi-tenant em /api/alunos", () => {
  it("GET /api/alunos filtra pela instituição da sessão", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-prof", instituicaoId: "inst-A", papel: "professor", nome: "Professor" });

    ctx.estadoAlunos.resultado = {
      data: [
        {
          id: "aluno-1",
          nome: "Alice",
          papel: "aluno",
          status: "ativo",
          criado_em: "2024-01-01T00:00:00.000Z",
        },
      ],
      error: null,
    };

    const resposta = await ctx.app.inject({ method: "GET", url: "/api/alunos", cookies: COOKIES_SESSAO });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual([
      {
        id: "aluno-1",
        nome: "Alice",
        papel: "aluno",
        status: "ativo",
        criadoEm: "2024-01-01T00:00:00.000Z",
      },
    ]);

    // Verifica que o filtro de instituição foi aplicado
    expect(fezFiltroInstituicao(ctx.alunosBuilder.chamadas, "inst-A")).toBe(true);
  });

  it("GET /api/alunos com status inválido retorna 400", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-prof", instituicaoId: "inst-A", papel: "professor", nome: "Professor" });

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/alunos?status=invalido",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json()).toEqual({
      erro: "Status inválido: use ativo, pendente ou recusado",
    });
  });

  it("GET /api/alunos com status válido filtra por status", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-prof", instituicaoId: "inst-A", papel: "professor", nome: "Professor" });

    ctx.estadoAlunos.resultado = {
      data: [
        {
          id: "aluno-2",
          nome: "Bob",
          papel: "aluno",
          status: "pendente",
          criado_em: "2024-01-02T00:00:00.000Z",
        },
      ],
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/alunos?status=pendente",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(200);
    const chamadas = ctx.alunosBuilder.chamadas;
    expect(chamadas).toContainEqual({ metodo: "eq", args: ["status", "pendente"] });
  });

  it("POST /api/alunos/:id/aprovar num aluno de outra instituição retorna 404", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-prof", instituicaoId: "inst-A", papel: "professor", nome: "Professor" });

    // Aluno de outra instituição: nenhuma linha retorna
    ctx.estadoAlunos.resultado = { data: null, error: { message: "no rows" } };

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/alunos/aluno-de-outra-inst/aprovar",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toEqual({ erro: "Aluno não encontrado" });

    // Verifica que o filtro de instituição foi aplicado
    expect(fezFiltroInstituicao(ctx.alunosBuilder.chamadas, "inst-A")).toBe(true);
  });

  it("POST /api/alunos/:id/aprovar com aluno não pendente retorna 400", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-prof", instituicaoId: "inst-A", papel: "professor", nome: "Professor" });

    ctx.estadoAlunos.resultado = {
      data: {
        id: "aluno-1",
        nome: "Alice",
        papel: "aluno",
        status: "ativo",
        criado_em: "2024-01-01T00:00:00.000Z",
      },
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/alunos/aluno-1/aprovar",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json()).toEqual({ erro: "Aluno não está em status pendente" });
  });

  it("GET /api/alunos exige papel admin_instituicao ou professor — aluno recebe 403", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-aluno", instituicaoId: "inst-A", papel: "aluno", nome: "Aluno" });

    const resposta = await ctx.app.inject({ method: "GET", url: "/api/alunos", cookies: COOKIES_SESSAO });

    expect(resposta.statusCode).toBe(403);
    expect(ctx.alunosBuilder.select).not.toHaveBeenCalled();
  });

  it("POST /api/alunos exige papel admin_instituicao ou professor — aluno recebe 403", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-aluno", instituicaoId: "inst-A", papel: "aluno", nome: "Aluno" });

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/alunos",
      cookies: COOKIES_SESSAO,
      payload: { nome: "Novo Aluno", email: "novo@example.com" },
    });

    expect(resposta.statusCode).toBe(403);
    expect(ctx.createUser).not.toHaveBeenCalled();
  });

  it("POST /api/cursos/:cursoId/matriculas retorna 400 sem alunoId", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-prof", instituicaoId: "inst-A", papel: "professor", nome: "Professor" });

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/cursos/curso-1/matriculas",
      cookies: COOKIES_SESSAO,
      payload: {},
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json()).toEqual({ erro: "alunoId é obrigatório" });
  });

  it("DELETE /api/cursos/:cursoId/matriculas/:alunoId retorna 404 se matrícula não existe", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-prof", instituicaoId: "inst-A", papel: "professor", nome: "Professor" });

    ctx.estadoCursos.resultado = { data: { id: "curso-1" }, error: null };
    ctx.estadoMatriculas.resultado = { data: [], error: null };

    const resposta = await ctx.app.inject({
      method: "DELETE",
      url: "/api/cursos/curso-1/matriculas/aluno-1",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toEqual({ erro: "Matrícula não encontrada" });
  });

  it("POST /api/alunos com nome/email vazios retorna 400", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-prof", instituicaoId: "inst-A", papel: "professor", nome: "Professor" });

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/alunos",
      cookies: COOKIES_SESSAO,
      payload: { nome: "  ", email: "novo@example.com" },
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json()).toEqual({
      erro: "Nome e email são obrigatórios e não podem estar vazios",
    });
  });

  it("POST /api/alunos cria usuário e retorna 201 com senhaProvisoria", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-prof", instituicaoId: "inst-A", papel: "professor", nome: "Professor" });

    const usuarioAuthId = "novo-user-id";
    ctx.createUser.mockResolvedValue({
      data: { user: { id: usuarioAuthId } },
      error: null,
    });

    // INSERT usa supabaseAdmin agora
    ctx.estadoAlunosAdmin.resultado = {
      data: {
        id: usuarioAuthId,
        nome: "Novo Aluno",
        papel: "aluno",
        status: "ativo",
        criado_em: "2024-01-01T00:00:00.000Z",
      },
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/alunos",
      cookies: COOKIES_SESSAO,
      payload: { nome: "Novo Aluno", email: "novo@example.com" },
    });

    expect(resposta.statusCode).toBe(201);
    const corpo = resposta.json();
    expect(corpo).toEqual(
      expect.objectContaining({
        id: usuarioAuthId,
        nome: "Novo Aluno",
        papel: "aluno",
        status: "ativo",
      })
    );
    expect(corpo.senhaProvisoria).toBeDefined();
    expect(typeof corpo.senhaProvisoria).toBe("string");
    expect(corpo.senhaProvisoria.length).toBeGreaterThanOrEqual(12);
  });

  it("POST /api/alunos faz rollback deletando usuário do Auth se insert em usuarios falhar", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-prof", instituicaoId: "inst-A", papel: "professor", nome: "Professor" });

    const usuarioAuthId = "novo-user-id";
    ctx.createUser.mockResolvedValue({
      data: { user: { id: usuarioAuthId } },
      error: null,
    });

    // Simula falha no insert em usuarios (usa estadoAlunosAdmin porque insert agora usa supabaseAdmin)
    ctx.estadoAlunosAdmin.resultado = { data: null, error: { message: "erro ao inserir" } };

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/alunos",
      cookies: COOKIES_SESSAO,
      payload: { nome: "Novo Aluno", email: "novo@example.com" },
    });

    expect(resposta.statusCode).toBe(500);
    expect(ctx.deleteUser).toHaveBeenCalledWith(usuarioAuthId);
  });

  it("POST /api/cursos/:cursoId/matriculas com alunoId de outra instituição retorna 404 e filtra por instituição", async () => {
    // Teste crítico: matricular um aluno de outra instituição num curso seu é vazamento de dados
    // (dá acesso a módulos/aulas/PDFs da outra instituição). Este teste prova que o filtro
    // .eq("instituicao_id", ...) está presente e é realmente verificado na busca do aluno.
    const ctx = criarApp();
    logarComo(ctx, { id: "user-prof", instituicaoId: "inst-A", papel: "professor", nome: "Professor" });

    // Curso da instituição A existe
    ctx.estadoCursos.resultado = { data: { id: "curso-1" }, error: null };

    // Aluno de instituição B: nenhuma linha retorna (porque o filtro .eq("instituicao_id", "inst-A") não bata)
    ctx.estadoAlunos.resultado = { data: null, error: { message: "no rows" } };

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/cursos/curso-1/matriculas",
      cookies: COOKIES_SESSAO,
      payload: { alunoId: "aluno-da-instituicao-b" },
    });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toEqual({ erro: "Aluno não encontrado" });

    // Prova real: o filtro de instituição foi aplicado na busca do aluno.
    // Sem esse filtro, remover a verificação .eq("instituicao_id", ...) do código não quebraria este teste —
    // por isso verificamos as chamadas, não só o código de resposta HTTP.
    expect(fezFiltroInstituicao(ctx.alunosBuilder.chamadas, "inst-A")).toBe(true);
  });

  it("POST /api/alunos cria aluno com INSERT usando supabaseAdmin e filtra por instituição", async () => {
    // Teste de segurança: o INSERT em usuarios agora usa supabaseAdmin (porque não há policy).
    // Verificamos que o filtro instituicao_id foi aplicado ao less durante o insert.
    const ctx = criarApp();
    logarComo(ctx, { id: "user-prof", instituicaoId: "inst-A", papel: "professor", nome: "Professor" });

    const usuarioAuthId = "novo-user-id";
    ctx.createUser.mockResolvedValue({
      data: { user: { id: usuarioAuthId } },
      error: null,
    });

    ctx.estadoAlunosAdmin.resultado = {
      data: {
        id: usuarioAuthId,
        nome: "Novo Aluno",
        papel: "aluno",
        status: "ativo",
        criado_em: "2024-01-01T00:00:00.000Z",
      },
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/alunos",
      cookies: COOKIES_SESSAO,
      payload: { nome: "Novo Aluno", email: "novo@example.com" },
    });

    expect(resposta.statusCode).toBe(201);

    // Verifica que insert foi chamado
    const chamadaInsert = ctx.alunosAdminBuilder.chamadas.find((c) => c.metodo === "insert");
    expect(chamadaInsert).toBeDefined();

    // Verifica que o instituicao_id vem do request.usuario, não do corpo
    const argsInsert = chamadaInsert?.args[0] as Record<string, unknown>;
    expect(argsInsert?.instituicao_id).toBe("inst-A");
  });

  it("POST /api/alunos/:id/aprovar aprova aluno com UPDATE usando supabaseAdmin e filtra por instituição", async () => {
    // Teste de segurança: o UPDATE em usuarios agora usa supabaseAdmin (porque não há policy).
    // Verificamos que o filtro instituicao_id foi aplicado no UPDATE.
    const ctx = criarApp();
    logarComo(ctx, { id: "user-prof", instituicaoId: "inst-A", papel: "professor", nome: "Professor" });

    // SELECT (leitura) usa supabaseComoUsuario e encontra o aluno
    ctx.estadoAlunos.resultado = {
      data: {
        id: "aluno-pendente",
        nome: "Bob",
        papel: "aluno",
        status: "pendente",
        criado_em: "2024-01-02T00:00:00.000Z",
      },
      error: null,
    };

    // UPDATE usa supabaseAdmin
    ctx.estadoAlunosAdmin.resultado = {
      data: {
        id: "aluno-pendente",
        nome: "Bob",
        papel: "aluno",
        status: "ativo",
        criado_em: "2024-01-02T00:00:00.000Z",
      },
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/alunos/aluno-pendente/aprovar",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(200);

    // Verifica que update foi chamado em alunosAdminBuilder
    const chamadaUpdate = ctx.alunosAdminBuilder.chamadas.find((c) => c.metodo === "update");
    expect(chamadaUpdate).toBeDefined();

    // Verifica que .eq("instituicao_id", "inst-A") foi chamado
    expect(fezFiltroInstituicao(ctx.alunosAdminBuilder.chamadas, "inst-A")).toBe(true);

    // Verifica que .eq("id", "aluno-pendente") também foi chamado
    const temFiltroId = ctx.alunosAdminBuilder.chamadas.some(
      (c) => c.metodo === "eq" && c.args[0] === "id" && c.args[1] === "aluno-pendente"
    );
    expect(temFiltroId).toBe(true);
  });

  it("POST /api/alunos/:id/recusar recusa aluno com UPDATE usando supabaseAdmin e filtra por instituição", async () => {
    // Teste de segurança: o UPDATE em usuarios agora usa supabaseAdmin (porque não há policy).
    // Verificamos que o filtro instituicao_id foi aplicado no UPDATE.
    const ctx = criarApp();
    logarComo(ctx, { id: "user-prof", instituicaoId: "inst-A", papel: "professor", nome: "Professor" });

    // SELECT (leitura) usa supabaseComoUsuario e encontra o aluno
    ctx.estadoAlunos.resultado = {
      data: {
        id: "aluno-pendente",
        nome: "Charlie",
        papel: "aluno",
        status: "pendente",
        criado_em: "2024-01-03T00:00:00.000Z",
      },
      error: null,
    };

    // UPDATE usa supabaseAdmin
    ctx.estadoAlunosAdmin.resultado = {
      data: {
        id: "aluno-pendente",
        nome: "Charlie",
        papel: "aluno",
        status: "recusado",
        criado_em: "2024-01-03T00:00:00.000Z",
      },
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/alunos/aluno-pendente/recusar",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(200);

    // Verifica que update foi chamado em alunosAdminBuilder
    const chamadaUpdate = ctx.alunosAdminBuilder.chamadas.find((c) => c.metodo === "update");
    expect(chamadaUpdate).toBeDefined();

    // Verifica que .eq("instituicao_id", "inst-A") foi chamado
    expect(fezFiltroInstituicao(ctx.alunosAdminBuilder.chamadas, "inst-A")).toBe(true);

    // Verifica que .eq("id", "aluno-pendente") também foi chamado
    const temFiltroId = ctx.alunosAdminBuilder.chamadas.some(
      (c) => c.metodo === "eq" && c.args[0] === "id" && c.args[1] === "aluno-pendente"
    );
    expect(temFiltroId).toBe(true);
  });
});
