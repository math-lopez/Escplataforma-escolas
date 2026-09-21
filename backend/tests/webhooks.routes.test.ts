// Prova de autenticação do webhook da Bunny (POST /api/webhooks/bunny): sem o segredo certo na
// query string, nenhuma requisição altera video_status de nenhuma aula. Ver comentário em
// src/routes/webhooks.ts sobre por que o esquema escolhido foi um token na URL (a Bunny não
// suporta header de assinatura customizado nos webhooks de vídeo).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import fp from "fastify-plugin";
import webhooksRoutes from "../src/routes/webhooks.js";
import { env } from "../src/env.js";

function criarApp(update: ReturnType<typeof vi.fn>) {
  const app = Fastify();
  app.register(
    fp(async (fastify) => {
      fastify.decorate("supabaseAdmin", {
        from: () => ({ update: () => ({ eq: update }) }),
      } as never);
    }),
  );
  app.register(webhooksRoutes);
  return app;
}

describe("autenticação do webhook da Bunny", () => {
  const segredoOriginal = env.bunnyWebhookSecret;

  beforeEach(() => {
    (env as { bunnyWebhookSecret?: string }).bunnyWebhookSecret = "segredo-correto";
  });

  afterEach(() => {
    (env as { bunnyWebhookSecret?: string }).bunnyWebhookSecret = segredoOriginal;
  });

  it("rejeita (401) requisição sem token na query, sem tocar no banco", async () => {
    const update = vi.fn().mockResolvedValue({ data: null, error: null });
    const app = criarApp(update);

    const resposta = await app.inject({
      method: "POST",
      url: "/api/webhooks/bunny",
      payload: { VideoGuid: "guid-1", Status: 4 },
    });

    expect(resposta.statusCode).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejeita (401) requisição com token errado, sem tocar no banco", async () => {
    const update = vi.fn().mockResolvedValue({ data: null, error: null });
    const app = criarApp(update);

    // A prova real: se a checagem do token sumir da rota, esta requisição (que só está errada
    // por causa do token) passaria a devolver 200 e chamar `update` — as duas asserções abaixo
    // falhariam juntas.
    const resposta = await app.inject({
      method: "POST",
      url: "/api/webhooks/bunny?token=token-errado",
      payload: { VideoGuid: "guid-1", Status: 4 },
    });

    expect(resposta.statusCode).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("aceita (200) requisição com o token correto e atualiza video_status = pronto (Status Finished = 4)", async () => {
    const update = vi.fn().mockResolvedValue({ data: null, error: null });
    const app = criarApp(update);

    const resposta = await app.inject({
      method: "POST",
      url: "/api/webhooks/bunny?token=segredo-correto",
      payload: { VideoGuid: "guid-1", Status: 4 },
    });

    expect(resposta.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith("video_externo_id", "guid-1");
  });

  it("aceita (200) requisição com o token correto e atualiza video_status = erro (Status Error = 5)", async () => {
    const update = vi.fn().mockResolvedValue({ data: null, error: null });
    const app = criarApp(update);

    const resposta = await app.inject({
      method: "POST",
      url: "/api/webhooks/bunny?token=segredo-correto",
      payload: { VideoGuid: "guid-1", Status: 5 },
    });

    expect(resposta.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith("video_externo_id", "guid-1");
  });

  it("responde 503 (não 200) se o segredo nunca foi configurado no ambiente", async () => {
    (env as { bunnyWebhookSecret?: string }).bunnyWebhookSecret = undefined;
    const update = vi.fn().mockResolvedValue({ data: null, error: null });
    const app = criarApp(update);

    const resposta = await app.inject({
      method: "POST",
      url: "/api/webhooks/bunny?token=qualquer-coisa",
      payload: { VideoGuid: "guid-1", Status: 4 },
    });

    expect(resposta.statusCode).toBe(503);
    expect(update).not.toHaveBeenCalled();
  });
});
