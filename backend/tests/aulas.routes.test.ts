// Prova de isolamento multi-tenant em /api/modulos/:moduloId/aulas e /api/aulas/:id, mais os
// dois requisitos específicos de aula: videoExternoId/videoStatus do corpo são sempre ignorados
// (só mudam via POST /:id/video e o webhook da Bunny), e os uploads (vídeo/PDF) checam posse
// antes de fazer qualquer chamada externa ou gerar qualquer URL assinada.
//
// Mesma técnica de mock de modulos.routes.test.ts: builder novo a cada `.from()`, mas
// `chamadas`/`filaResultados` compartilhados por tabela (permite múltiplas queries por
// requisição, cada uma com seu próprio resultado configurado).
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import authPlugin from "../src/plugins/auth.js";
import aulasRoutes from "../src/routes/aulas.js";
import { COOKIE_ACCESS } from "../src/lib/sessao.js";
import * as bunny from "../src/services/bunny.js";

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
    modulos: criarTabela({ data: null, error: null }),
    aulas: criarTabela({ data: null, error: null }),
  };

  const createSignedUploadUrl = vi.fn().mockResolvedValue({
    data: { path: "inst-A/aulas/aula-1/material.pdf", token: "tok", signedUrl: "https://signed" },
    error: null,
  });

  const getClaims = vi.fn();
  const getUser = vi.fn();

  const comoUsuario = vi.fn(() => ({
    from: (nomeTabela: string) => criarQueryBuilder(tabelas[nomeTabela] ?? (tabelas[nomeTabela] = criarTabela())),
    storage: { from: vi.fn(() => ({ createSignedUploadUrl })) },
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
  app.register(aulasRoutes);

  return { app, tabelas, getClaims, getUser, createSignedUploadUrl };
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

const AULA_BASE = {
  id: "aula-1",
  modulo_id: "mod-1",
  titulo: "Aula 1",
  tipo: "texto",
  conteudo_url: null,
  conteudo_texto: "conteúdo",
  ordem: 0,
  duracao_estimada_min: null,
  video_externo_id: null,
  video_status: null,
  video_fonte: null,
};

describe("isolamento multi-tenant em aulas", () => {
  it("POST /api/modulos/:moduloId/aulas: módulo de outra instituição não é encontrado (404), sem insert", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.modulos.filaResultados = [{ data: null, error: { message: "no rows" } }];

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/modulos/modulo-da-instituicao-b/aulas",
      cookies: COOKIES_SESSAO,
      payload: { titulo: "Aula nova", tipo: "texto" },
    });

    expect(resposta.statusCode).toBe(404);
    expect(fezFiltro(ctx.tabelas.modulos.chamadas, "cursos.instituicao_id", "inst-A")).toBe(true);
    expect(ctx.tabelas.aulas.chamadas.some((c) => c.metodo === "insert")).toBe(false);
  });

  it("POST /api/modulos/:moduloId/aulas: caminho feliz ignora videoExternoId/videoStatus do corpo", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.modulos.filaResultados = [{ data: { id: "mod-1", curso_id: "curso-1", titulo: "M", ordem: 0 }, error: null }];
    ctx.tabelas.aulas.filaResultados = [
      { data: null, error: null, count: 0 },
      { data: { ...AULA_BASE }, error: null },
    ];

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/modulos/mod-1/aulas",
      cookies: COOKIES_SESSAO,
      payload: {
        titulo: "Aula 1",
        tipo: "texto",
        conteudoTexto: "conteúdo",
        videoExternoId: "guid-injetado",
        videoStatus: "pronto",
      },
    });

    expect(resposta.statusCode).toBe(201);
    // A prova real de que o corpo malicioso foi ignorado: o insert não pode conter nenhum dos
    // dois campos, mesmo tendo vindo no payload.
    const chamadaInsert = ctx.tabelas.aulas.chamadas.find((c) => c.metodo === "insert");
    expect(chamadaInsert?.args[0]).not.toHaveProperty("video_externo_id");
    expect(chamadaInsert?.args[0]).not.toHaveProperty("videoExternoId");
    expect(chamadaInsert?.args[0]).not.toHaveProperty("video_status");
  });

  it("POST /api/modulos/:moduloId/aulas: tipo inválido é rejeitado (400)", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/modulos/mod-1/aulas",
      cookies: COOKIES_SESSAO,
      payload: { titulo: "Aula 1", tipo: "invalido" },
    });

    expect(resposta.statusCode).toBe(400);
    expect(ctx.tabelas.modulos.chamadas).toHaveLength(0); // nem chegou a verificar posse
  });

  it("PATCH /api/aulas/:id: aula de módulo de outra instituição não é encontrada (404), sem update", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.aulas.filaResultados = [{ data: { ...AULA_BASE, modulo_id: "mod-b" }, error: null }];
    ctx.tabelas.modulos.filaResultados = [{ data: null, error: { message: "no rows" } }]; // módulo não é da inst-A

    const resposta = await ctx.app.inject({
      method: "PATCH",
      url: "/api/aulas/aula-1",
      cookies: COOKIES_SESSAO,
      payload: { titulo: "Sequestro" },
    });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toEqual({ erro: "Aula não encontrada" });
    expect(fezFiltro(ctx.tabelas.modulos.chamadas, "cursos.instituicao_id", "inst-A")).toBe(true);
    expect(ctx.tabelas.aulas.chamadas.some((c) => c.metodo === "update")).toBe(false);
  });

  it("PATCH /api/aulas/:id: caminho feliz ignora videoExternoId/videoStatus do corpo", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.aulas.filaResultados = [
      { data: { ...AULA_BASE }, error: null }, // busca da aula (verificação)
      { data: { ...AULA_BASE, titulo: "Novo título" }, error: null }, // update
    ];
    ctx.tabelas.modulos.filaResultados = [{ data: { id: "mod-1", curso_id: "curso-1", titulo: "M", ordem: 0 }, error: null }];

    const resposta = await ctx.app.inject({
      method: "PATCH",
      url: "/api/aulas/aula-1",
      cookies: COOKIES_SESSAO,
      payload: { titulo: "Novo título", videoExternoId: "guid-injetado", videoStatus: "pronto" },
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().titulo).toBe("Novo título");
    const chamadaUpdate = ctx.tabelas.aulas.chamadas.find((c) => c.metodo === "update");
    // Só `titulo` pode estar no update — nada de video_externo_id/video_status vindos do corpo.
    expect(chamadaUpdate?.args[0]).toEqual({ titulo: "Novo título" });
  });

  it("DELETE /api/aulas/:id: aula de módulo de outra instituição não é encontrada (404), sem delete", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.aulas.filaResultados = [{ data: { ...AULA_BASE }, error: null }];
    ctx.tabelas.modulos.filaResultados = [{ data: null, error: { message: "no rows" } }];

    const resposta = await ctx.app.inject({ method: "DELETE", url: "/api/aulas/aula-1", cookies: COOKIES_SESSAO });

    expect(resposta.statusCode).toBe(404);
    expect(ctx.tabelas.aulas.chamadas.some((c) => c.metodo === "delete")).toBe(false);
  });

  it("PUT /api/modulos/:moduloId/aulas/ordem: id que não pertence ao módulo é rejeitado (400), sem update", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.modulos.filaResultados = [{ data: { id: "mod-1", curso_id: "curso-1", titulo: "M", ordem: 0 }, error: null }];
    ctx.tabelas.aulas.filaResultados = [{ data: [{ id: "aula-1" }, { id: "aula-2" }], error: null }];

    const resposta = await ctx.app.inject({
      method: "PUT",
      url: "/api/modulos/mod-1/aulas/ordem",
      cookies: COOKIES_SESSAO,
      payload: { ids: ["aula-1", "aula-de-outro-modulo"] },
    });

    expect(resposta.statusCode).toBe(400);
    expect(ctx.tabelas.aulas.chamadas.some((c) => c.metodo === "update")).toBe(false);
  });

  it("PUT /api/modulos/:moduloId/aulas/ordem: caminho feliz reordena todas as aulas", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.modulos.filaResultados = [{ data: { id: "mod-1", curso_id: "curso-1", titulo: "M", ordem: 0 }, error: null }];
    ctx.tabelas.aulas.filaResultados = [
      { data: [{ id: "aula-1" }, { id: "aula-2" }], error: null },
      { data: null, error: null },
      { data: null, error: null },
    ];

    const resposta = await ctx.app.inject({
      method: "PUT",
      url: "/api/modulos/mod-1/aulas/ordem",
      cookies: COOKIES_SESSAO,
      payload: { ids: ["aula-2", "aula-1"] },
    });

    expect(resposta.statusCode).toBe(204);
    expect(ctx.tabelas.aulas.chamadas).toContainEqual({ metodo: "update", args: [{ ordem: 0 }] });
    expect(ctx.tabelas.aulas.chamadas).toContainEqual({ metodo: "update", args: [{ ordem: 1 }] });
  });

  it("escrita (PATCH) exige papel admin_instituicao ou professor — aluno recebe 403, sem query em aulas", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-C", instituicaoId: "inst-A", papel: "aluno", nome: "Carla" });

    const resposta = await ctx.app.inject({
      method: "PATCH",
      url: "/api/aulas/aula-1",
      cookies: COOKIES_SESSAO,
      payload: { titulo: "Qualquer" },
    });

    expect(resposta.statusCode).toBe(403);
    expect(ctx.tabelas.aulas.chamadas).toHaveLength(0);
  });
});

describe("POST /api/aulas/:id/video", () => {
  it("aula de outra instituição não é encontrada (404), sem chamar a Bunny", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.aulas.filaResultados = [{ data: { ...AULA_BASE, tipo: "video" }, error: null }];
    ctx.tabelas.modulos.filaResultados = [{ data: null, error: { message: "no rows" } }];

    const espiaCriarVideo = vi.spyOn(bunny, "criarVideoNaBunny");

    const resposta = await ctx.app.inject({ method: "POST", url: "/api/aulas/aula-1/video", cookies: COOKIES_SESSAO });

    expect(resposta.statusCode).toBe(404);
    expect(espiaCriarVideo).not.toHaveBeenCalled();
    espiaCriarVideo.mockRestore();
  });

  it("rejeita aula que não é do tipo 'video' (400), sem chamar a Bunny", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.aulas.filaResultados = [{ data: { ...AULA_BASE, tipo: "texto" }, error: null }];
    ctx.tabelas.modulos.filaResultados = [{ data: { id: "mod-1", curso_id: "curso-1", titulo: "M", ordem: 0 }, error: null }];

    const espiaCriarVideo = vi.spyOn(bunny, "criarVideoNaBunny");

    const resposta = await ctx.app.inject({ method: "POST", url: "/api/aulas/aula-1/video", cookies: COOKIES_SESSAO });

    expect(resposta.statusCode).toBe(400);
    expect(espiaCriarVideo).not.toHaveBeenCalled();
    espiaCriarVideo.mockRestore();
  });

  it("responde 503 sem expor nada quando a Bunny não está configurada", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.aulas.filaResultados = [{ data: { ...AULA_BASE, tipo: "video" }, error: null }];
    ctx.tabelas.modulos.filaResultados = [{ data: { id: "mod-1", curso_id: "curso-1", titulo: "M", ordem: 0 }, error: null }];

    const espiaConfigurado = vi.spyOn(bunny, "bunnyConfigurado").mockReturnValue(false);

    const resposta = await ctx.app.inject({ method: "POST", url: "/api/aulas/aula-1/video", cookies: COOKIES_SESSAO });

    expect(resposta.statusCode).toBe(503);
    expect(JSON.stringify(resposta.json())).not.toMatch(/BUNNY_API_KEY=|AccessKey/);
    espiaConfigurado.mockRestore();
  });

});

describe("PUT /api/aulas/:id/video-youtube", () => {
  it("aula de outra instituição não é encontrada (404), sem escrita", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.aulas.filaResultados = [{ data: { ...AULA_BASE, tipo: "video" }, error: null }];
    ctx.tabelas.modulos.filaResultados = [{ data: null, error: { message: "no rows" } }];

    const resposta = await ctx.app.inject({
      method: "PUT",
      url: "/api/aulas/aula-1/video-youtube",
      cookies: COOKIES_SESSAO,
      payload: { url: "https://youtube.com/watch?v=dQw4w9WgXcQ" },
    });

    expect(resposta.statusCode).toBe(404);
    expect(fezFiltro(ctx.tabelas.modulos.chamadas, "cursos.instituicao_id", "inst-A")).toBe(true);
    expect(ctx.tabelas.aulas.chamadas.some((c) => c.metodo === "update")).toBe(false);
  });

  it("rejeita aula que não é do tipo 'video' (400), sem escrita", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.aulas.filaResultados = [{ data: { ...AULA_BASE, tipo: "texto" }, error: null }];
    ctx.tabelas.modulos.filaResultados = [{ data: { id: "mod-1", curso_id: "curso-1", titulo: "M", ordem: 0 }, error: null }];

    const resposta = await ctx.app.inject({
      method: "PUT",
      url: "/api/aulas/aula-1/video-youtube",
      cookies: COOKIES_SESSAO,
      payload: { url: "https://youtube.com/watch?v=dQw4w9WgXcQ" },
    });

    expect(resposta.statusCode).toBe(400);
    expect(ctx.tabelas.aulas.chamadas.some((c) => c.metodo === "update")).toBe(false);
  });

  it("YouTube.com/watch?v=<id> é extraído corretamente, 200 com videoFonte='youtube'", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.aulas.filaResultados = [
      { data: { ...AULA_BASE, tipo: "video" }, error: null }, // verificação
      { data: { ...AULA_BASE, tipo: "video", video_externo_id: "dQw4w9WgXcQ", video_fonte: "youtube", video_status: "pronto" }, error: null }, // update+select
    ];
    ctx.tabelas.modulos.filaResultados = [{ data: { id: "mod-1", curso_id: "curso-1", titulo: "M", ordem: 0 }, error: null }];

    const resposta = await ctx.app.inject({
      method: "PUT",
      url: "/api/aulas/aula-1/video-youtube",
      cookies: COOKIES_SESSAO,
      payload: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });

    expect(resposta.statusCode).toBe(200);
    const chamadaUpdate = ctx.tabelas.aulas.chamadas.find((c) => c.metodo === "update");
    expect(chamadaUpdate?.args[0]).toEqual({
      video_externo_id: "dQw4w9WgXcQ",
      video_fonte: "youtube",
      video_status: "pronto",
    });
    expect(resposta.json().videoExternoId).toBe("dQw4w9WgXcQ");
    expect(resposta.json().videoFonte).toBe("youtube");
  });

  it("youtu.be/<id> é extraído corretamente", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.aulas.filaResultados = [
      { data: { ...AULA_BASE, tipo: "video" }, error: null },
      { data: { ...AULA_BASE, tipo: "video", video_externo_id: "dQw4w9WgXcQ", video_fonte: "youtube", video_status: "pronto" }, error: null },
    ];
    ctx.tabelas.modulos.filaResultados = [{ data: { id: "mod-1", curso_id: "curso-1", titulo: "M", ordem: 0 }, error: null }];

    const resposta = await ctx.app.inject({
      method: "PUT",
      url: "/api/aulas/aula-1/video-youtube",
      cookies: COOKIES_SESSAO,
      payload: { url: "https://youtu.be/dQw4w9WgXcQ" },
    });

    expect(resposta.statusCode).toBe(200);
    const chamadaUpdate = ctx.tabelas.aulas.chamadas.find((c) => c.metodo === "update");
    expect(chamadaUpdate?.args[0]).toEqual({
      video_externo_id: "dQw4w9WgXcQ",
      video_fonte: "youtube",
      video_status: "pronto",
    });
  });

  it("youtube.com/embed/<id> é extraído corretamente", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.aulas.filaResultados = [
      { data: { ...AULA_BASE, tipo: "video" }, error: null },
      { data: { ...AULA_BASE, tipo: "video", video_externo_id: "dQw4w9WgXcQ", video_fonte: "youtube", video_status: "pronto" }, error: null },
    ];
    ctx.tabelas.modulos.filaResultados = [{ data: { id: "mod-1", curso_id: "curso-1", titulo: "M", ordem: 0 }, error: null }];

    const resposta = await ctx.app.inject({
      method: "PUT",
      url: "/api/aulas/aula-1/video-youtube",
      cookies: COOKIES_SESSAO,
      payload: { url: "https://www.youtube.com/embed/dQw4w9WgXcQ" },
    });

    expect(resposta.statusCode).toBe(200);
    const chamadaUpdate = ctx.tabelas.aulas.chamadas.find((c) => c.metodo === "update");
    expect(chamadaUpdate?.args[0].video_externo_id).toBe("dQw4w9WgXcQ");
  });

  it("youtube.com/shorts/<id> é extraído corretamente", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.aulas.filaResultados = [
      { data: { ...AULA_BASE, tipo: "video" }, error: null },
      { data: { ...AULA_BASE, tipo: "video", video_externo_id: "dQw4w9WgXcQ", video_fonte: "youtube", video_status: "pronto" }, error: null },
    ];
    ctx.tabelas.modulos.filaResultados = [{ data: { id: "mod-1", curso_id: "curso-1", titulo: "M", ordem: 0 }, error: null }];

    const resposta = await ctx.app.inject({
      method: "PUT",
      url: "/api/aulas/aula-1/video-youtube",
      cookies: COOKIES_SESSAO,
      payload: { url: "https://www.youtube.com/shorts/dQw4w9WgXcQ" },
    });

    expect(resposta.statusCode).toBe(200);
    const chamadaUpdate = ctx.tabelas.aulas.chamadas.find((c) => c.metodo === "update");
    expect(chamadaUpdate?.args[0].video_externo_id).toBe("dQw4w9WgXcQ");
  });

  it("parâmetros extras como ?t=30 são ignorados e id é extraído", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.aulas.filaResultados = [
      { data: { ...AULA_BASE, tipo: "video" }, error: null },
      { data: { ...AULA_BASE, tipo: "video", video_externo_id: "dQw4w9WgXcQ", video_fonte: "youtube", video_status: "pronto" }, error: null },
    ];
    ctx.tabelas.modulos.filaResultados = [{ data: { id: "mod-1", curso_id: "curso-1", titulo: "M", ordem: 0 }, error: null }];

    const resposta = await ctx.app.inject({
      method: "PUT",
      url: "/api/aulas/aula-1/video-youtube",
      cookies: COOKIES_SESSAO,
      payload: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30" },
    });

    expect(resposta.statusCode).toBe(200);
    const chamadaUpdate = ctx.tabelas.aulas.chamadas.find((c) => c.metodo === "update");
    expect(chamadaUpdate?.args[0].video_externo_id).toBe("dQw4w9WgXcQ");
  });

  it("URL que não é do YouTube (evil.example.com) é rejeitada (400), sem escrita", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.aulas.filaResultados = [{ data: { ...AULA_BASE, tipo: "video" }, error: null }];
    ctx.tabelas.modulos.filaResultados = [{ data: { id: "mod-1", curso_id: "curso-1", titulo: "M", ordem: 0 }, error: null }];

    const resposta = await ctx.app.inject({
      method: "PUT",
      url: "/api/aulas/aula-1/video-youtube",
      cookies: COOKIES_SESSAO,
      payload: { url: "https://evil.example.com/x" },
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().erro).toContain("YouTube");
    expect(ctx.tabelas.aulas.chamadas.some((c) => c.metodo === "update")).toBe(false);
  });

  it("id de formato inválido (curto demais) é rejeitado (400), sem escrita", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.aulas.filaResultados = [{ data: { ...AULA_BASE, tipo: "video" }, error: null }];
    ctx.tabelas.modulos.filaResultados = [{ data: { id: "mod-1", curso_id: "curso-1", titulo: "M", ordem: 0 }, error: null }];

    const resposta = await ctx.app.inject({
      method: "PUT",
      url: "/api/aulas/aula-1/video-youtube",
      cookies: COOKIES_SESSAO,
      payload: { url: "https://youtube.com/watch?v=SHORT" },
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().erro).toContain("YouTube");
    expect(ctx.tabelas.aulas.chamadas.some((c) => c.metodo === "update")).toBe(false);
  });

  it("id com caracteres inválidos é rejeitado (400), sem escrita", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.aulas.filaResultados = [{ data: { ...AULA_BASE, tipo: "video" }, error: null }];
    ctx.tabelas.modulos.filaResultados = [{ data: { id: "mod-1", curso_id: "curso-1", titulo: "M", ordem: 0 }, error: null }];

    const resposta = await ctx.app.inject({
      method: "PUT",
      url: "/api/aulas/aula-1/video-youtube",
      cookies: COOKIES_SESSAO,
      payload: { url: "https://youtube.com/watch?v=dQw4w9Wg@cQ" },
    });

    expect(resposta.statusCode).toBe(400);
    expect(ctx.tabelas.aulas.chamadas.some((c) => c.metodo === "update")).toBe(false);
  });

  it("um aluno recebe 403 nessa rota", async () => {
    const ctx = criarApp();
    logarComo(ctx, { id: "user-C", instituicaoId: "inst-A", papel: "aluno", nome: "Carla" });

    const resposta = await ctx.app.inject({
      method: "PUT",
      url: "/api/aulas/aula-1/video-youtube",
      cookies: COOKIES_SESSAO,
      payload: { url: "https://youtube.com/watch?v=dQw4w9WgXcQ" },
    });

    expect(resposta.statusCode).toBe(403);
    expect(ctx.tabelas.aulas.chamadas).toHaveLength(0);
  });
});

describe("POST /api/aulas/:id/pdf", () => {
  it("aula de outra instituição não é encontrada (404), sem gerar URL assinada", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.aulas.filaResultados = [{ data: { ...AULA_BASE, tipo: "pdf" }, error: null }];
    ctx.tabelas.modulos.filaResultados = [{ data: null, error: { message: "no rows" } }];

    const resposta = await ctx.app.inject({ method: "POST", url: "/api/aulas/aula-1/pdf", cookies: COOKIES_SESSAO });

    expect(resposta.statusCode).toBe(404);
    expect(ctx.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejeita aula que não é do tipo 'pdf' (400), sem gerar URL assinada", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.aulas.filaResultados = [{ data: { ...AULA_BASE, tipo: "texto" }, error: null }];
    ctx.tabelas.modulos.filaResultados = [{ data: { id: "mod-1", curso_id: "curso-1", titulo: "M", ordem: 0 }, error: null }];

    const resposta = await ctx.app.inject({ method: "POST", url: "/api/aulas/aula-1/pdf", cookies: COOKIES_SESSAO });

    expect(resposta.statusCode).toBe(400);
    expect(ctx.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("caminho feliz: o caminho gerado começa pela instituição da SESSÃO, nunca de um valor injetado", async () => {
    const ctx = criarApp();
    logarComo(ctx, SESSAO_A);
    ctx.tabelas.aulas.filaResultados = [
      { data: { ...AULA_BASE, tipo: "pdf" }, error: null }, // verificação
      { data: null, error: null }, // update conteudo_url
    ];
    ctx.tabelas.modulos.filaResultados = [{ data: { id: "mod-1", curso_id: "curso-1", titulo: "M", ordem: 0 }, error: null }];

    const resposta = await ctx.app.inject({
      method: "POST",
      url: "/api/aulas/aula-1/pdf",
      cookies: COOKIES_SESSAO,
      // nomeArquivo tentando path traversal para fora da pasta da instituição.
      payload: { nomeArquivo: "../../branding/inst-b/logo.pdf" },
    });

    expect(resposta.statusCode).toBe(201);
    const caminhoUsado = ctx.createSignedUploadUrl.mock.calls[0][0] as string;
    // A propriedade de segurança que importa não é "sem pontos" (".." sobrevive como texto
    // literal dentro de um nome de arquivo, o que é inofensivo) e sim "sem barra nenhuma
    // sobrevivendo dentro do nome sanitizado" — é a barra que permitiria escapar da pasta
    // {instituicao_id}/aulas/{aula_id}/ montada pelo backend. Por isso o caminho inteiro precisa
    // ter EXATAMENTE 4 segmentos, com o primeiro sendo sempre a instituição da sessão.
    const segmentos = caminhoUsado.split("/");
    expect(segmentos).toHaveLength(4);
    expect(segmentos[0]).toBe("inst-A");
    expect(segmentos[1]).toBe("aulas");
    expect(segmentos[2]).toBe("aula-1");
    expect(segmentos[3]).not.toContain("/");
    expect(caminhoUsado).not.toContain("/branding/");
  });
});
