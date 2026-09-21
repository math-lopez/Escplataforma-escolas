import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { env } from "../env.js";
import { statusParaVideoStatus } from "../services/bunny.js";

interface WebhookQuery {
  token?: string;
}

interface WebhookBody {
  VideoGuid?: string;
  VideoLibraryId?: number | string;
  Status?: number | string;
}

/**
 * Compara em tempo constante para não vazar, por timing de resposta, quantos caracteres do
 * token estão certos. A Bunny Stream não permite configurar um header de assinatura para os
 * webhooks de vídeo — só uma URL de callback simples — então o esquema de autenticação escolhido
 * aqui é o segredo (`BUNNY_WEBHOOK_SECRET`) trafegando como query string na própria URL cadastrada
 * no painel da Bunny (ex.: `https://.../api/webhooks/bunny?token=<segredo>`). Essa URL PASSA A SER
 * ela mesma um segredo: não deve ser logada, exibida em erro, nem trafegar fora de HTTPS.
 */
function tokenValido(recebido: string | undefined, esperado: string): boolean {
  if (!recebido) return false;
  const bufRecebido = Buffer.from(recebido);
  const bufEsperado = Buffer.from(esperado);
  // timingSafeEqual explode se os buffers tiverem tamanhos diferentes — comparar o tamanho antes
  // não reintroduz um timing leak útil (o tamanho do segredo não é a parte sensível).
  if (bufRecebido.length !== bufEsperado.length) return false;
  return timingSafeEqual(bufRecebido, bufEsperado);
}

export default async function webhooksRoutes(fastify: FastifyInstance) {
  // Sem sessão de usuário (é a Bunny chamando, não um professor logado) — por isso não passa por
  // `fastify.autenticar`/`exigirPapel`. A autenticação é inteiramente o `token` da query string.
  fastify.post<{ Querystring: WebhookQuery; Body: WebhookBody }>(
    "/api/webhooks/bunny",
    async (request, reply) => {
      if (!env.bunnyWebhookSecret) {
        request.log.error("BUNNY_WEBHOOK_SECRET não configurado — webhook recusado");
        return reply.code(503).send({ erro: "Webhook não configurado" });
      }

      if (!tokenValido(request.query?.token, env.bunnyWebhookSecret)) {
        return reply.code(401).send({ erro: "Token inválido" });
      }

      const corpo = request.body ?? {};
      const videoGuid = corpo.VideoGuid;
      if (!videoGuid) {
        return reply.code(400).send({ erro: "VideoGuid ausente" });
      }

      // Defesa extra: se o payload trouxer VideoLibraryId, confere contra a library configurada.
      // Protege contra um guid de outra library/conta Bunny (mesmo com o token certo) batendo
      // por coincidência com um video_externo_id nosso.
      if (
        corpo.VideoLibraryId !== undefined &&
        env.bunnyLibraryId !== undefined &&
        String(corpo.VideoLibraryId) !== env.bunnyLibraryId
      ) {
        return reply.code(400).send({ erro: "VideoLibraryId não corresponde à library configurada" });
      }

      const statusNumero = Number(corpo.Status);
      const videoStatus = Number.isFinite(statusNumero) ? statusParaVideoStatus(statusNumero) : null;

      if (!videoStatus) {
        // Status desconhecido/não mapeado: responde 200 sem alterar nada, para a Bunny não
        // reenviar o mesmo webhook em loop de retry por causa de um erro nosso.
        return reply.code(200).send({ ok: true, ignorado: true });
      }

      // Webhook não carrega sessão de usuário — não existe accessToken de ninguém para montar
      // `supabaseComoUsuario`. É o mesmo caso do onboarding (routes/instituicoes.ts): uma
      // operação legítima que cruza instituições sem contexto de usuário, por isso usa
      // `supabaseAdmin`. Adicionado à allowlist do guard em supabase-admin.guard.test.ts com esta
      // mesma justificativa.
      const { error } = await fastify.supabaseAdmin
        .from("aulas")
        .update({ video_status: videoStatus })
        .eq("video_externo_id", videoGuid);

      if (error) {
        request.log.error(error);
        return reply.code(500).send({ erro: "Não foi possível atualizar o status do vídeo" });
      }

      return reply.code(200).send({ ok: true });
    },
  );
}
