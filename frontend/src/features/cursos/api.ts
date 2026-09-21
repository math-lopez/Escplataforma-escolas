import { api } from "../../lib/api";
import type { Curso } from "./tipos";

export interface DadosCurso {
  titulo: string;
  descricao?: string | null;
  publicado?: boolean;
}

export function listarCursos(): Promise<Curso[]> {
  return api.get<Curso[]>("/api/cursos");
}

export function buscarCurso(id: string): Promise<Curso> {
  return api.get<Curso>(`/api/cursos/${id}`);
}

export function criarCurso(dados: DadosCurso): Promise<Curso> {
  return api.post<Curso>("/api/cursos", dados);
}

export function atualizarCurso(id: string, dados: Partial<DadosCurso>): Promise<Curso> {
  return api.patch<Curso>(`/api/cursos/${id}`, dados);
}

export function excluirCurso(id: string): Promise<{ ok: true }> {
  return api.delete<{ ok: true }>(`/api/cursos/${id}`);
}
