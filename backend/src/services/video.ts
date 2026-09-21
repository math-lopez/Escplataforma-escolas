/**
 * Ponto único que monta a URL de reprodução de uma aula de vídeo.
 *
 * Conforme novos provedores são suportados (Bunny, YouTube, Vimeo, etc.), esta
 * função centraliza a lógica de decidir qual URL usar, evitando que cada rota
 * de cliente (professores, alunos) tenha que conhecer todos os provedores.
 *
 * A segurança depende de:
 * 1. Nunca guardar a URL crua colada pelo usuário — apenas o ID no provedor
 * 2. Montar a URL de reprodução aqui (no servidor), nunca no frontend
 * 3. Se a URL é null (provedor não configurado), o cliente trata como
 *    "vídeo indisponível" (mostra placeholder, não erro genérico)
 */

import { urlDeReproducao } from "./bunny.js";
import { urlDeReproducaoYoutube } from "./youtube.js";

export function urlDeReproducaoVideo(
  videoFonte: string | null,
  videoExternoId: string | null,
): string | null {
  if (!videoExternoId) return null;

  if (videoFonte === "youtube") {
    return urlDeReproducaoYoutube(videoExternoId);
  }

  if (videoFonte === "bunny") {
    return urlDeReproducao(videoExternoId);
  }

  // Fonte desconhecida ou null — aula não tem vídeo atribuído
  return null;
}
