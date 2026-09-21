import { api } from "../../lib/api";
import type { Instituicao, RespostaInscricao, CertificadoValidacao } from "./tipos";

export async function buscarInstituicaoPublica(slug: string): Promise<Instituicao> {
  return api.get<Instituicao>(`/api/publico/instituicoes/${slug}`);
}

export async function inscreverInstituicao(
  slug: string,
  dados: { nome: string; email: string; senha: string },
): Promise<RespostaInscricao> {
  return api.post<RespostaInscricao>(`/api/publico/instituicoes/${slug}/inscricao`, dados);
}

/**
 * GET /api/publico/certificados/:codigo
 * Valida um certificado usando seu código de validação.
 */
export async function validarCertificado(codigo: string): Promise<CertificadoValidacao> {
  return api.get<CertificadoValidacao>(`/api/publico/certificados/${codigo}`);
}
