import { api } from "../../lib/api";
import type { Aluno, AlunoComSenha, Matricula } from "./tipos";

export interface DadosAluno {
  nome: string;
  email: string;
}

export function listarAlunos(status?: string): Promise<Aluno[]> {
  const params = new URLSearchParams();
  if (status) {
    params.append("status", status);
  }
  const query = params.toString();
  const path = query ? `/api/alunos?${query}` : "/api/alunos";
  return api.get<Aluno[]>(path);
}

export function criarAluno(dados: DadosAluno): Promise<AlunoComSenha> {
  return api.post<AlunoComSenha>("/api/alunos", dados);
}

export function aprovarAluno(id: string): Promise<Aluno> {
  return api.post<Aluno>(`/api/alunos/${id}/aprovar`, {});
}

export function recusarAluno(id: string): Promise<Aluno> {
  return api.post<Aluno>(`/api/alunos/${id}/recusar`, {});
}

export function matricularAluno(cursoId: string, alunoId: string): Promise<Matricula> {
  return api.post<Matricula>(`/api/cursos/${cursoId}/matriculas`, { alunoId });
}

export function removerMatricula(cursoId: string, alunoId: string): Promise<{ ok: true }> {
  return api.delete<{ ok: true }>(`/api/cursos/${cursoId}/matriculas/${alunoId}`);
}
