import { api } from "../../lib/api";
import type {
  Quiz,
  TentativaQuiz,
  ResultadoTentativa,
} from "./tipos";

/**
 * GET /api/cursos/:cursoId/quiz
 * Carrega o quiz do curso (com as alternativas corretas visíveis).
 * Staff only.
 */
export function carregarQuizProfessor(cursoId: string): Promise<Quiz> {
  return api.get<Quiz>(`/api/cursos/${cursoId}/quiz`);
}

/**
 * PUT /api/cursos/:cursoId/quiz
 * Cria ou substitui o quiz inteiro.
 * Staff only.
 */
export interface DadosQuiz {
  titulo: string;
  notaMinimaAprovacao: number;
  perguntas: Array<{
    enunciado: string;
    ordem?: number;
    alternativas: Array<{
      texto: string;
      correta: boolean;
    }>;
  }>;
}

export function salvarQuiz(cursoId: string, dados: DadosQuiz): Promise<Quiz> {
  return api.put<Quiz>(`/api/cursos/${cursoId}/quiz`, dados);
}

/**
 * DELETE /api/cursos/:cursoId/quiz
 * Deleta o quiz do curso.
 * Staff only.
 */
export function deletarQuiz(cursoId: string): Promise<void> {
  return api.delete<void>(`/api/cursos/${cursoId}/quiz`);
}

/**
 * GET /api/aluno/cursos/:cursoId/quiz
 * Carrega o quiz para o aluno responder (sem revelar alternativas corretas).
 * Aluno only.
 */
export function carregarQuizAluno(cursoId: string): Promise<Quiz> {
  return api.get<Quiz>(`/api/aluno/cursos/${cursoId}/quiz`);
}

/**
 * POST /api/aluno/cursos/:cursoId/quiz/tentativas
 * Submete as respostas do aluno e retorna o resultado.
 * Aluno only.
 */
export function submeterTentativa(
  cursoId: string,
  respostas: Record<string, string>,
): Promise<ResultadoTentativa> {
  return api.post<ResultadoTentativa>(
    `/api/aluno/cursos/${cursoId}/quiz/tentativas`,
    { respostas },
  );
}

/**
 * GET /api/aluno/cursos/:cursoId/quiz/tentativas
 * Lista as tentativas anteriores do aluno neste quiz.
 * Aluno only.
 */
export function listarTentativas(cursoId: string): Promise<TentativaQuiz[]> {
  return api.get<TentativaQuiz[]>(
    `/api/aluno/cursos/${cursoId}/quiz/tentativas`,
  );
}
