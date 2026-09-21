import type { FastifyInstance } from "fastify";

// Único ponto que resolve a pergunta "este moduloId/aulaId pertence a um curso da instituição X?"
// Diferente de cursos.ts: `modulos` e `aulas` NÃO têm coluna `instituicao_id` — o isolamento só
// existe via join até `cursos` (aulas -> modulos -> cursos -> instituicao_id). Um `.eq("id", ...)`
// sozinho, como em cursos.ts, não isola nada aqui. Toda rota de modulos.ts e aulas.ts que recebe
// um id na URL chama uma destas funções ANTES de ler ou escrever — é a linha central de defesa
// desta fatia (ver CLAUDE.md do agente que escreveu isto).

export type TipoAula = "video" | "texto" | "pdf" | "ao_vivo";
export type StatusVideo = "processando" | "pronto" | "erro";

export const COLUNAS_MODULO = "id, curso_id, titulo, ordem";
export const COLUNAS_AULA =
  "id, modulo_id, titulo, tipo, conteudo_url, conteudo_texto, ordem, duracao_estimada_min, video_externo_id, video_status, video_fonte";

export interface LinhaModulo {
  id: string;
  curso_id: string;
  titulo: string;
  ordem: number;
}

export interface LinhaAula {
  id: string;
  modulo_id: string;
  titulo: string;
  tipo: TipoAula;
  conteudo_url: string | null;
  conteudo_texto: string | null;
  ordem: number;
  duracao_estimada_min: number | null;
  video_externo_id: string | null;
  video_status: StatusVideo | null;
  video_fonte: string | null;
}

export function paraApiModulo(linha: LinhaModulo, aulas: LinhaAula[]) {
  return {
    id: linha.id,
    cursoId: linha.curso_id,
    titulo: linha.titulo,
    ordem: linha.ordem,
    aulas: aulas.map(paraApiAula),
  };
}

export function paraApiAula(linha: LinhaAula) {
  return {
    id: linha.id,
    moduloId: linha.modulo_id,
    titulo: linha.titulo,
    tipo: linha.tipo,
    conteudoUrl: linha.conteudo_url,
    conteudoTexto: linha.conteudo_texto,
    ordem: linha.ordem,
    duracaoEstimadaMin: linha.duracao_estimada_min,
    videoExternoId: linha.video_externo_id,
    videoStatus: linha.video_status,
    videoFonte: linha.video_fonte,
  };
}

/** Confirma que `cursoId` pertence a `instituicaoId` — mesmo padrão de filtro de cursos.ts. */
export async function buscarCursoDaInstituicao(
  fastify: FastifyInstance,
  accessToken: string,
  cursoId: string,
  instituicaoId: string,
): Promise<{ id: string } | null> {
  const { data, error } = await fastify
    .supabaseComoUsuario(accessToken)
    .from("cursos")
    .select("id")
    .eq("id", cursoId)
    .eq("instituicao_id", instituicaoId)
    .single();

  if (error || !data) return null;
  return data as { id: string };
}

/**
 * Confirma que `moduloId` pertence a um curso de `instituicaoId`, via join até `cursos`.
 *
 * `cursos!inner(instituicao_id)` é o que torna o `.eq("cursos.instituicao_id", ...)` abaixo uma
 * defesa de verdade: por padrão o embed do Postgrest é um LEFT JOIN, e um filtro num embed de
 * LEFT JOIN não elimina a linha externa (o módulo apareceria com o campo aninhado vazio, mas
 * ainda seria devolvido). `!inner` força INNER JOIN, então quando `cursos.instituicao_id` não
 * bate com o filtro, a linha do módulo inteira some do resultado — é isso que faz `.single()`
 * devolver erro/"sem linha" para um módulo de outra instituição, em vez de devolvê-lo mesmo assim.
 */
export async function buscarModuloDaInstituicao(
  fastify: FastifyInstance,
  accessToken: string,
  moduloId: string,
  instituicaoId: string,
): Promise<LinhaModulo | null> {
  const { data, error } = await fastify
    .supabaseComoUsuario(accessToken)
    .from("modulos")
    .select(`${COLUNAS_MODULO}, cursos!inner(instituicao_id)`)
    .eq("id", moduloId)
    .eq("cursos.instituicao_id", instituicaoId)
    .single();

  if (error || !data) return null;

  // O objeto "cursos" embutido só serviu para o filtro acima — não faz parte do contrato de
  // Modulo, por isso a resposta é remontada explicitamente com só os campos de COLUNAS_MODULO.
  const linha = data as LinhaModulo & { cursos: unknown };
  return { id: linha.id, curso_id: linha.curso_id, titulo: linha.titulo, ordem: linha.ordem };
}

/**
 * Confirma que `aulaId` pertence a um módulo de um curso de `instituicaoId`. Em vez de embutir
 * dois níveis de join numa query só (aulas -> modulos -> cursos, que dependeria do Postgrest
 * aceitar filtro num embed aninhado em dois níveis), reaproveita `buscarModuloDaInstituicao` —
 * mais previsível, mais fácil de testar, ao custo de uma segunda ida ao banco por requisição.
 */
export async function buscarAulaDaInstituicao(
  fastify: FastifyInstance,
  accessToken: string,
  aulaId: string,
  instituicaoId: string,
): Promise<LinhaAula | null> {
  const { data, error } = await fastify
    .supabaseComoUsuario(accessToken)
    .from("aulas")
    .select(COLUNAS_AULA)
    .eq("id", aulaId)
    .single();

  if (error || !data) return null;

  const linhaAula = data as LinhaAula;
  const modulo = await buscarModuloDaInstituicao(fastify, accessToken, linhaAula.modulo_id, instituicaoId);
  // Aula existe, mas o módulo dela não é de um curso desta instituição — mesmo 404 de "não
  // existe" (não distinguir os dois casos evita vazar, por diferença de resposta, que o id é
  // válido só que pertence a outro tenant).
  if (!modulo) return null;

  return linhaAula;
}

/** Lista as aulas de um módulo já validado, ordenadas — usado para recompor `Modulo.aulas`
 * depois de uma operação (ex.: renomear módulo) que não mexeu nas aulas em si. */
export async function buscarAulasDoModulo(
  fastify: FastifyInstance,
  accessToken: string,
  moduloId: string,
): Promise<LinhaAula[]> {
  const { data, error } = await fastify
    .supabaseComoUsuario(accessToken)
    .from("aulas")
    .select(COLUNAS_AULA)
    .eq("modulo_id", moduloId)
    .order("ordem", { ascending: true });

  if (error || !data) return [];
  return data as unknown as LinhaAula[];
}

/** Título é a única obrigatoriedade do contrato de módulo/aula; mesma regra de cursos.ts. */
export function tituloValido(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim().length > 0;
}

const TIPOS_AULA: TipoAula[] = ["video", "texto", "pdf", "ao_vivo"];

export function tipoAulaValido(valor: unknown): valor is TipoAula {
  return typeof valor === "string" && (TIPOS_AULA as string[]).includes(valor);
}

export function textoOpcional(valor: unknown): string | null {
  return valor === undefined || valor === null ? null : String(valor);
}

/** undefined/null viram null (campo não informado); qualquer outra coisa que não seja um número
 * finito não-negativo é inválida — usar junto de uma checagem de 400 na rota, não silenciosa. */
export function duracaoValida(valor: unknown): valor is number | null | undefined {
  return (
    valor === undefined ||
    valor === null ||
    (typeof valor === "number" && Number.isFinite(valor) && valor >= 0)
  );
}

export function duracaoParaColuna(valor: number | null | undefined): number | null {
  return valor === undefined || valor === null ? null : Math.trunc(valor);
}
