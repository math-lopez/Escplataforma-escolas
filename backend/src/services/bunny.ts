// Integração com Bunny Stream (PLANO-MVP.md §2): a API key nunca pode chegar ao browser, e o
// arquivo de vídeo nunca passa pelo nosso backend (serverless na Vercel, ~4,5MB de limite de
// corpo). O fluxo é: o backend cria o registro do vídeo na Bunny com a API key (server-to-server,
// aqui) e devolve ao client só uma assinatura TUS de curta duração — suficiente para o browser
// fazer o upload resumável direto para a Bunny, sem nunca ver a key.
import { createHash } from "node:crypto";
import { env } from "../env.js";

/** Verifica se as variáveis da Bunny já foram configuradas — ver comentário em env.ts sobre por
 * que elas são opcionais no boot. Rotas de vídeo checam isto e respondem 503 em vez de deixar o
 * `throw` abaixo virar um 500 genérico. */
export function bunnyConfigurado(): boolean {
  return Boolean(env.bunnyApiKey && env.bunnyLibraryId);
}

export class BunnyNaoConfiguradoError extends Error {
  constructor() {
    super("Integração com Bunny Stream não configurada (faltam BUNNY_API_KEY/BUNNY_LIBRARY_ID)");
  }
}

/**
 * URL do player embutido da Bunny para uma aula de vídeo, montada a partir do `libraryId`.
 *
 * Existe porque o frontend NÃO tem como montar essa URL sozinho: ele recebe `videoExternoId`,
 * mas o `libraryId` é configuração de servidor e nunca sai daqui. Sem este helper, cada tela
 * que precisasse reproduzir vídeo acabaria inventando um formato próprio.
 *
 * Devolve `null` quando a Bunny ainda não foi configurada (o projeto sobe sem ela) ou quando a
 * aula ainda não tem vídeo — o frontend trata `null` como "vídeo indisponível" em vez de
 * renderizar um player quebrado. Não embute token de acesso: a proteção de reprodução por
 * token é item de fase 2, e o `videoId` é um uuid não enumerável.
 */
export function urlDeReproducao(videoExternoId: string | null): string | null {
  if (!videoExternoId || !env.bunnyLibraryId) return null;
  return `https://iframe.mediadelivery.net/embed/${env.bunnyLibraryId}/${videoExternoId}`;
}

/** Cria o registro de vídeo na Bunny (POST /library/{id}/videos) e devolve o guid gerado, que
 * vira `aulas.video_externo_id`. Precisa existir ANTES do upload: é o id que a assinatura TUS
 * (gerarAssinaturaUpload) amarra à sessão de upload do browser. */
export async function criarVideoNaBunny(titulo: string): Promise<{ videoId: string }> {
  if (!bunnyConfigurado()) throw new BunnyNaoConfiguradoError();

  const resposta = await fetch(`https://video.bunnycdn.com/library/${env.bunnyLibraryId}/videos`, {
    method: "POST",
    headers: {
      AccessKey: env.bunnyApiKey as string,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: titulo }),
  });

  if (!resposta.ok) {
    throw new Error(`Bunny recusou a criação do vídeo (status ${resposta.status})`);
  }

  const corpo = (await resposta.json()) as { guid: string };
  return { videoId: corpo.guid };
}

const UMA_HORA_EM_SEGUNDOS = 60 * 60;

export interface AssinaturaUploadTus {
  videoId: string;
  libraryId: string;
  authorizationSignature: string;
  authorizationExpire: number;
  tusEndpoint: string;
}

/**
 * Monta a assinatura TUS que o browser usa para subir o arquivo direto para a Bunny. Fórmula
 * documentada pela Bunny para upload resumável (TUS) autenticado sem expor a API key:
 *   AuthorizationSignature = SHA256(libraryId + apiKey + expirationTime + videoId)
 * O client manda `AuthorizationSignature`, `AuthorizationExpire`, `LibraryId` e `VideoId` como
 * headers/metadata da requisição TUS para `tusEndpoint` — a API key em si nunca sai daqui.
 */
export function gerarAssinaturaUpload(videoId: string): AssinaturaUploadTus {
  if (!bunnyConfigurado()) throw new BunnyNaoConfiguradoError();

  const authorizationExpire = Math.floor(Date.now() / 1000) + UMA_HORA_EM_SEGUNDOS;
  const authorizationSignature = createHash("sha256")
    .update(`${env.bunnyLibraryId}${env.bunnyApiKey}${authorizationExpire}${videoId}`)
    .digest("hex");

  return {
    videoId,
    libraryId: env.bunnyLibraryId as string,
    authorizationSignature,
    authorizationExpire,
    tusEndpoint: "https://video.bunnycdn.com/tusupload",
  };
}

/**
 * Mapeia o `Status` numérico que a Bunny manda no webhook de encoding para o enum `video_status`
 * do banco (migration 0010). Códigos conforme a doc pública da Bunny Stream para o objeto vídeo:
 *   0 Created, 1 Uploaded, 2 Processing, 3 Transcoding, 4 Finished, 5 Error, 6 UploadFailed.
 * Isto não foi validado contra uma conta Bunny real (o usuário ainda não criou a conta nesta
 * fatia) — se os códigos mudarem/divergirem, é o único lugar a ajustar.
 */
export function statusParaVideoStatus(status: number): "processando" | "pronto" | "erro" | null {
  if (status === 4) return "pronto";
  if (status === 5 || status === 6) return "erro";
  if (status >= 0 && status <= 3) return "processando";
  return null;
}
