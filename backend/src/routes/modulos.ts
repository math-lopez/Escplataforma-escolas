import type { FastifyInstance } from "fastify";
import {
  COLUNAS_AULA,
  COLUNAS_MODULO,
  buscarAulasDoModulo,
  buscarCursoDaInstituicao,
  buscarModuloDaInstituicao,
  paraApiModulo,
  tituloValido,
  type LinhaAula,
  type LinhaModulo,
} from "../services/conteudoCurso.js";

interface CursoParams {
  cursoId: string;
}

interface ModuloParams {
  id: string;
}

interface ModuloBody {
  titulo?: unknown;
}

interface OrdemBody {
  ids?: unknown;
}

/** Mesmo requisito de papel de cursos.ts: painel do professor, não área do aluno. */
const PAPEIS_STAFF = ["admin_instituicao", "professor"] as const;

// Rotas de módulo. Diferente de cursos.ts, `modulos` não tem `instituicao_id` direto — o
// isolamento é feito inteiramente via `services/conteudoCurso.ts` (join até `cursos`), chamado
// ANTES de qualquer leitura/escrita em toda rota que recebe `cursoId`/`id` na URL.
export default async function modulosRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: CursoParams }>(
    "/api/cursos/:cursoId/modulos",
    { onRequest: [fastify.exigirPapel(...PAPEIS_STAFF)] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { cursoId } = request.params;

      const curso = await buscarCursoDaInstituicao(fastify, request.accessToken!, cursoId, usuario.instituicaoId);
      if (!curso) return reply.code(404).send({ erro: "Curso não encontrado" });

      // curso_id já foi verificado como pertencente à instituição da sessão acima — filtrar só
      // por ele aqui é seguro (mesmo raciocínio de cursos.ts: id de recurso já confirmado antes).
      const { data, error } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("modulos")
        .select(`${COLUNAS_MODULO}, aulas(${COLUNAS_AULA})`)
        .eq("curso_id", cursoId)
        .order("ordem", { ascending: true })
        .order("ordem", { ascending: true, foreignTable: "aulas" });

      if (error) {
        request.log.error(error);
        return reply.code(500).send({ erro: "Não foi possível listar os módulos" });
      }

      const linhas = data as unknown as Array<LinhaModulo & { aulas: LinhaAula[] }>;
      return linhas.map((linha) => paraApiModulo(linha, linha.aulas ?? []));
    },
  );

  fastify.post<{ Params: CursoParams; Body: ModuloBody }>(
    "/api/cursos/:cursoId/modulos",
    { onRequest: [fastify.exigirPapel(...PAPEIS_STAFF)] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { cursoId } = request.params;
      const corpo = request.body ?? {};

      if (!tituloValido(corpo.titulo)) {
        return reply.code(400).send({ erro: "Título é obrigatório" });
      }

      const curso = await buscarCursoDaInstituicao(fastify, request.accessToken!, cursoId, usuario.instituicaoId);
      if (!curso) return reply.code(404).send({ erro: "Curso não encontrado" });

      const cliente = fastify.supabaseComoUsuario(request.accessToken!);

      // Novo módulo entra no fim da lista — `ordem` é a posição, não um id, então a contagem
      // atual dos módulos deste curso já é o próximo índice livre.
      const { count, error: erroContagem } = await cliente
        .from("modulos")
        .select("id", { count: "exact", head: true })
        .eq("curso_id", cursoId);

      if (erroContagem) {
        request.log.error(erroContagem);
        return reply.code(500).send({ erro: "Não foi possível criar o módulo" });
      }

      const { data, error } = await cliente
        .from("modulos")
        .insert({ curso_id: cursoId, titulo: corpo.titulo.trim(), ordem: count ?? 0 })
        .select(COLUNAS_MODULO)
        .single();

      if (error || !data) {
        request.log.error(error);
        return reply.code(500).send({ erro: "Não foi possível criar o módulo" });
      }

      return reply.code(201).send(paraApiModulo(data as LinhaModulo, []));
    },
  );

  fastify.patch<{ Params: ModuloParams; Body: ModuloBody }>(
    "/api/modulos/:id",
    { onRequest: [fastify.exigirPapel(...PAPEIS_STAFF)] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { id } = request.params;
      const corpo = request.body ?? {};

      if (!tituloValido(corpo.titulo)) {
        return reply.code(400).send({ erro: "Título não pode ser vazio" });
      }

      // Verificação central desta fatia: confirma que o módulo pertence a um curso da
      // instituição da sessão ANTES do update — sem isso, um `.eq("id", id)` sozinho no update
      // deixaria um professor da instituição A renomear módulo de curso da instituição B.
      const modulo = await buscarModuloDaInstituicao(fastify, request.accessToken!, id, usuario.instituicaoId);
      if (!modulo) return reply.code(404).send({ erro: "Módulo não encontrado" });

      const { data, error } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("modulos")
        .update({ titulo: corpo.titulo.trim() })
        .eq("id", id)
        .select(COLUNAS_MODULO)
        .single();

      if (error || !data) {
        request.log.error(error);
        return reply.code(500).send({ erro: "Não foi possível renomear o módulo" });
      }

      const aulas = await buscarAulasDoModulo(fastify, request.accessToken!, id);
      return paraApiModulo(data as LinhaModulo, aulas);
    },
  );

  fastify.delete<{ Params: ModuloParams }>(
    "/api/modulos/:id",
    { onRequest: [fastify.exigirPapel(...PAPEIS_STAFF)] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { id } = request.params;

      // Mesma verificação central antes do delete — cascade do banco (0004) cuida de apagar as
      // aulas do módulo junto.
      const modulo = await buscarModuloDaInstituicao(fastify, request.accessToken!, id, usuario.instituicaoId);
      if (!modulo) return reply.code(404).send({ erro: "Módulo não encontrado" });

      const { error } = await fastify.supabaseComoUsuario(request.accessToken!).from("modulos").delete().eq("id", id);

      if (error) {
        request.log.error(error);
        return reply.code(500).send({ erro: "Não foi possível remover o módulo" });
      }

      return reply.code(204).send();
    },
  );

  fastify.put<{ Params: CursoParams; Body: OrdemBody }>(
    "/api/cursos/:cursoId/modulos/ordem",
    { onRequest: [fastify.exigirPapel(...PAPEIS_STAFF)] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { cursoId } = request.params;
      const ids = request.body?.ids;

      if (!Array.isArray(ids) || ids.length === 0 || !ids.every((valor) => typeof valor === "string")) {
        return reply.code(400).send({ erro: "Lista de ids inválida" });
      }

      const curso = await buscarCursoDaInstituicao(fastify, request.accessToken!, cursoId, usuario.instituicaoId);
      if (!curso) return reply.code(404).send({ erro: "Curso não encontrado" });

      const cliente = fastify.supabaseComoUsuario(request.accessToken!);

      const { data: existentes, error: erroExistentes } = await cliente
        .from("modulos")
        .select("id")
        .eq("curso_id", cursoId);

      if (erroExistentes) {
        request.log.error(erroExistentes);
        return reply.code(500).send({ erro: "Não foi possível reordenar os módulos" });
      }

      const idsExistentes = new Set(((existentes as { id: string }[] | null) ?? []).map((m) => m.id));

      // Todo id da lista precisa pertencer a ESTE curso — e a lista precisa cobrir exatamente os
      // módulos existentes (mesmo tamanho). Sem isso, um id de outro curso/instituição entraria
      // na reordenação e teria seu `ordem` sobrescrito sem checagem nenhuma de posse.
      const listaValida =
        ids.length === idsExistentes.size && ids.every((id) => idsExistentes.has(id as string));
      if (!listaValida) {
        return reply.code(400).send({ erro: "Lista de ids não corresponde aos módulos deste curso" });
      }

      const resultados = await Promise.all(
        (ids as string[]).map((id, indice) =>
          cliente.from("modulos").update({ ordem: indice }).eq("id", id).eq("curso_id", cursoId),
        ),
      );

      if (resultados.some((r) => r.error)) {
        request.log.error("Falha ao atualizar ordem dos módulos");
        return reply.code(500).send({ erro: "Não foi possível reordenar os módulos" });
      }

      return reply.code(204).send();
    },
  );
}
