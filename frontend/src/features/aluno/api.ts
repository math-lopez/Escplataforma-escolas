import { api } from "../../lib/api";
import type {
  CursoDetalhado,
  CursoMatriculado,
  ResultadoConcluirAula,
  Certificado,
} from "./tipos";

/**
 * GET /api/aluno/cursos
 * Lista os cursos em que o aluno está matriculado, com progresso.
 */
export function listarMeusCursos(): Promise<CursoMatriculado[]> {
  return api.get<CursoMatriculado[]>("/api/aluno/cursos");
}

/**
 * GET /api/aluno/cursos/:cursoId
 * Detalhes de um curso matriculado: módulos, aulas e progresso.
 */
export function buscarCursoMatriculado(cursoId: string): Promise<CursoDetalhado> {
  return api.get<CursoDetalhado>(`/api/aluno/cursos/${cursoId}`);
}

/**
 * POST /api/aluno/aulas/:aulaId/concluir
 * Marca uma aula como concluída.
 */
export function marcarAulaConcluida(aulaId: string): Promise<ResultadoConcluirAula> {
  return api.post<ResultadoConcluirAula>(`/api/aluno/aulas/${aulaId}/concluir`, {});
}

/**
 * DELETE /api/aluno/aulas/:aulaId/concluir
 * Desmarcar uma aula como concluída.
 */
export function desmarcarAulaConcluida(aulaId: string): Promise<void> {
  return api.delete<void>(`/api/aluno/aulas/${aulaId}/concluir`);
}

/**
 * GET /api/aluno/aulas/:aulaId/material
 * Gera uma URL assinada para download/visualização do material PDF.
 * A URL expira em 5 minutos.
 */
export interface RespostaMaterial {
  url: string;
  expiraEm: string;
}

export function buscarMaterialAula(aulaId: string): Promise<RespostaMaterial> {
  return api.get<RespostaMaterial>(`/api/aluno/aulas/${aulaId}/material`);
}

/**
 * POST /api/aluno/cursos/:cursoId/certificado
 * Emite um novo certificado ou retorna o existente para o aluno.
 */
export function emitirCertificado(cursoId: string): Promise<Certificado> {
  return api.post<Certificado>(`/api/aluno/cursos/${cursoId}/certificado`, {});
}

/**
 * GET /api/aluno/certificados
 * Lista todos os certificados do aluno.
 */
export function listarCertificados(): Promise<Certificado[]> {
  return api.get<Certificado[]>("/api/aluno/certificados");
}
