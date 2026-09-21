// Espelha o contrato acordado com o backend para o editor de conteúdo do
// curso (PLANO-MVP.md, Fatia 2).
export type TipoAula = "video" | "texto" | "pdf" | "ao_vivo";
export type StatusVideo = "processando" | "pronto" | "erro";

export interface Aula {
  id: string;
  moduloId: string;
  titulo: string;
  tipo: TipoAula;
  conteudoUrl: string | null;
  conteudoTexto: string | null;
  ordem: number;
  duracaoEstimadaMin: number | null;
  videoExternoId: string | null;
  videoStatus: StatusVideo | null;
  videoFonte: "bunny" | "youtube" | null;
}

export interface Modulo {
  id: string;
  cursoId: string;
  titulo: string;
  ordem: number;
  aulas: Aula[];
}

// Corpo de POST/PATCH de aula — os quatro campos existem sempre no body,
// mas só o campo relevante ao `tipo` carrega valor (os outros vão `null`).
export interface DadosAula {
  titulo: string;
  tipo: TipoAula;
  conteudoUrl: string | null;
  conteudoTexto: string | null;
  duracaoEstimadaMin: number | null;
}

// Credenciais de upload direto — dois formatos DIFERENTES, um por destino.
// Nunca unificar num tipo genérico de novo: PDF é um PUT único numa signed
// URL do Supabase Storage; vídeo é uma sessão TUS resumável da Bunny (POST de
// criação + PATCH em chunks, escondido dentro do tus-js-client). Ver
// features/cursos/upload.ts para o porquê de serem dois caminhos.

// Resposta de POST /api/aulas/:id/video.
export interface CredenciaisUploadVideo {
  videoId: string;
  libraryId: string;
  authorizationSignature: string;
  authorizationExpire: number;
  tusEndpoint: string;
}

// Resposta de POST /api/aulas/:id/pdf (body: { nomeArquivo }).
export interface CredenciaisUploadPdf {
  path: string;
  token: string;
  signedUrl: string;
}
