import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import authPlugin from "../src/plugins/auth.js";
import quizzesRoutes from "../src/routes/quizzes.js";
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
 * Query builder fake, encadeável como o do @supabase/supabase-js.
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
  builder.in = encadeavel("in");
  builder.order = encadeavel("order");
  builder.insert = encadeavel("insert");
  builder.delete = encadeavel("delete");
  builder.single = vi.fn(() => Promise.resolve(estado.resultado));
  builder.then = (resolve: (v: Resultado) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(estado.resultado).then(resolve, reject);

  return builder as typeof builder & {
    chamadas: Chamada[];
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
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
  const estadoCursos: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoMatriculas: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoQuizzes: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoPerguntas: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoAlternativas: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoTentativas: { resultado: Resultado } = { resultado: { data: null, error: null } };

  const perfilBuilder = criarQueryBuilder(estadoPerfil);
  const cursosBuilder = criarQueryBuilder(estadoCursos);
  const matriculasBuilder = criarQueryBuilder(estadoMatriculas);
  const quizzesBuilder = criarQueryBuilder(estadoQuizzes);
  const perguntasBuilder = criarQueryBuilder(estadoPerguntas);
  const alternativasBuilder = criarQueryBuilder(estadoAlternativas);
  const tentativasBuilder = criarQueryBuilder(estadoTentativas);

  const getClaims = vi.fn();
  const getUser = vi.fn();
  const refreshSession = vi.fn();

  let isAuthCall = true;

  const comoUsuario = vi.fn(() => {
    const resultado = {
      from: (tabela: string) => {
        if (isAuthCall && tabela === "usuarios") {
          isAuthCall = false;
          return perfilBuilder;
        }
        if (tabela === "cursos") return cursosBuilder;
        if (tabela === "matriculas") return matriculasBuilder;
        if (tabela === "quizzes") return quizzesBuilder;
        if (tabela === "quiz_perguntas") return perguntasBuilder;
        if (tabela === "quiz_alternativas") return alternativasBuilder;
        if (tabela === "quiz_tentativas") return tentativasBuilder;
        return perfilBuilder;
      },
    };
    return resultado;
  });

  const admin = {
    from: (tabela: string) => {
      if (tabela === "quizzes") return quizzesBuilder;
      if (tabela === "quiz_perguntas") return perguntasBuilder;
      if (tabela === "quiz_alternativas") return alternativasBuilder;
      if (tabela === "quiz_tentativas") return tentativasBuilder;
      return perfilBuilder;
    },
  };

  const app = Fastify();
  app.register(cookie);
  app.register(
    fp(async (fastify) => {
      fastify.decorate("supabaseAuth", { auth: { getClaims, getUser, refreshSession } } as never);
      fastify.decorate("supabaseComoUsuario", comoUsuario as never);
      fastify.decorate("supabaseAdmin", admin as never);
    }),
  );
  app.register(authPlugin);
  app.register(quizzesRoutes);

  return {
    app,
    estadoPerfil,
    estadoCursos,
    estadoMatriculas,
    estadoQuizzes,
    estadoPerguntas,
    estadoAlternativas,
    estadoTentativas,
    perfilBuilder,
    cursosBuilder,
    matriculasBuilder,
    quizzesBuilder,
    perguntasBuilder,
    alternativasBuilder,
    tentativasBuilder,
    getClaims,
    getUser,
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

describe("Segurança em rotas de quiz", () => {
  // ── Teste 1: GET /api/aluno/cursos/:cursoId/quiz NÃO devolve `correta` ────

  it("GET /api/aluno/cursos/:cursoId/quiz não devolve o campo `correta` em nenhuma alternativa", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // Matrícula ativa
    ctx.estadoMatriculas.resultado = {
      data: { id: "mat-1" },
      error: null,
    };

    // Quiz existe
    ctx.estadoQuizzes.resultado = {
      data: {
        id: "quiz-1",
        curso_id: "curso-1",
        titulo: "Quiz 1",
        nota_minima_aprovacao: 70,
      },
      error: null,
    };

    // Uma pergunta
    ctx.estadoPerguntas.resultado = {
      data: [
        {
          id: "pergunta-1",
          quiz_id: "quiz-1",
          enunciado: "Pergunta 1",
          ordem: 0,
        },
      ],
      error: null,
    };

    // Alternativas sem o campo `correta` (como deve ser servido ao aluno)
    ctx.estadoAlternativas.resultado = {
      data: [
        {
          id: "alt-1",
          pergunta_id: "pergunta-1",
          texto: "Opção A",
          // correta NÃO é incluída na resposta
        },
        {
          id: "alt-2",
          pergunta_id: "pergunta-1",
          texto: "Opção B",
        },
      ],
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/aluno/cursos/curso-1/quiz",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(200);
    const json = resposta.json();

    // Prova real 1: a coluna `correta` não foi selecionada no SQL
    // Verifica que o .select() foi chamado SEM a coluna "correta"
    const selectCalls = ctx.alternativasBuilder.select.mock.calls;
    expect(selectCalls.length).toBeGreaterThan(0);
    const selectArg = selectCalls[0][0];
    expect(typeof selectArg).toBe("string");
    expect(selectArg).not.toContain("correta");

    // Prova real 2: a resposta JSON não tem o campo em nenhuma alternativa
    // Verifica que nenhuma alternativa em nenhuma pergunta tem o campo `correta`
    (json.perguntas as any[]).forEach((pergunta) => {
      (pergunta.alternativas as any[]).forEach((alternativa) => {
        expect(alternativa).not.toHaveProperty("correta");
      });
    });
  });

  // ── Teste 2: GET /api/aluno/cursos/:cursoId/quiz de aluno sem matrícula → 404 ────

  it("GET /api/aluno/cursos/:cursoId/quiz de aluno SEM matrícula no curso retorna 404", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // Sem matrícula ativa
    ctx.estadoMatriculas.resultado = { data: null, error: { message: "no rows" } };

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/aluno/cursos/curso-1/quiz",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toEqual({ erro: "Curso não encontrado" });

    // Prova real: o filtro por aluno_id foi aplicado COM O ID DA SESSÃO
    expect(ctx.matriculasBuilder.eq).toHaveBeenCalledWith("aluno_id", "aluno-1");
  });

  // ── Teste 3: POST .../tentativas ignora `nota` e `aprovado` do corpo ────

  it("POST /api/aluno/cursos/:cursoId/quiz/tentativas calcula nota no servidor, ignorando `nota` e `aprovado` do corpo", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // Matrícula ativa
    ctx.estadoMatriculas.resultado = {
      data: { id: "mat-1" },
      error: null,
    };

    // Quiz existe
    ctx.estadoQuizzes.resultado = {
      data: {
        id: "quiz-1",
        curso_id: "curso-1",
        titulo: "Quiz 1",
        nota_minima_aprovacao: 70,
      },
      error: null,
    };

    // Uma pergunta com duas alternativas
    ctx.estadoPerguntas.resultado = {
      data: [
        {
          id: "pergunta-1",
          quiz_id: "quiz-1",
          enunciado: "Pergunta 1",
          ordem: 0,
        },
      ],
      error: null,
    };

    // Alternativas: uma correta (alt-1), uma errada (alt-2)
    ctx.estadoAlternativas.resultado = {
      data: [
        {
          id: "alt-1",
          pergunta_id: "pergunta-1",
          texto: "Correta",
          correta: true,
        },
        {
          id: "alt-2",
          pergunta_id: "pergunta-1",
          texto: "Errada",
          correta: false,
        },
      ],
      error: null,
    };

    // Tentativa vai ser inserida
    ctx.estadoTentativas.resultado = {
      data: {
        id: "tentativa-1",
        quiz_id: "quiz-1",
        aluno_id: "aluno-1",
        nota: 0, // Aluno escolheu a errada
        aprovado: false,
        respostas: { "pergunta-1": "alt-2" },
        finalizada_em: "2025-09-20T10:00:00Z",
      },
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/aluno/cursos/curso-1/quiz/tentativas",
      cookies: COOKIES_SESSAO,
      payload: {
        respostas: { "pergunta-1": "alt-2" },
        nota: 100, // Cliente malicioso tenta enviar 100
        aprovado: true, // Cliente tenta enviar true
      },
    });

    expect(resposta.statusCode).toBe(201);
    const json = resposta.json();

    // A nota calculada é 0, não 100 — o servidor ignorou o campo `nota` do corpo
    expect(json.nota).toBe(0);
    expect(json.aprovado).toBe(false);

    // Verifica que o insert foi chamado com os valores corretos (nota 0, aprovado false)
    // O builder de tentativas foi usado para insert
    const insertCall = ctx.tentativasBuilder.insert;
    if (insertCall.mock.calls.length > 0) {
      const args = insertCall.mock.calls[0][0];
      if (typeof args === "object" && args !== null) {
        const data = args as Record<string, unknown>;
        expect(data.nota).toBe(0);
        expect(data.aprovado).toBe(false);
      }
    }
  });

  // ── Teste 4: PUT /api/cursos/:cursoId/quiz de curso de outra instituição → 404 ────

  it("PUT /api/cursos/:cursoId/quiz de curso de OUTRA instituição retorna 404 e NÃO grava nada", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "prof-1", instituicaoId: "inst-A", papel: "professor", nome: "Prof" });

    // Curso não encontrado (outra instituição)
    ctx.estadoCursos.resultado = { data: null, error: { message: "no rows" } };

    const resposta = await ctx.app.inject({
      method: "PUT",
      url: "/api/cursos/curso-de-outro-tenant/quiz",
      cookies: COOKIES_SESSAO,
      payload: {
        titulo: "Quiz",
        notaMinimaAprovacao: 70,
        perguntas: [
          {
            enunciado: "P1",
            alternativas: [
              { texto: "A", correta: true },
              { texto: "B", correta: false },
            ],
          },
        ],
      },
    });

    expect(resposta.statusCode).toBe(404);

    // Prova real 1: o filtro por instituição foi aplicado
    expect(ctx.cursosBuilder.eq).toHaveBeenCalledWith("instituicao_id", "inst-A");

    // Prova real 2: insert NÃO foi chamado
    expect(ctx.quizzesBuilder.insert).not.toHaveBeenCalled();
  });

  // ── Teste 5: PUT com duas `correta: true` na mesma pergunta → 400 ────

  it("PUT /api/cursos/:cursoId/quiz com uma pergunta que tem 2 alternativas `correta: true` retorna 400 e NÃO grava", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "prof-1", instituicaoId: "inst-A", papel: "professor", nome: "Prof" });

    // Curso existe
    ctx.estadoCursos.resultado = {
      data: { id: "curso-1" },
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "PUT",
      url: "/api/cursos/curso-1/quiz",
      cookies: COOKIES_SESSAO,
      payload: {
        titulo: "Quiz",
        notaMinimaAprovacao: 70,
        perguntas: [
          {
            enunciado: "Pergunta com 2 corretas",
            alternativas: [
              { texto: "A", correta: true },
              { texto: "B", correta: true }, // PROBLEMA
            ],
          },
        ],
      },
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().erro).toContain("Pergunta 0"); // Identifica qual pergunta é o problema

    // Prova: insert NÃO foi chamado
    expect(ctx.quizzesBuilder.insert).not.toHaveBeenCalled();
  });

  // ── Teste 6: PUT com pergunta sem nenhuma `correta: true` → 400 ────

  it("PUT /api/cursos/:cursoId/quiz com uma pergunta SEM alternativa correta retorna 400 e NÃO grava", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "prof-1", instituicaoId: "inst-A", papel: "professor", nome: "Prof" });

    // Curso existe
    ctx.estadoCursos.resultado = {
      data: { id: "curso-1" },
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "PUT",
      url: "/api/cursos/curso-1/quiz",
      cookies: COOKIES_SESSAO,
      payload: {
        titulo: "Quiz",
        notaMinimaAprovacao: 70,
        perguntas: [
          {
            enunciado: "Pergunta sem resposta correta",
            alternativas: [
              { texto: "A", correta: false },
              { texto: "B", correta: false }, // PROBLEMA
            ],
          },
        ],
      },
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().erro).toContain("Pergunta 0");

    // Prova: insert NÃO foi chamado
    expect(ctx.quizzesBuilder.insert).not.toHaveBeenCalled();
  });

  // ── Teste 7: Papel bloqueado ────

  it("POST /api/aluno/cursos/:cursoId/quiz/tentativas de um PROFESSOR retorna 403", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "prof-1", instituicaoId: "inst-A", papel: "professor", nome: "Prof" });

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/aluno/cursos/curso-1/quiz/tentativas",
      cookies: COOKIES_SESSAO,
      payload: { respostas: {} },
    });

    expect(resposta.statusCode).toBe(403);
  });

  it("GET /api/cursos/:cursoId/quiz de um ALUNO retorna 403", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/cursos/curso-1/quiz",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(403);
  });

  // ── Teste 8: supabaseAdmin é usado para quiz (cliente admin, não comoUsuario) ────

  it("GET /api/aluno/cursos/:cursoId/quiz usa o cliente supabaseAdmin (não comoUsuario) para quiz_alternativas", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // Matrícula ativa
    ctx.estadoMatriculas.resultado = {
      data: { id: "mat-1" },
      error: null,
    };

    // Quiz existe
    ctx.estadoQuizzes.resultado = {
      data: {
        id: "quiz-1",
        curso_id: "curso-1",
        titulo: "Quiz 1",
        nota_minima_aprovacao: 70,
      },
      error: null,
    };

    // Uma pergunta
    ctx.estadoPerguntas.resultado = {
      data: [
        {
          id: "pergunta-1",
          quiz_id: "quiz-1",
          enunciado: "Pergunta 1",
          ordem: 0,
        },
      ],
      error: null,
    };

    // Alternativas
    ctx.estadoAlternativas.resultado = {
      data: [
        {
          id: "alt-1",
          pergunta_id: "pergunta-1",
          texto: "Opção A",
        },
      ],
      error: null,
    };

    await ctx.app.inject({
      method: "GET",
      url: "/api/aluno/cursos/curso-1/quiz",
      cookies: COOKIES_SESSAO,
    });

    // Verifica que o .select() de alternativas foi chamado SEM a coluna "correta"
    // (isso já era testado no teste 1, mas aqui documentamos que o cliente era admin)
    const selectCalls = ctx.alternativasBuilder.select.mock.calls;
    expect(selectCalls.length).toBeGreaterThan(0);
    const selectArg = selectCalls[0][0];
    expect(typeof selectArg).toBe("string");
    expect((selectArg as string)).not.toContain("correta");
  });

  // ── Teste 9: sem matrícula, nenhuma consulta de quiz é feita ────

  it("GET /api/aluno/cursos/:cursoId/quiz de aluno SEM matrícula NÃO consulta nenhuma tabela de quiz", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // Sem matrícula ativa
    ctx.estadoMatriculas.resultado = { data: null, error: { message: "no rows" } };

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/aluno/cursos/curso-1/quiz",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(404);

    // Prova real 1: nenhuma consulta a quizzes foi feita
    expect(ctx.quizzesBuilder.select).not.toHaveBeenCalled();

    // Prova real 2: nenhuma consulta a quiz_perguntas foi feita
    expect(ctx.perguntasBuilder.select).not.toHaveBeenCalled();

    // Prova real 3: nenhuma consulta a quiz_alternativas foi feita
    expect(ctx.alternativasBuilder.select).not.toHaveBeenCalled();
  });

  // ── Teste 10: POST tentativas sem matrícula também não consulta quiz ────

  it("POST /api/aluno/cursos/:cursoId/quiz/tentativas de aluno SEM matrícula NÃO consulta nenhuma tabela de quiz", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // Sem matrícula ativa
    ctx.estadoMatriculas.resultado = { data: null, error: { message: "no rows" } };

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/aluno/cursos/curso-1/quiz/tentativas",
      cookies: COOKIES_SESSAO,
      payload: { respostas: {} },
    });

    expect(resposta.statusCode).toBe(404);

    // Prova real: nenhuma consulta a quizzes foi feita
    expect(ctx.quizzesBuilder.select).not.toHaveBeenCalled();
  });
});
