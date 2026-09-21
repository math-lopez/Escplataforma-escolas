import { api } from "../../lib/api";
import type { Aula, CredenciaisUploadPdf, CredenciaisUploadVideo, DadosAula, Modulo } from "./tiposConteudo";

export function listarModulos(cursoId: string): Promise<Modulo[]> {
  return api.get<Modulo[]>(`/api/cursos/${cursoId}/modulos`);
}

export function criarModulo(cursoId: string, titulo: string): Promise<Modulo> {
  return api.post<Modulo>(`/api/cursos/${cursoId}/modulos`, { titulo });
}

export function atualizarModulo(id: string, titulo: string): Promise<Modulo> {
  return api.patch<Modulo>(`/api/modulos/${id}`, { titulo });
}

export function excluirModulo(id: string): Promise<{ ok: true }> {
  return api.delete<{ ok: true }>(`/api/modulos/${id}`);
}

export function reordenarModulos(cursoId: string, ids: string[]): Promise<Modulo[]> {
  return api.put<Modulo[]>(`/api/cursos/${cursoId}/modulos/ordem`, { ids });
}

export function criarAula(moduloId: string, dados: DadosAula): Promise<Aula> {
  return api.post<Aula>(`/api/modulos/${moduloId}/aulas`, dados);
}

export function atualizarAula(id: string, dados: Partial<DadosAula>): Promise<Aula> {
  return api.patch<Aula>(`/api/aulas/${id}`, dados);
}

export function excluirAula(id: string): Promise<{ ok: true }> {
  return api.delete<{ ok: true }>(`/api/aulas/${id}`);
}

export function reordenarAulas(moduloId: string, ids: string[]): Promise<Aula[]> {
  return api.put<Aula[]>(`/api/modulos/${moduloId}/aulas/ordem`, { ids });
}

export function solicitarUploadVideo(aulaId: string): Promise<CredenciaisUploadVideo> {
  return api.post<CredenciaisUploadVideo>(`/api/aulas/${aulaId}/video`);
}

export function solicitarUploadPdf(aulaId: string, nomeArquivo: string): Promise<CredenciaisUploadPdf> {
  return api.post<CredenciaisUploadPdf>(`/api/aulas/${aulaId}/pdf`, { nomeArquivo });
}

export function enviarLinkYoutube(aulaId: string, url: string): Promise<Aula> {
  return api.put<Aula>(`/api/aulas/${aulaId}/video-youtube`, { url });
}
