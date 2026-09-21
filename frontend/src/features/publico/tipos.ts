// Espelha o contrato da API em backend/src/routes/publico.ts
export interface Instituicao {
  nome: string;
  slug: string;
  logoUrl: string | null;
  corPrimaria: string | null;
  modoIngresso: string;
  cursos: Curso[];
}

export interface Curso {
  id: string;
  titulo: string;
  descricao: string | null;
  capaUrl: string | null;
}

export interface RespostaInscricao {
  status: string;
  mensagem: string;
  instituicao: {
    nome: string;
    slug: string;
  };
}

export interface CertificadoValidacao {
  aluno: {
    nome: string;
  };
  curso: {
    titulo: string;
  };
  instituicao: {
    nome: string;
  };
  emitidoEm: string;
}
