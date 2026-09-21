// Tipos da área do aluno, espelhando o contrato do backend (backend/src/routes/aluno.ts)

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
  videoEmbedUrl: string | null;
  concluida: boolean;
}

export interface Modulo {
  id: string;
  titulo: string;
  ordem: number;
  aulas: Aula[];
}

export interface CursoMatriculado {
  id: string;
  titulo: string;
  descricao: string | null;
  capaUrl: string | null;
  matriculaId: string;
  status: string;
  totalAulas: number;
  aulasConcluidas: number;
}

export interface CursoDetalhado {
  id: string;
  titulo: string;
  descricao: string | null;
  matriculaId: string;
  modulos: Modulo[];
}

export interface ResultadoConcluirAula {
  aulaId: string;
  concluida: boolean;
  concluidaEm: string;
}

export interface Certificado {
  id: string;
  codigoValidacao: string;
  emitidoEm: string;
  curso: {
    id: string;
    titulo: string;
  };
}

export interface ErroEmissaoCertificado {
  erro: string;
  aulasConcluidas: number;
  totalAulas: number;
  quizAprovado: boolean;
}
