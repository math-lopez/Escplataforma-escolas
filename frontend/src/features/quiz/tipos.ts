export interface Alternativa {
  id: string;
  perguntaId: string;
  texto: string;
  correta?: boolean; // presente apenas no lado do professor
}

export interface Pergunta {
  id: string;
  quizId: string;
  enunciado: string;
  ordem: number;
  alternativas: Alternativa[];
}

export interface Quiz {
  id: string;
  cursoId: string;
  titulo: string;
  notaMinimaAprovacao: number;
  perguntas: Pergunta[];
}

export interface TentativaQuiz {
  id: string;
  quizId: string;
  alunoId: string;
  nota: number | null;
  aprovado: boolean | null;
  respostas: Record<string, string> | null;
  finalizadaEm: string | null;
}

export interface ResultadoTentativa {
  id: string;
  nota: number;
  aprovado: boolean;
  totalPerguntas: number;
  acertos: number;
  finalizadaEm: string;
}
