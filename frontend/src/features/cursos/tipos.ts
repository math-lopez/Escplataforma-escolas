// Espelha o contrato acordado com o backend (PLANO-MVP.md, Fatia 1).
export interface Curso {
  id: string;
  titulo: string;
  descricao: string | null;
  capaUrl: string | null;
  publicado: boolean;
  criadoPor: string | null;
  criadoEm: string;
}
