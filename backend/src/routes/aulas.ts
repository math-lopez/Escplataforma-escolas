import type { FastifyInstance } from "fastify";
import {
  COLUNAS_AULA,
  buscarAulaDaInstituicao,
  buscarModuloDaInstituicao,
  duracaoParaColuna,
  duracaoValida,
  paraApiAula,
  textoOpcional,
  tipoAulaValido,
  tituloValido,
  type LinhaAula,
} from "../services/conteudoCurso.js";
import { bunnyConfigurado, criarVideoNaBunny, gerarAssinaturaUpload } from "../services/bunny.js";
import { extrairIdDoYoutube } from "../services/youtube.js";

interface ModuloParams {
  moduloId: string;
}

interface AulaParams {
  id: string;
}

interface AulaBody {
  titulo?: unknown;
  tipo?: unknown;
  conteudoUrl?: unknown;
  conteudoTexto?: unknown;
  duracaoEstimadaMin?: unknown;
  // videoExternoId/videoStatus podem vir no corpo (cliente malicioso ou desatualizado) — são
  // deliberadamente ignorados: só mudam via POST /api/aulas/:id/video e o webhook da Bunny.
}

interface OrdemBody {
  ids?: unknown;
}

interface PdfBody {
  nomeArquivo?: unknown;
}

const PAPEIS_STAFF = ["admin_instituicao", "professor"] as const;

function sanitizarNomeArquivo(valor: unknown): string {
  const bruto = typeof valor === "string" && valor.trim().length > 0 ? valor.trim() : "material.pdf";
  // Remove tudo que não seja letra/número/ponto/hífen/underscore — impede path traversal (barras,
  // "../") no caminho montado em POST /:id/pdf, cujo primeiro segmento TEM que continuar sendo o
  // instituicao_id (convenção da migration 0011) para as policies de storage funcionarem.
  const limpo = bruto.replace(/[^a-zA-Z0-9._-]/g, "_");
  return limpo.toLowerCase().endsWith(".pdf") ? limpo : `${limpo}.pdf`;
}

export default async function aulasRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: ModuloParams; Body: AulaBody }>(
    "/api/modulos/:moduloId/aulas",
    { onRequest: [fastify.exigirPapel(...PAPEIS_STAFF)] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { moduloId } = request.params;
      const corpo = request.body ?? {};

      if (!tituloValido(corpo.titulo)) return reply.code(400).send({ erro: "Título é obrigatório" });
      if (!tipoAulaValido(corpo.tipo)) return reply.code(400).send({ erro: "Tipo de aula inválido" });
      if (!duracaoValida(corpo.duracaoEstimadaMin)) {
        return reply.code(400).send({ erro: "Duração estimada inválida" });
      }

      const modulo = await buscarModuloDaInstituicao(fastify, request.accessToken!, moduloId, usuario.instituicaoId);
      if (!modulo) return reply.code(404).send({ erro: "Módulo não encontrado" });

      const cliente = fastify.supabaseComoUsuario(request.accessToken!);

      const { count, error: erroContagem } = await cliente
        .from("aulas")
        .select("id", { count: "exact", head: true })
        .eq("modulo_id", moduloId);

      if (erroContagem) {
        request.log.error(erroContagem);
        return reply.code(500).send({ erro: "Não foi possível criar a aula" });
      }

      // video_externo_id/video_status nunca são passados aqui — ficam null até o fluxo de
      // upload de vídeo (POST /:id/video) ou o webhook da Bunny os preencherem.
      const { data, error } = await cliente
        .from("aulas")
        .insert({
          modulo_id: moduloId,
          titulo: corpo.titulo.trim(),
          tipo: corpo.tipo,
          conteudo_url: textoOpcional(corpo.conteudoUrl),
          conteudo_texto: textoOpcional(corpo.conteudoTexto),
          duracao_estimada_min: duracaoParaColuna(corpo.duracaoEstimadaMin),
          ordem: count ?? 0,
        })
        .select(COLUNAS_AULA)
        .single();

      if (error || !data) {
        request.log.error(error);
        return reply.code(500).send({ erro: "Não foi possível criar a aula" });
      }

      return reply.code(201).send(paraApiAula(data as LinhaAula));
    },
  );

  fastify.patch<{ Params: AulaParams; Body: AulaBody }>(
    "/api/aulas/:id",
    { onRequest: [fastify.exigirPapel(...PAPEIS_STAFF)] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { id } = request.params;
      const corpo = request.body ?? {};

      if ("titulo" in corpo && !tituloValido(corpo.titulo)) {
        return reply.code(400).send({ erro: "Título não pode ser vazio" });
      }
      if ("tipo" in corpo && !tipoAulaValido(corpo.tipo)) {
        return reply.code(400).send({ erro: "Tipo de aula inválido" });
      }
      if ("duracaoEstimadaMin" in corpo && !duracaoValida(corpo.duracaoEstimadaMin)) {
        return reply.code(400).send({ erro: "Duração estimada inválida" });
      }

      // Verificação central: aula existe, mas pertence a um módulo/curso de outra instituição?
      // Sem isto, um `.eq("id", id)` sozinho no update abaixo deixaria um professor da
      // instituição A editar aula de curso da instituição B.
      const aula = await buscarAulaDaInstituicao(fastify, request.accessToken!, id, usuario.instituicaoId);
      if (!aula) return reply.code(404).send({ erro: "Aula não encontrada" });

      // Monta só com os campos do contrato — instituicaoId não existe aqui, e
      // videoExternoId/videoStatus do corpo (se vierem) nunca são lidos: só a chave "camelCase"
      // exata usada abaixo é considerada, então mesmo um corpo com `video_externo_id` (snake) ou
      // `videoExternoId` não altera nada, porque nenhum dos dois é testado com `in corpo` aqui.
      const atualizacoes: Record<string, unknown> = {};
      if ("titulo" in corpo) atualizacoes.titulo = (corpo.titulo as string).trim();
      if ("tipo" in corpo) atualizacoes.tipo = corpo.tipo;
      if ("conteudoUrl" in corpo) atualizacoes.conteudo_url = textoOpcional(corpo.conteudoUrl);
      if ("conteudoTexto" in corpo) atualizacoes.conteudo_texto = textoOpcional(corpo.conteudoTexto);
      if ("duracaoEstimadaMin" in corpo) {
        atualizacoes.duracao_estimada_min = duracaoParaColuna(
          corpo.duracaoEstimadaMin as number | null | undefined,
        );
      }

      if (Object.keys(atualizacoes).length === 0) {
        return reply.code(400).send({ erro: "Nenhum campo para atualizar" });
      }

      const { data, error } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("aulas")
        .update(atualizacoes)
        .eq("id", id)
        .select(COLUNAS_AULA)
        .single();

      if (error || !data) {
        request.log.error(error);
        return reply.code(500).send({ erro: "Não foi possível atualizar a aula" });
      }

      return paraApiAula(data as LinhaAula);
    },
  );

  fastify.delete<{ Params: AulaParams }>(
    "/api/aulas/:id",
    { onRequest: [fastify.exigirPapel(...PAPEIS_STAFF)] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { id } = request.params;

      const aula = await buscarAulaDaInstituicao(fastify, request.accessToken!, id, usuario.instituicaoId);
      if (!aula) return reply.code(404).send({ erro: "Aula não encontrada" });

      const { error } = await fastify.supabaseComoUsuario(request.accessToken!).from("aulas").delete().eq("id", id);

      if (error) {
        request.log.error(error);
        return reply.code(500).send({ erro: "Não foi possível remover a aula" });
      }

      return reply.code(204).send();
    },
  );

  fastify.put<{ Params: ModuloParams; Body: OrdemBody }>(
    "/api/modulos/:moduloId/aulas/ordem",
    { onRequest: [fastify.exigirPapel(...PAPEIS_STAFF)] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { moduloId } = request.params;
      const ids = request.body?.ids;

      if (!Array.isArray(ids) || ids.length === 0 || !ids.every((valor) => typeof valor === "string")) {
        return reply.code(400).send({ erro: "Lista de ids inválida" });
      }

      const modulo = await buscarModuloDaInstituicao(fastify, request.accessToken!, moduloId, usuario.instituicaoId);
      if (!modulo) return reply.code(404).send({ erro: "Módulo não encontrado" });

      const cliente = fastify.supabaseComoUsuario(request.accessToken!);

      const { data: existentes, error: erroExistentes } = await cliente
        .from("aulas")
        .select("id")
        .eq("modulo_id", moduloId);

      if (erroExistentes) {
        request.log.error(erroExistentes);
        return reply.code(500).send({ erro: "Não foi possível reordenar as aulas" });
      }

      const idsExistentes = new Set(((existentes as { id: string }[] | null) ?? []).map((a) => a.id));

      // Mesma regra da reordenação de módulos: todo id da lista precisa pertencer a ESTE módulo,
      // e a lista precisa cobrir exatamente as aulas existentes — senão um id de outra
      // instituição entraria na reordenação sem checagem de posse nenhuma.
      const listaValida =
        ids.length === idsExistentes.size && ids.every((id) => idsExistentes.has(id as string));
      if (!listaValida) {
        return reply.code(400).send({ erro: "Lista de ids não corresponde às aulas deste módulo" });
      }

      const resultados = await Promise.all(
        (ids as string[]).map((id, indice) =>
          cliente.from("aulas").update({ ordem: indice }).eq("id", id).eq("modulo_id", moduloId),
        ),
      );

      if (resultados.some((r) => r.error)) {
        request.log.error("Falha ao atualizar ordem das aulas");
        return reply.code(500).send({ erro: "Não foi possível reordenar as aulas" });
      }

      return reply.code(204).send();
    },
  );

  fastify.post<{ Params: AulaParams }>(
    "/api/aulas/:id/video",
    { onRequest: [fastify.exigirPapel(...PAPEIS_STAFF)] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { id } = request.params;

      const aula = await buscarAulaDaInstituicao(fastify, request.accessToken!, id, usuario.instituicaoId);
      if (!aula) return reply.code(404).send({ erro: "Aula não encontrada" });

      if (aula.tipo !== "video") {
        return reply.code(400).send({ erro: "Upload de vídeo só é permitido para aula do tipo 'video'" });
      }

      if (!bunnyConfigurado()) {
        return reply
          .code(503)
          .send({ erro: "Integração com Bunny Stream ainda não configurada (BUNNY_API_KEY/BUNNY_LIBRARY_ID)" });
      }

      let videoId: string;
      try {
        const criado = await criarVideoNaBunny(aula.titulo);
        videoId = criado.videoId;
      } catch (erro) {
        request.log.error(erro);
        return reply.code(502).send({ erro: "Não foi possível criar o vídeo na Bunny" });
      }

      const { error } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("aulas")
        .update({ video_externo_id: videoId, video_status: "processando", video_fonte: "bunny" })
        .eq("id", id);

      if (error) {
        request.log.error(error);
        return reply.code(500).send({ erro: "Vídeo criado na Bunny, mas não foi possível salvar na aula" });
      }

      // Só o necessário para o upload TUS direto do browser — nunca a API key (ver services/bunny.ts).
      return reply.code(201).send(gerarAssinaturaUpload(videoId));
    },
  );

  fastify.put<{ Params: AulaParams; Body: { url: unknown } }>(
    "/api/aulas/:id/video-youtube",
    { onRequest: [fastify.exigirPapel(...PAPEIS_STAFF)] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { id } = request.params;
      const corpo = request.body ?? {};

      // Verificação central: aula pertence a esta instituição — sem isto, um professor de
      // instituição A poderia apontar para um vídeo YouTube de um módulo de instituição B.
      const aula = await buscarAulaDaInstituicao(fastify, request.accessToken!, id, usuario.instituicaoId);
      if (!aula) return reply.code(404).send({ erro: "Aula não encontrada" });

      if (aula.tipo !== "video") {
        return reply.code(400).send({ erro: "Upload de vídeo só é permitido para aula do tipo 'video'" });
      }

      // Extrai e valida o id do YouTube a partir da URL colada
      const videoUrl = typeof corpo.url === "string" ? corpo.url.trim() : "";
      const videoId = extrairIdDoYoutube(videoUrl);

      if (!videoId) {
        return reply.code(400).send({
          erro: "URL do YouTube inválida. Use um link como youtube.com/watch?v=<id>, youtu.be/<id>, ou similar",
        });
      }

      // YouTube não tem encoding assíncrono — o vídeo já está disponível direto
      const { data, error } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("aulas")
        .update({
          video_externo_id: videoId,
          video_fonte: "youtube",
          video_status: "pronto",
        })
        .eq("id", id)
        .select(COLUNAS_AULA)
        .single();

      if (error || !data) {
        request.log.error(error);
        return reply.code(500).send({ erro: "Não foi possível salvar o vídeo na aula" });
      }

      return reply.code(200).send(paraApiAula(data as LinhaAula));
    },
  );

  fastify.post<{ Params: AulaParams; Body: PdfBody }>(
    "/api/aulas/:id/pdf",
    { onRequest: [fastify.exigirPapel(...PAPEIS_STAFF)] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { id } = request.params;
      const corpo = request.body ?? {};

      const aula = await buscarAulaDaInstituicao(fastify, request.accessToken!, id, usuario.instituicaoId);
      if (!aula) return reply.code(404).send({ erro: "Aula não encontrada" });

      if (aula.tipo !== "pdf") {
        return reply.code(400).send({ erro: "Upload de PDF só é permitido para aula do tipo 'pdf'" });
      }

      const nomeArquivo = sanitizarNomeArquivo(corpo.nomeArquivo);
      // Convenção de caminho da migration 0011 (ver comentário no topo dela): o primeiro
      // segmento é SEMPRE o instituicao_id — é o que a policy `materiais_insert_staff`
      // (storage.foldername(name)[1] = instituicao_atual()) exige para autorizar o upload via
      // RLS. Vem sempre de `usuario.instituicaoId` (a sessão), nunca de nada vindo do client.
      const caminho = `${usuario.instituicaoId}/aulas/${id}/${nomeArquivo}`;

      const cliente = fastify.supabaseComoUsuario(request.accessToken!);

      const { data, error } = await cliente.storage.from("materiais").createSignedUploadUrl(caminho);

      if (error || !data) {
        request.log.error(error);
        return reply.code(500).send({ erro: "Não foi possível gerar a URL de upload" });
      }

      // Salva o caminho já agora (antes do upload em si terminar) — mesmo padrão do fluxo de
      // vídeo: o client recebe uma URL determinística e o backend já sabe onde o arquivo vai
      // ficar assim que o upload direto ao Storage for concluído.
      const { error: erroUpdate } = await cliente.from("aulas").update({ conteudo_url: caminho }).eq("id", id);

      if (erroUpdate) {
        request.log.error(erroUpdate);
        return reply.code(500).send({ erro: "URL de upload gerada, mas não foi possível salvar na aula" });
      }

      return reply.code(201).send({ path: data.path, token: data.token, signedUrl: data.signedUrl });
    },
  );
}
