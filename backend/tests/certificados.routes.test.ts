// Testes de emissão e validação de certificados:
// - R1: Certificado só é emitido se o curso está REALMENTE concluído (todas as aulas + quiz aprovado)
// - R2: Código de validação é aleatório, legível, com 12+ caracteres
// - R3: Emissão é idempotente (se já existe, devolve o existente)
// - R4: Rota pública usa supabaseAdmin, rotas de aluno usam supabaseComoUsuario
// - R5: Página pública revela o mínimo (nome aluno, curso, instituição, data) — sem email/ids/scores
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import authPlugin from "../src/plugins/auth.js";
import certificadosRoutes from "../src/routes/certificados.js";
import { COOKIE_ACCESS } from "../src/lib/sessao.js";

interface Resultado {
  data: unknown;
  error: unknown;
}

interface Chamada {
  metodo: string;
  args: unknown[];
}

function criarQueryBuilder(estado: { resultado: Resultado; resultadoAlt?: Resultado }) {
  const chamadas: Chamada[] = [];
  const builder: Record<string, unknown> = { chamadas };
  let singleCallCount = 0;

  const encadeavel = (nome: string) =>
    vi.fn((...args: unknown[]) => {
      chamadas.push({ metodo: nome, args });
      return builder;
    });

  builder.select = encadeavel("select");
  builder.eq = encadeavel("eq");
  builder.in = encadeavel("in");
  builder.insert = encadeavel("insert");
  builder.single = vi.fn(() => {
    // Retorna resultadoAlt na segunda chamada (após insert), senão resultado normal
    const shouldUseAlt = estado.resultadoAlt && singleCallCount > 0;
    singleCallCount++;
    const response = shouldUseAlt ? estado.resultadoAlt : estado.resultado;
    return Promise.resolve(response);
  });
  builder.then = (resolve: (v: Resultado) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(estado.resultado).then(resolve, reject);

  return builder as typeof builder & {
    chamadas: Chamada[];
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
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
  const estadoMatriculas: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoCursos: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoModulos: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoAulas: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoProgresso: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoCertificados: { resultado: Resultado; resultadoAlt?: Resultado } = { resultado: { data: null, error: null } };
  const estadoQuizzes: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoQuizTentativas: { resultado: Resultado } = { resultado: { data: null, error: null } };

  const perfilBuilder = criarQueryBuilder(estadoPerfil);
  const matriculasBuilder = criarQueryBuilder(estadoMatriculas);
  const cursosBuilder = criarQueryBuilder(estadoCursos);
  const modulosBuilder = criarQueryBuilder(estadoModulos);
  const aulasBuilder = criarQueryBuilder(estadoAulas);
  const progressoBuilder = criarQueryBuilder(estadoProgresso);
  const certificadosBuilder = criarQueryBuilder(estadoCertificados);
  const quizzesBuilder = criarQueryBuilder(estadoQuizzes);
  const quizTentativasBuilder = criarQueryBuilder(estadoQuizTentativas);

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
        if (tabela === "matriculas") return matriculasBuilder;
        if (tabela === "cursos") return cursosBuilder;
        if (tabela === "modulos") return modulosBuilder;
        if (tabela === "aulas") return aulasBuilder;
        if (tabela === "progresso_aulas") return progressoBuilder;
        if (tabela === "certificados") return certificadosBuilder;
        if (tabela === "quizzes") return quizzesBuilder;
        if (tabela === "quiz_tentativas") return quizTentativasBuilder;
        return perfilBuilder;
      },
    };
    return resultado;
  });

  const supabaseAdmin = {
    from: (tabela: string) => {
      if (tabela === "certificados") return certificadosBuilder;
      return certificadosBuilder;
    },
  };

  const app = Fastify();
  app.register(cookie);
  app.register(
    fp(async (fastify) => {
      fastify.decorate("supabaseAuth", { auth: { getClaims, getUser, refreshSession } } as never);
      fastify.decorate("supabaseComoUsuario", comoUsuario as never);
      fastify.decorate("supabaseAdmin", supabaseAdmin as never);
    }),
  );
  app.register(authPlugin);
  app.register(certificadosRoutes);

  return {
    app,
    estadoPerfil,
    estadoMatriculas,
    estadoCursos,
    estadoModulos,
    estadoAulas,
    estadoProgresso,
    estadoCertificados,
    estadoQuizzes,
    estadoQuizTentativas,
    perfilBuilder,
    matriculasBuilder,
    cursosBuilder,
    modulosBuilder,
    aulasBuilder,
    progressoBuilder,
    certificadosBuilder,
    quizzesBuilder,
    quizTentativasBuilder,
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

describe("emissão e validação de certificados", () => {
  // Teste 1: POST .../certificado com curso incompleto (nem todas aulas) → 409, sem escrita
  it("POST /api/aluno/cursos/:cursoId/certificado com curso incompleto (aulas) retorna 409 e NÃO chama insert", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // Matrícula ativa existe
    ctx.estadoMatriculas.resultado = {
      data: { id: "mat-1", curso_id: "curso-1", status: "ativa" },
      error: null,
    };

    // Curso pertence à instituição
    ctx.estadoCursos.resultado = {
      data: { id: "curso-1", instituicao_id: "inst-A" },
      error: null,
    };

    // Certificado não existe ainda
    ctx.estadoCertificados.resultado = {
      data: null,
      error: { code: "PGRST116" },
    };

    // Módulos existem
    ctx.estadoModulos.resultado = {
      data: [{ id: "mod-1" }],
      error: null,
    };

    // Aulas existem: 3 total
    ctx.estadoAulas.resultado = {
      data: [{ id: "aula-1" }, { id: "aula-2" }, { id: "aula-3" }],
      error: null,
    };

    // Progresso: só 2 concluídas
    ctx.estadoProgresso.resultado = {
      data: [
        { aula_id: "aula-1", concluida: true },
        { aula_id: "aula-2", concluida: true },
      ],
      error: null,
    };

    // Não há quiz
    ctx.estadoQuizzes.resultado = {
      data: null,
      error: { code: "PGRST116" },
    };

    // Setup insert response (será usado se o código buggado tentar inserir)
    ctx.estadoCertificados.resultado = {
      data: null,
      error: { code: "PGRST116" },
    };
    ctx.estadoCertificados.resultadoAlt = {
      data: {
        id: "cert-1",
        codigo_validacao: "ABC123DEF456",
        emitido_em: "2026-09-20T10:00:00Z",
      },
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/aluno/cursos/curso-1/certificado",
      cookies: COOKIES_SESSAO,
    });

    // Prova de isolamento: progresso_aulas foi consultado APENAS para a matrícula do próprio aluno
    expect(ctx.progressoBuilder.eq).toHaveBeenCalledWith("matricula_id", "mat-1");

    // Prova real: insert NUNCA foi chamado — este é o comportamento crítico
    expect(ctx.certificadosBuilder.insert).not.toHaveBeenCalled();

    // Só depois, verifica o status code
    expect(resposta.statusCode).toBe(409);
    const body = resposta.json() as any;
    expect(body.aulasConcluidas).toBe(2);
    expect(body.totalAulas).toBe(3);
  });

  // Teste 2: POST .../certificado com aulas ok mas quiz NÃO aprovado → 409, sem escrita
  it("POST /api/aluno/cursos/:cursoId/certificado com quiz não aprovado retorna 409 e NÃO chama insert", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // Matrícula ativa
    ctx.estadoMatriculas.resultado = {
      data: { id: "mat-1", curso_id: "curso-1", status: "ativa" },
      error: null,
    };

    // Curso pertence à instituição
    ctx.estadoCursos.resultado = {
      data: { id: "curso-1", instituicao_id: "inst-A" },
      error: null,
    };

    // Certificado não existe
    ctx.estadoCertificados.resultado = {
      data: null,
      error: { code: "PGRST116" },
    };

    // Módulos existem
    ctx.estadoModulos.resultado = {
      data: [{ id: "mod-1" }],
      error: null,
    };

    // Aulas: 2 total
    ctx.estadoAulas.resultado = {
      data: [{ id: "aula-1" }, { id: "aula-2" }],
      error: null,
    };

    // Progresso: todas concluídas
    ctx.estadoProgresso.resultado = {
      data: [
        { aula_id: "aula-1", concluida: true },
        { aula_id: "aula-2", concluida: true },
      ],
      error: null,
    };

    // Quiz existe
    ctx.estadoQuizzes.resultado = {
      data: { id: "quiz-1" },
      error: null,
    };

    // Mas tentativa aprovada NÃO existe
    ctx.estadoQuizTentativas.resultado = {
      data: null,
      error: { code: "PGRST116" },
    };

    // Setup insert response (será usado se o código buggado tentar inserir)
    ctx.estadoCertificados.resultado = {
      data: null,
      error: { code: "PGRST116" },
    };
    ctx.estadoCertificados.resultadoAlt = {
      data: {
        id: "cert-1",
        codigo_validacao: "ABC123DEF456",
        emitido_em: "2026-09-20T10:00:00Z",
      },
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/aluno/cursos/curso-1/certificado",
      cookies: COOKIES_SESSAO,
    });

    // Prova de isolamento: progresso_aulas foi consultado com a matrícula do próprio aluno
    expect(ctx.progressoBuilder.eq).toHaveBeenCalledWith("matricula_id", "mat-1");

    // Prova real: insert NUNCA foi chamado — este é o comportamento crítico
    expect(ctx.certificadosBuilder.insert).not.toHaveBeenCalled();

    // Só depois, verifica o status code
    expect(resposta.statusCode).toBe(409);
    expect(resposta.json()).toEqual(
      expect.objectContaining({
        quizAprovado: false,
      })
    );
  });

  // Teste 3: POST com tudo concluído → 201, e o insert recebe a matrícula do próprio aluno
  it("POST /api/aluno/cursos/:cursoId/certificado com tudo concluído emite certificado e verifica matricula_id", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // Matrícula ativa
    ctx.estadoMatriculas.resultado = {
      data: { id: "mat-1", curso_id: "curso-1", status: "ativa" },
      error: null,
    };

    // Curso pertence à instituição
    ctx.estadoCursos.resultado = {
      data: { id: "curso-1", instituicao_id: "inst-A", titulo: "Curso A" },
      error: null,
    };

    // Certificado não existe
    ctx.estadoCertificados.resultado = {
      data: null,
      error: { code: "PGRST116" },
    };

    // Módulos existem
    ctx.estadoModulos.resultado = {
      data: [{ id: "mod-1" }],
      error: null,
    };

    // Aulas: 2 total
    ctx.estadoAulas.resultado = {
      data: [{ id: "aula-1" }, { id: "aula-2" }],
      error: null,
    };

    // Progresso: todas concluídas
    ctx.estadoProgresso.resultado = {
      data: [
        { aula_id: "aula-1", concluida: true },
        { aula_id: "aula-2", concluida: true },
      ],
      error: null,
    };

    // Sem quiz
    ctx.estadoQuizzes.resultado = {
      data: null,
      error: { code: "PGRST116" },
    };

    // Configurar certificado como não existente na primeira chamada (check existente)
    // E retornar os dados do novo certificado na segunda chamada (insert result)
    ctx.estadoCertificados.resultado = {
      data: null,
      error: { code: "PGRST116" },
    };
    ctx.estadoCertificados.resultadoAlt = {
      data: {
        id: "cert-1",
        codigo_validacao: "ABC123DEF456",
        emitido_em: "2026-09-20T10:00:00Z",
      },
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/aluno/cursos/curso-1/certificado",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(201);

    // Prova real: insert foi chamado COM a matrícula do aluno
    expect(ctx.certificadosBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        matricula_id: "mat-1",
      })
    );
  });

  // Teste 4: POST quando já existe certificado → devolve o existente, SEM chamar insert de novo
  it("POST /api/aluno/cursos/:cursoId/certificado quando já existe retorna o existente sem novo insert", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // Matrícula ativa
    ctx.estadoMatriculas.resultado = {
      data: { id: "mat-1", curso_id: "curso-1", status: "ativa" },
      error: null,
    };

    // Curso pertence à instituição (com título preenchido)
    ctx.estadoCursos.resultado = {
      data: { id: "curso-1", instituicao_id: "inst-A", titulo: "Curso Exemplo" },
      error: null,
    };

    // Certificado JÁ existe
    ctx.estadoCertificados.resultado = {
      data: {
        id: "cert-1",
        codigo_validacao: "ABC123DEF456",
        emitido_em: "2026-09-20T10:00:00Z",
      },
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/aluno/cursos/curso-1/certificado",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(200);
    const body = resposta.json() as any;
    expect(body.codigoValidacao).toBe("ABC123DEF456");

    // Prova real: insert NUNCA foi chamado (R3 = idempotente)
    expect(ctx.certificadosBuilder.insert).not.toHaveBeenCalled();

    // Prova: o caminho idempotente devolve o título do curso preenchido, não vazio
    expect(body.curso.titulo).toBe("Curso Exemplo");
    expect(body.curso.titulo).not.toBe("");
  });

  // Teste 5: POST num curso de OUTRA instituição → 404, nenhuma escrita
  it("POST /api/aluno/cursos/:cursoId/certificado de curso de outra instituição retorna 404", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // Matrícula ativa
    ctx.estadoMatriculas.resultado = {
      data: { id: "mat-1", curso_id: "curso-1", status: "ativa" },
      error: null,
    };

    // Curso de OUTRA instituição: nenhuma linha
    ctx.estadoCursos.resultado = {
      data: null,
      error: { message: "no rows" },
    };

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/aluno/cursos/curso-1/certificado",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(404);

    // Prova real: insert NUNCA foi chamado
    expect(ctx.certificadosBuilder.insert).not.toHaveBeenCalled();

    // Prova de isolamento: a consulta a cursos foi filtrada pela instituição do aluno
    expect(ctx.cursosBuilder.eq).toHaveBeenCalledWith("instituicao_id", "inst-A");
  });

  // Teste 6: GET /api/publico/certificados/:codigo com código inexistente → 404
  it("GET /api/publico/certificados/:codigo com código inexistente retorna 404", async () => {
    const ctx = criarApp();

    // Certificado não existe
    ctx.estadoCertificados.resultado = {
      data: null,
      error: { code: "PGRST116" },
    };

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/publico/certificados/INVALIDO",
    });

    expect(resposta.statusCode).toBe(404);
  });

  // Teste 7: GET /api/publico/certificados/:codigo válido — resposta NÃO tem email/ids/scores
  it("GET /api/publico/certificados/:codigo válido revela apenas nome/curso/instituição/data", async () => {
    const ctx = criarApp();

    // Certificado existe com join até aluno e instituição
    ctx.estadoCertificados.resultado = {
      data: {
        id: "cert-1",
        emitido_em: "2026-09-20T10:00:00Z",
        matriculas: {
          alunos: {
            nome: "Alice Silva",
          },
          cursos: {
            titulo: "Curso A",
            instituicao_id: "inst-A",
            instituicoes: {
              nome: "Escola XYZ",
            },
          },
        },
      },
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/publico/certificados/ABC123DEF456",
    });

    expect(resposta.statusCode).toBe(200);
    const body = resposta.json() as any;

    // R5: Revela apenas essas chaves
    expect(body).toEqual({
      aluno: { nome: "Alice Silva" },
      curso: { titulo: "Curso A" },
      instituicao: { nome: "Escola XYZ" },
      emitidoEm: "2026-09-20T10:00:00Z",
    });

    // Prova real: NÃO há email, id ou score na resposta
    expect(JSON.stringify(body)).not.toMatch(/email/i);
    expect(JSON.stringify(body)).not.toMatch(/aluno_id/);
    expect(JSON.stringify(body)).not.toMatch(/score/i);
  });

  // Teste 8: Um professor recebe 403 nas rotas de aluno
  it("POST /api/aluno/cursos/:cursoId/certificado com papel professor retorna 403", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "prof-1", instituicaoId: "inst-A", papel: "professor", nome: "Bob" });

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/aluno/cursos/curso-1/certificado",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(403);
  });
});
