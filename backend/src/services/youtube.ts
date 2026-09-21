/**
 * Integração com vídeos do YouTube (alternativa ao upload pela Bunny Stream).
 * O professor cola a URL do vídeo que já tem publicado no YouTube, e o backend
 * extrai e valida o id para garantir que nenhuma URL bruta (potencialmente
 * maliciosa) seja guardada — a URL de reprodução é montada no servidor.
 */

/**
 * Extrai e valida o id de um vídeo do YouTube a partir de uma URL.
 *
 * Aceita formatos comuns:
 *   - https://www.youtube.com/watch?v=<id>
 *   - https://youtu.be/<id>
 *   - https://www.youtube.com/embed/<id>
 *   - https://www.youtube.com/shorts/<id>
 *   - Com parâmetros extras como ?t=30
 *
 * Um id válido do YouTube tem exatamente 11 caracteres de [A-Za-z0-9_-].
 *
 * Devolve `null` quando:
 * - Não consegue extrair um id válido
 * - A URL não é do YouTube
 * - O id não tem o formato correto
 *
 * @param url - URL colada pelo professor
 * @returns O id de 11 caracteres, ou null
 */
export function extrairIdDoYoutube(url: string): string | null {
  if (!url || typeof url !== "string") return null;

  // Padrão para id válido do YouTube (11 caracteres)
  const padraoId = /^[A-Za-z0-9_-]{11}$/;

  // 1. youtu.be/<id> (URL abreviada)
  const matchYoutuBe = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (matchYoutuBe) return matchYoutuBe[1];

  // 2. youtube.com/watch?v=<id> (URL padrão com watch)
  const matchWatch = url.match(/youtube\.com\/watch\?.*v=([A-Za-z0-9_-]{11})/);
  if (matchWatch) return matchWatch[1];

  // 3. youtube.com/embed/<id>
  const matchEmbed = url.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/);
  if (matchEmbed) return matchEmbed[1];

  // 4. youtube.com/shorts/<id>
  const matchShorts = url.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/);
  if (matchShorts) return matchShorts[1];

  return null;
}

/**
 * Monta a URL de reprodução para um vídeo do YouTube.
 *
 * Usa o domínio `youtube-nocookie.com` em vez de `youtube.com` como estratégia
 * de privacidade: o YouTube não grava cookies de rastreamento no navegador do
 * aluno até que ele dê play no vídeo, o que reduz exposição de dados.
 *
 * @param videoId - Id do vídeo (11 caracteres)
 * @returns URL de embed para uso em <iframe src="...">
 */
export function urlDeReproducaoYoutube(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}`;
}
