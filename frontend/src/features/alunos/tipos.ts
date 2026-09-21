export interface Aluno {
  id: string;
  nome: string;
  papel: string;
  status: string;
  criadoEm: string;
}

export interface AlunoComSenha extends Aluno {
  senhaProvisoria: string;
}

export interface Matricula {
  id: string;
  cursoId: string;
  alunoId: string;
  status: string;
  matriculadoEm: string;
}
