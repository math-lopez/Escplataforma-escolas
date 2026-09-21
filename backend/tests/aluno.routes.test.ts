// Prova de isolamento e segurança nas rotas do ALUNO (/api/aluno/...):
// um aluno só vê cursos em que está matriculado, não pode marcar progresso de outros alunos,
// e campos críticos (matricula_id, aluno_id) sempre vêm da sessão, nunca do corpo.
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import authPlugin from "../src/plugins/auth.js";
import alunoRoutes from "../src/routes/aluno.js";
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
  builder.upsert = encadeavel("upsert");
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
    upsert: ReturnType<typeof vi.fn>;
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
  const estadoMatriculas: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoCursos: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoModulos: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoAulas: { resultado: Resultado } = { resultado: { data: null, error: null } };
  const estadoProgresso: { resultado: Resultado } = { resultado: { data: null, error: null } };

  const perfilBuilder = criarQueryBuilder(estadoPerfil);
  const matriculasBuilder = criarQueryBuilder(estadoMatriculas);
  const cursosBuilder = criarQueryBuilder(estadoCursos);
  const modulosBuilder = criarQueryBuilder(estadoModulos);
  const aulasBuilder = criarQueryBuilder(estadoAulas);
  const progressoBuilder = criarQueryBuilder(estadoProgresso);

  const getClaims = vi.fn();
  const getUser = vi.fn();
  const refreshSession = vi.fn();

  let isAuthCall = true;
  const createSignedUrl = vi.fn();

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
        return perfilBuilder;
      },
      storage: {
        from: (bucket: string) => ({
          createSignedUrl,
        }),
      },
    };
    return resultado;
  });

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
  app.register(alunoRoutes);

  return {
    app,
    estadoPerfil,
    estadoMatriculas,
    estadoCursos,
    estadoModulos,
    estadoAulas,
    estadoProgresso,
    perfilBuilder,
    matriculasBuilder,
    cursosBuilder,
    modulosBuilder,
    aulasBuilder,
    progressoBuilder,
    getClaims,
    getUser,
    createSignedUrl,
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

describe("isolamento e segurança em /api/aluno/...", () => {
  it("GET /api/aluno/cursos filtra por aluno_id da sessão, não por nada vindo da requisição", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    ctx.estadoMatriculas.resultado = {
      data: [
        {
          id: "mat-1",
          curso_id: "curso-1",
          status: "ativa",
          cursos: {
            id: "curso-1",
            titulo: "Curso A",
            descricao: "Descrição A",
            capa_url: null,
            instituicao_id: "inst-A",
          },
          progresso_aulas: [],
        },
      ],
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/aluno/cursos",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(200);

    // Prova real: o query builder foi chamado com .eq("aluno_id", "aluno-1")
    // Removendo esse filtro do código, esta asserção falha.
    expect(ctx.matriculasBuilder.eq).toHaveBeenCalledWith("aluno_id", "aluno-1");
  });

  it("GET /api/aluno/cursos/:cursoId de um curso em que o aluno NÃO está matriculado retorna 404", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // Simulando: nenhuma matrícula ativa deste aluno neste curso
    ctx.estadoMatriculas.resultado = { data: null, error: { message: "no rows" } };

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/aluno/cursos/curso-que-nao-tenho",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toEqual({ erro: "Curso não encontrado" });
  });

  it("GET /api/aluno/cursos/:cursoId de curso de OUTRA instituição retorna 404 com filtro de instituição", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // Matrícula existe, mas o curso é de outra instituição
    ctx.estadoMatriculas.resultado = {
      data: { id: "mat-1", curso_id: "curso-1", status: "ativa" },
      error: null,
    };

    // Curso de outra instituição: nenhuma linha
    ctx.estadoCursos.resultado = { data: null, error: { message: "no rows" } };

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/aluno/cursos/curso-1",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toEqual({ erro: "Curso não encontrado" });

    // Prova real: o filtro por instituição foi aplicado
    expect(ctx.cursosBuilder.eq).toHaveBeenCalledWith("instituicao_id", "inst-A");
  });

  it("POST /api/aluno/aulas/:aulaId/concluir numa aula de curso sem matrícula ativa retorna 404 e NÃO chama upsert", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // Simula: aula existe, mas aluno não está matriculado no curso dela
    // Primeira busca (buscarAulaDaInstituicao):
    ctx.estadoAulas.resultado = {
      data: {
        id: "aula-1",
        modulo_id: "mod-1",
        titulo: "Aula 1",
        tipo: "video",
        conteudo_url: null,
        conteudo_texto: null,
        ordem: 0,
        duracao_estimada_min: null,
        video_externo_id: null,
        video_status: null,
      },
      error: null,
    };

    // Módulo existe
    ctx.estadoModulos.resultado = {
      data: { id: "mod-1", titulo: "Módulo 1", ordem: 0, curso_id: "curso-1" },
      error: null,
    };

    // Matrícula NÃO existe (aluno não está matriculado neste curso)
    ctx.estadoMatriculas.resultado = { data: null, error: { message: "no rows" } };

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/aluno/aulas/aula-1/concluir",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toEqual({ erro: "Aula não encontrada" });

    // Prova real: o filtro aluno_id foi aplicado COM O ID DA SESSÃO
    expect(ctx.matriculasBuilder.eq).toHaveBeenCalledWith("aluno_id", "aluno-1");

    // Prova real: upsert NUNCA foi chamado — a rota bloqueou antes
    expect(ctx.progressoBuilder.upsert).not.toHaveBeenCalled();
  });

  it("POST /api/aluno/aulas/:aulaId/concluir grava com a matrícula DO PRÓPRIO aluno, ignorando qualquer matriculaId do corpo", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // Aula existe e pertence à instituição
    ctx.estadoAulas.resultado = {
      data: {
        id: "aula-1",
        modulo_id: "mod-1",
        titulo: "Aula 1",
        tipo: "video",
        conteudo_url: null,
        conteudo_texto: null,
        ordem: 0,
        duracao_estimada_min: null,
        video_externo_id: null,
        video_status: null,
      },
      error: null,
    };

    // Módulo existe
    ctx.estadoModulos.resultado = {
      data: { id: "mod-1", titulo: "Módulo 1", ordem: 0, curso_id: "curso-1" },
      error: null,
    };

    // Matrícula DO ALUNO 1 (mesmo que tente passar outro matriculaId no corpo)
    ctx.estadoMatriculas.resultado = {
      data: { id: "mat-do-aluno-1", curso_id: "curso-1", aluno_id: "aluno-1", status: "ativa" },
      error: null,
    };

    // Upsert bem-sucedido
    ctx.estadoProgresso.resultado = {
      data: {
        aula_id: "aula-1",
        concluida: true,
        concluida_em: "2024-01-01T12:00:00.000Z",
      },
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/aluno/aulas/aula-1/concluir",
      cookies: COOKIES_SESSAO,
      payload: {
        matriculaId: "mat-de-outro-aluno", // Tentativa de sequestro — será ignorado
      },
    });

    expect(resposta.statusCode).toBe(200);

    // Prova real: a consulta a matriculas foi feita filtrando pelo ALUNO DA SESSÃO
    expect(ctx.matriculasBuilder.eq).toHaveBeenCalledWith("aluno_id", "aluno-1");

    // Prova real: upsert foi chamado com a matrícula DO PRÓPRIO aluno,
    // nunca com o valor vindo do corpo
    expect(ctx.progressoBuilder.upsert).toHaveBeenCalledWith(
      {
        matricula_id: "mat-do-aluno-1", // SEMPRE a matrícula encontrada para este aluno
        aula_id: "aula-1",
        concluida: true,
        concluida_em: expect.any(String),
      },
      { onConflict: "matricula_id,aula_id" }
    );
  });

  it("Um usuário com papel professor recebe 403 em GET /api/aluno/cursos e nenhuma query é feita", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "prof-1", instituicaoId: "inst-A", papel: "professor", nome: "Professor" });

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/aluno/cursos",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(403);

    // Nenhuma query foi feita — o filtro de papel bloqueou antes
    expect(ctx.matriculasBuilder.select).not.toHaveBeenCalled();
  });

  // Testes da rota GET /api/aluno/aulas/:aulaId/material
  it("GET /api/aluno/aulas/:aulaId/material retorna 404 quando aluno NÃO está matriculado no curso e createSignedUrl NÃO é chamado", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // Aula existe e é do tipo pdf
    ctx.estadoAulas.resultado = {
      data: {
        id: "aula-1",
        modulo_id: "mod-1",
        titulo: "Aula PDF",
        tipo: "pdf",
        conteudo_url: "inst-A/aulas/aula-1/material.pdf",
        conteudo_texto: null,
        ordem: 0,
        duracao_estimada_min: null,
        video_externo_id: null,
        video_status: null,
      },
      error: null,
    };

    // Módulo existe
    ctx.estadoModulos.resultado = {
      data: { id: "mod-1", titulo: "Módulo 1", ordem: 0, curso_id: "curso-1" },
      error: null,
    };

    // Matrícula NÃO existe
    ctx.estadoMatriculas.resultado = { data: null, error: { message: "no rows" } };

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/aluno/aulas/aula-1/material",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toEqual({ erro: "Aula não encontrada" });

    // Prova real: o filtro aluno_id foi aplicado COM O ID DA SESSÃO
    expect(ctx.matriculasBuilder.eq).toHaveBeenCalledWith("aluno_id", "aluno-1");

    // createSignedUrl NÃO foi chamado — bloqueou antes de tentar acessar o Storage
    expect(ctx.createSignedUrl).not.toHaveBeenCalled();
  });

  it("GET /api/aluno/aulas/:aulaId/material retorna 404 quando aula é de OUTRA instituição e createSignedUrl NÃO é chamado", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // buscarAulaDaInstituicao não encontra porque curso é de outra instituição
    ctx.estadoAulas.resultado = { data: null, error: { message: "no rows" } };

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/aluno/aulas/aula-de-outra-inst/material",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toEqual({ erro: "Aula não encontrada" });

    // createSignedUrl NÃO foi chamado
    expect(ctx.createSignedUrl).not.toHaveBeenCalled();
  });

  it("GET /api/aluno/aulas/:aulaId/material retorna 404 quando aula NÃO é do tipo pdf e createSignedUrl NÃO é chamado", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // Aula existe mas é do tipo video, não pdf
    ctx.estadoAulas.resultado = {
      data: {
        id: "aula-1",
        modulo_id: "mod-1",
        titulo: "Aula Video",
        tipo: "video",
        conteudo_url: null,
        conteudo_texto: null,
        ordem: 0,
        duracao_estimada_min: 10,
        video_externo_id: "video-123",
        video_status: "pronto",
      },
      error: null,
    };

    // Módulo existe (necessário para buscarAulaDaInstituicao)
    ctx.estadoModulos.resultado = {
      data: { id: "mod-1", titulo: "Módulo 1", ordem: 0, curso_id: "curso-1" },
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/aluno/aulas/aula-1/material",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toEqual({ erro: "Esta aula não possui material disponível" });

    // createSignedUrl NÃO foi chamado
    expect(ctx.createSignedUrl).not.toHaveBeenCalled();
  });

  it("GET /api/aluno/aulas/:aulaId/material retorna 404 quando aula é pdf mas SEM conteudo_url e createSignedUrl NÃO é chamado", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // Aula existe, é pdf, mas sem arquivo
    ctx.estadoAulas.resultado = {
      data: {
        id: "aula-1",
        modulo_id: "mod-1",
        titulo: "Aula PDF sem arquivo",
        tipo: "pdf",
        conteudo_url: null,
        conteudo_texto: null,
        ordem: 0,
        duracao_estimada_min: null,
        video_externo_id: null,
        video_status: null,
      },
      error: null,
    };

    // Módulo existe (necessário para buscarAulaDaInstituicao)
    ctx.estadoModulos.resultado = {
      data: { id: "mod-1", titulo: "Módulo 1", ordem: 0, curso_id: "curso-1" },
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/aluno/aulas/aula-1/material",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toEqual({ erro: "Esta aula não possui material disponível" });

    // createSignedUrl NÃO foi chamado
    expect(ctx.createSignedUrl).not.toHaveBeenCalled();
  });

  it("GET /api/aluno/aulas/:aulaId/material retorna 200 com URL assinada e createSignedUrl é chamado com o caminho do banco + 300s", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    const caminhoArmazenado = "inst-A/aulas/aula-1/material.pdf";

    // Aula existe, é pdf e tem conteudo_url
    ctx.estadoAulas.resultado = {
      data: {
        id: "aula-1",
        modulo_id: "mod-1",
        titulo: "Aula PDF",
        tipo: "pdf",
        conteudo_url: caminhoArmazenado,
        conteudo_texto: null,
        ordem: 0,
        duracao_estimada_min: null,
        video_externo_id: null,
        video_status: null,
      },
      error: null,
    };

    // Módulo existe
    ctx.estadoModulos.resultado = {
      data: { id: "mod-1", titulo: "Módulo 1", ordem: 0, curso_id: "curso-1" },
      error: null,
    };

    // Matrícula DO ALUNO existe
    ctx.estadoMatriculas.resultado = {
      data: { id: "mat-1", curso_id: "curso-1", aluno_id: "aluno-1", status: "ativa" },
      error: null,
    };

    // createSignedUrl retorna uma URL assinada
    const urlAssinada = "https://storage.example.com/signed/inst-A/aulas/aula-1/material.pdf?token=xyz";
    ctx.createSignedUrl.mockResolvedValue({
      data: { signedUrl: urlAssinada },
      error: null,
    });

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/aluno/aulas/aula-1/material",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(200);
    const body = resposta.json() as any;
    expect(body.url).toBe(urlAssinada);
    expect(body.expiraEm).toBeDefined();

    // Prova real: a consulta a matriculas foi feita filtrando pelo ALUNO DA SESSÃO
    expect(ctx.matriculasBuilder.eq).toHaveBeenCalledWith("aluno_id", "aluno-1");

    // Prova real: createSignedUrl foi chamado com o caminho DO BANCO e 300 segundos
    expect(ctx.createSignedUrl).toHaveBeenCalledWith(caminhoArmazenado, 300);

    // Valida que expiraEm é um ISO 8601 válido
    const expiraEm = new Date(body.expiraEm);
    expect(expiraEm instanceof Date && !isNaN(expiraEm.getTime())).toBe(true);
  });

  it("GET /api/aluno/aulas/:aulaId/material retorna 403 quando usuário tem papel professor", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "prof-1", instituicaoId: "inst-A", papel: "professor", nome: "Professor" });

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/aluno/aulas/aula-1/material",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(403);

    // createSignedUrl NÃO foi chamado — o filtro de papel bloqueou antes
    expect(ctx.createSignedUrl).not.toHaveBeenCalled();
  });

  // Teste de otimização: GET /api/aluno/cursos/:cursoId consulta aulas UMA ÚNICA VEZ
  it("GET /api/aluno/cursos/:cursoId com 3 módulos consulta aulas uma única vez (sem N+1)", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // Matrícula ativa
    ctx.estadoMatriculas.resultado = {
      data: { id: "mat-1", curso_id: "curso-1", status: "ativa" },
      error: null,
    };

    // Curso válido da instituição
    ctx.estadoCursos.resultado = {
      data: {
        id: "curso-1",
        titulo: "Curso Otimizado",
        descricao: "Com 3 módulos",
        instituicao_id: "inst-A",
      },
      error: null,
    };

    // 3 módulos
    ctx.estadoModulos.resultado = {
      data: [
        { id: "mod-1", titulo: "Módulo 1", ordem: 1 },
        { id: "mod-2", titulo: "Módulo 2", ordem: 2 },
        { id: "mod-3", titulo: "Módulo 3", ordem: 3 },
      ],
      error: null,
    };

    // Aulas dos 3 módulos retornadas de UMA VEZ
    ctx.estadoAulas.resultado = {
      data: [
        {
          id: "aula-1-1",
          modulo_id: "mod-1",
          titulo: "Aula 1 do Módulo 1",
          tipo: "video",
          conteudo_url: null,
          conteudo_texto: null,
          ordem: 1,
          duracao_estimada_min: 10,
          video_externo_id: null,
          video_status: null,
        },
        {
          id: "aula-1-2",
          modulo_id: "mod-1",
          titulo: "Aula 2 do Módulo 1",
          tipo: "texto",
          conteudo_url: null,
          conteudo_texto: "Conteúdo aqui",
          ordem: 2,
          duracao_estimada_min: 5,
          video_externo_id: null,
          video_status: null,
        },
        {
          id: "aula-2-1",
          modulo_id: "mod-2",
          titulo: "Aula 1 do Módulo 2",
          tipo: "video",
          conteudo_url: null,
          conteudo_texto: null,
          ordem: 1,
          duracao_estimada_min: 15,
          video_externo_id: null,
          video_status: null,
        },
        {
          id: "aula-3-1",
          modulo_id: "mod-3",
          titulo: "Aula 1 do Módulo 3",
          tipo: "pdf",
          conteudo_url: "documento.pdf",
          conteudo_texto: null,
          ordem: 1,
          duracao_estimada_min: 20,
          video_externo_id: null,
          video_status: null,
        },
      ],
      error: null,
    };

    // Progresso do aluno: algumas aulas concluídas
    ctx.estadoProgresso.resultado = {
      data: [
        { aula_id: "aula-1-1", concluida: true },
        { aula_id: "aula-2-1", concluida: true },
      ],
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/aluno/cursos/curso-1",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(200);

    const body = resposta.json() as any;
    expect(body.id).toBe("curso-1");
    expect(body.modulos).toHaveLength(3);
    expect(body.modulos[0].aulas).toHaveLength(2); // Módulo 1 tem 2 aulas
    expect(body.modulos[1].aulas).toHaveLength(1); // Módulo 2 tem 1 aula
    expect(body.modulos[2].aulas).toHaveLength(1); // Módulo 3 tem 1 aula

    // Prova real: aulas foi consultada APENAS UMA VEZ
    // Contando as chamadas ao `select` do builder de aulas
    const chamadaSelect = ctx.aulasBuilder.select.mock.calls.length;
    expect(chamadaSelect).toBe(1);

    // Prova real: o `.in()` foi usado com os 3 IDs de módulo
    expect(ctx.aulasBuilder.in).toHaveBeenCalledWith("modulo_id", ["mod-1", "mod-2", "mod-3"]);

    // Prova real: progresso foi consultado uma única vez
    expect(ctx.progressoBuilder.select).toHaveBeenCalledOnce();
    expect(ctx.progressoBuilder.eq).toHaveBeenCalledWith("matricula_id", "mat-1");

    // Prova real: as aulas concluídas estão marcadas
    expect(body.modulos[0].aulas[0].concluida).toBe(true); // aula-1-1
    expect(body.modulos[0].aulas[1].concluida).toBe(false); // aula-1-2
    expect(body.modulos[1].aulas[0].concluida).toBe(true); // aula-2-1
    expect(body.modulos[2].aulas[0].concluida).toBe(false); // aula-3-1
  });

  it("GET /api/aluno/cursos com múltiplas matrículas consulta módulos e aulas uma única vez cada", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "aluno-1", instituicaoId: "inst-A", papel: "aluno", nome: "Alice" });

    // 2 matrículas
    ctx.estadoMatriculas.resultado = {
      data: [
        {
          id: "mat-1",
          curso_id: "curso-1",
          status: "ativa",
          cursos: {
            id: "curso-1",
            titulo: "Curso 1",
            descricao: "Descrição 1",
            capa_url: null,
            instituicao_id: "inst-A",
          },
          progresso_aulas: [{ aula_id: "aula-1-1" }, { aula_id: "aula-1-2" }],
        },
        {
          id: "mat-2",
          curso_id: "curso-2",
          status: "ativa",
          cursos: {
            id: "curso-2",
            titulo: "Curso 2",
            descricao: "Descrição 2",
            capa_url: null,
            instituicao_id: "inst-A",
          },
          progresso_aulas: [{ aula_id: "aula-2-1" }],
        },
      ],
      error: null,
    };

    // Módulos dos 2 cursos retornados de UMA VEZ
    ctx.estadoModulos.resultado = {
      data: [
        { id: "mod-1", curso_id: "curso-1" },
        { id: "mod-2", curso_id: "curso-1" },
        { id: "mod-3", curso_id: "curso-2" },
      ],
      error: null,
    };

    // Aulas de todos os módulos retornadas de UMA VEZ
    ctx.estadoAulas.resultado = {
      data: [
        { id: "aula-1-1", modulo_id: "mod-1" },
        { id: "aula-1-2", modulo_id: "mod-1" },
        { id: "aula-1-3", modulo_id: "mod-2" },
        { id: "aula-2-1", modulo_id: "mod-3" },
        { id: "aula-2-2", modulo_id: "mod-3" },
      ],
      error: null,
    };

    const resposta = await ctx.app.inject({
      method: "GET",
      url: "/api/aluno/cursos",
      cookies: COOKIES_SESSAO,
    });

    expect(resposta.statusCode).toBe(200);

    const body = resposta.json() as any;
    expect(body).toHaveLength(2);
    expect(body[0].totalAulas).toBe(3); // Curso 1: 2 + 1 aulas
    expect(body[0].aulasConcluidas).toBe(2);
    expect(body[1].totalAulas).toBe(2); // Curso 2: 2 aulas
    expect(body[1].aulasConcluidas).toBe(1);

    // Prova real: módulos consultados UMA VEZ com `.in("curso_id", [...])`
    expect(ctx.modulosBuilder.select).toHaveBeenCalledOnce();
    expect(ctx.modulosBuilder.in).toHaveBeenCalledWith("curso_id", ["curso-1", "curso-2"]);

    // Prova real: aulas consultadas UMA VEZ com `.in("modulo_id", [...])`
    expect(ctx.aulasBuilder.select).toHaveBeenCalledOnce();
    expect(ctx.aulasBuilder.in).toHaveBeenCalledWith("modulo_id", ["mod-1", "mod-2", "mod-3"]);
  });
});
