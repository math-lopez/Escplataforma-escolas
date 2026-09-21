import type { FastifyInstance } from "fastify";
import {
  COLUNAS_AULA,
  buscarAulaDaInstituicao,
  paraApiAula,
  type LinhaAula,
} from "../services/conteudoCurso.js";
import { urlDeReproducaoVideo } from "../services/video.js";

// ── Rotas do ALUNO (área privada) ─────────────────────────────────────
// Acesso: papel "aluno" apenas. Sem necessidade de service role.

export default async function alunoRoutes(fastify: FastifyInstance) {
  // GET /api/aluno/cursos — lista cursos em que o aluno está matriculado, com progresso
  fastify.get(
    "/api/aluno/cursos",
    { onRequest: [fastify.exigirPapel("aluno")] },
    async (request, reply) => {
      const usuario = request.usuario!;

      // R1 + R2: só cursos em que o aluno está MATRICULADO, de sua INSTITUIÇÃO
      const { data, error } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("matriculas")
        .select(
          `
          id,
          curso_id,
          status,
          cursos!inner(id, titulo, descricao, capa_url, instituicao_id),
          progresso_aulas(aula_id)
        `
        )
        .eq("aluno_id", usuario.id)
        .eq("cursos.instituicao_id", usuario.instituicaoId)
        .eq("status", "ativa");

      if (error) {
        request.log.error(error);
        return reply.code(500).send({ erro: "Não foi possível listar seus cursos" });
      }

      if (!data) {
        return reply.code(200).send([]);
      }

      const matriculas = data as unknown[];

      // Coleta IDs de cursos para uma consulta única a módulos e aulas
      const cursoIds = matriculas.map((m: any) => m.curso_id);
      if (cursoIds.length === 0) {
        return reply.code(200).send([]);
      }

      // Consulta todos os módulos dos cursos de uma vez
      const { data: todosModulos, error: erroModulos } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("modulos")
        .select("id, curso_id")
        .in("curso_id", cursoIds);

      if (erroModulos) {
        request.log.error(erroModulos);
        return reply.code(500).send({ erro: "Não foi possível listar seus cursos" });
      }

      // Mapeia módulos por curso para contagem
      const modulosPorCurso = new Map<string, string[]>();
      const moduloIds: string[] = [];
      if (todosModulos) {
        ((todosModulos as unknown) as { id: string; curso_id: string }[]).forEach((mod) => {
          moduloIds.push(mod.id);
          if (!modulosPorCurso.has(mod.curso_id)) {
            modulosPorCurso.set(mod.curso_id, []);
          }
          modulosPorCurso.get(mod.curso_id)!.push(mod.id);
        });
      }

      // Se há módulos, busca todas as aulas de uma vez
      let aulasPorModulo = new Map<string, number>();
      if (moduloIds.length > 0) {
        const { data: todasAulas, error: erroAulas } = await fastify
          .supabaseComoUsuario(request.accessToken!)
          .from("aulas")
          .select("id, modulo_id")
          .in("modulo_id", moduloIds);

        if (erroAulas) {
          request.log.error(erroAulas);
          return reply.code(500).send({ erro: "Não foi possível listar seus cursos" });
        }

        // Conta aulas por módulo
        if (todasAulas) {
          ((todasAulas as unknown) as { id: string; modulo_id: string }[]).forEach((aula) => {
            aulasPorModulo.set(aula.modulo_id, (aulasPorModulo.get(aula.modulo_id) ?? 0) + 1);
          });
        }
      }

      // Mapeia contagem de aulas por curso
      const totalAulasPorCurso = new Map<string, number>();
      cursoIds.forEach((cursoId) => {
        let total = 0;
        const mods = modulosPorCurso.get(cursoId) || [];
        mods.forEach((modId) => {
          total += aulasPorModulo.get(modId) ?? 0;
        });
        totalAulasPorCurso.set(cursoId, total);
      });

      // Monta resposta com totais calculados em memória
      const cursosComProgresso = matriculas.map((matricula: any) => {
        const cursoInfo = matricula.cursos;
        return {
          id: cursoInfo.id,
          titulo: cursoInfo.titulo,
          descricao: cursoInfo.descricao,
          capaUrl: cursoInfo.capa_url,
          matriculaId: matricula.id,
          status: matricula.status,
          totalAulas: totalAulasPorCurso.get(matricula.curso_id) ?? 0,
          aulasConcluidas: matricula.progresso_aulas?.length ?? 0,
        };
      });

      return cursosComProgresso;
    }
  );

  // GET /api/aluno/cursos/:cursoId — detalhe do curso com módulos e aulas
  fastify.get<{ Params: { cursoId: string } }>(
    "/api/aluno/cursos/:cursoId",
    { onRequest: [fastify.exigirPapel("aluno")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { cursoId } = request.params;

      // R1: busca matrícula do aluno ATIVA neste curso
      const { data: matriculaData, error: erroMatricula } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("matriculas")
        .select("id, curso_id, status")
        .eq("aluno_id", usuario.id)
        .eq("curso_id", cursoId)
        .eq("status", "ativa")
        .single();

      // Se não há matrícula ativa, simula "curso não encontrado" (não distinguir)
      if (erroMatricula || !matriculaData) {
        return reply.code(404).send({ erro: "Curso não encontrado" });
      }

      // R2: garante que o curso pertence à instituição do aluno via join
      const { data: cursoData, error: erroCurso } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("cursos")
        .select("id, titulo, descricao, instituicao_id")
        .eq("id", cursoId)
        .eq("instituicao_id", usuario.instituicaoId)
        .single();

      if (erroCurso || !cursoData) {
        return reply.code(404).send({ erro: "Curso não encontrado" });
      }

      // Busca módulos do curso, ordenados
      const { data: modulosData, error: erroModulos } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("modulos")
        .select("id, titulo, ordem")
        .eq("curso_id", cursoId)
        .order("ordem", { ascending: true });

      if (erroModulos) {
        request.log.error(erroModulos);
        return reply.code(500).send({ erro: "Não foi possível carregar o curso" });
      }

      const modulos_array = (modulosData as unknown as { id: string; titulo: string; ordem: number }[]) || [];

      // Se não há módulos, retorna curso vazio
      if (modulos_array.length === 0) {
        return {
          id: cursoData.id,
          titulo: cursoData.titulo,
          descricao: cursoData.descricao,
          matriculaId: matriculaData.id,
          modulos: [],
        };
      }

      const moduloIds = modulos_array.map((m) => m.id);

      // Busca TODAS as aulas dos módulos deste curso DE UMA VEZ, mantendo a ordem
      const { data: aulasData, error: erroAulas } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("aulas")
        .select(COLUNAS_AULA)
        .in("modulo_id", moduloIds)
        .order("modulo_id", { ascending: true })
        .order("ordem", { ascending: true });

      if (erroAulas) {
        request.log.error(erroAulas);
        return reply.code(500).send({ erro: "Não foi possível carregar o curso" });
      }

      // Busca progresso DO ALUNO DE UMA VEZ (fora do laço)
      const { data: progressoData, error: erroProgresso } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("progresso_aulas")
        .select("aula_id, concluida")
        .eq("matricula_id", matriculaData.id);

      if (erroProgresso) {
        request.log.error(erroProgresso);
      }

      const concluidas = new Set(
        ((progressoData as unknown as { aula_id: string; concluida: boolean }[]) || [])
          .filter((p) => p.concluida)
          .map((p) => p.aula_id)
      );

      // Agrupa aulas por módulo em memória
      const aulasPorModulo = new Map<string, LinhaAula[]>();
      ((aulasData as unknown as LinhaAula[]) || []).forEach((aula) => {
        if (!aulasPorModulo.has(aula.modulo_id)) {
          aulasPorModulo.set(aula.modulo_id, []);
        }
        aulasPorModulo.get(aula.modulo_id)!.push(aula);
      });

      // Monta resposta com aulas já agrupadas, sem laço async
      const modulos = modulos_array.map((modulo) => {
        const aulas_do_modulo = aulasPorModulo.get(modulo.id) || [];

        // `videoEmbedUrl` só é montada aqui (área do aluno), não em paraApiAula: o professor
        // não reproduz vídeo no editor, e o helper depende de configuração de servidor (BUNNY_LIBRARY_ID
        // para Bunny, etc.). É null quando o provedor não está configurado ou a aula
        // ainda não tem vídeo — o frontend trata isso como "vídeo indisponível".
        const aulas = aulas_do_modulo.map((aula) => ({
          ...paraApiAula(aula),
          videoEmbedUrl: urlDeReproducaoVideo(aula.video_fonte, aula.video_externo_id),
          concluida: concluidas.has(aula.id),
        }));

        return {
          id: modulo.id,
          titulo: modulo.titulo,
          ordem: modulo.ordem,
          aulas,
        };
      });

      return {
        id: cursoData.id,
        titulo: cursoData.titulo,
        descricao: cursoData.descricao,
        matriculaId: matriculaData.id,
        modulos,
      };
    }
  );

  // POST /api/aluno/aulas/:aulaId/concluir — marca aula como concluída
  fastify.post<{ Params: { aulaId: string } }>(
    "/api/aluno/aulas/:aulaId/concluir",
    { onRequest: [fastify.exigirPapel("aluno")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { aulaId } = request.params;

      // R1: busca a aula e valida que pertence a um curso matriculado pelo aluno
      const aula = await buscarAulaDaInstituicao(fastify, request.accessToken!, aulaId, usuario.instituicaoId);
      if (!aula) {
        return reply.code(404).send({ erro: "Aula não encontrada" });
      }

      // R3: encontra a matrícula DO ALUNO neste curso (via módulo -> curso)
      const { data: moduloData, error: erroModulo } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("modulos")
        .select("curso_id")
        .eq("id", aula.modulo_id)
        .single();

      if (erroModulo || !moduloData) {
        return reply.code(404).send({ erro: "Aula não encontrada" });
      }

      const { data: matriculaData, error: erroMatricula } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("matriculas")
        .select("id")
        .eq("aluno_id", usuario.id)
        .eq("curso_id", (moduloData as unknown as { curso_id: string }).curso_id)
        .eq("status", "ativa")
        .single();

      if (erroMatricula || !matriculaData) {
        return reply.code(404).send({ erro: "Aula não encontrada" });
      }

      const matriculaId = (matriculaData as unknown as { id: string }).id;

      // Upsert: marca aula como concluída para ESTA matrícula
      const agora = new Date().toISOString();
      const { data: progresso, error: erroProgresso } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("progresso_aulas")
        .upsert(
          {
            matricula_id: matriculaId,
            aula_id: aulaId,
            concluida: true,
            concluida_em: agora,
          },
          { onConflict: "matricula_id,aula_id" }
        )
        .select("aula_id, concluida, concluida_em")
        .single();

      if (erroProgresso || !progresso) {
        request.log.error(erroProgresso);
        return reply.code(500).send({ erro: "Não foi possível marcar a aula como concluída" });
      }

      const resultado = progresso as unknown as { aula_id: string; concluida: boolean; concluida_em: string };
      return reply.code(200).send({
        aulaId: resultado.aula_id,
        concluida: resultado.concluida,
        concluidaEm: resultado.concluida_em,
      });
    }
  );

  // DELETE /api/aluno/aulas/:aulaId/concluir — desmarca aula
  fastify.delete<{ Params: { aulaId: string } }>(
    "/api/aluno/aulas/:aulaId/concluir",
    { onRequest: [fastify.exigirPapel("aluno")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { aulaId } = request.params;

      // R1: valida que a aula pertence a um curso matriculado pelo aluno
      const aula = await buscarAulaDaInstituicao(fastify, request.accessToken!, aulaId, usuario.instituicaoId);
      if (!aula) {
        return reply.code(404).send({ erro: "Aula não encontrada" });
      }

      // R3: encontra a matrícula DO ALUNO neste curso
      const { data: moduloData, error: erroModulo } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("modulos")
        .select("curso_id")
        .eq("id", aula.modulo_id)
        .single();

      if (erroModulo || !moduloData) {
        return reply.code(404).send({ erro: "Aula não encontrado" });
      }

      const { data: matriculaData, error: erroMatricula } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("matriculas")
        .select("id")
        .eq("aluno_id", usuario.id)
        .eq("curso_id", (moduloData as unknown as { curso_id: string }).curso_id)
        .eq("status", "ativa")
        .single();

      if (erroMatricula || !matriculaData) {
        return reply.code(404).send({ erro: "Aula não encontrada" });
      }

      const matriculaId = (matriculaData as unknown as { id: string }).id;

      // Delete: remove o progresso desta aula para ESTA matrícula
      const { error: erroDelete } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("progresso_aulas")
        .delete()
        .eq("matricula_id", matriculaId)
        .eq("aula_id", aulaId);

      if (erroDelete) {
        request.log.error(erroDelete);
        return reply.code(500).send({ erro: "Não foi possível desmarcar a aula" });
      }

      return reply.code(204).send();
    }
  );

  // GET /api/aluno/aulas/:aulaId/material — gera URL assinada de leitura para PDF da aula
  fastify.get<{ Params: { aulaId: string } }>(
    "/api/aluno/aulas/:aulaId/material",
    { onRequest: [fastify.exigirPapel("aluno")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { aulaId } = request.params;

      // R1: busca a aula e valida que pertence a um curso matriculado pelo aluno
      const aula = await buscarAulaDaInstituicao(fastify, request.accessToken!, aulaId, usuario.instituicaoId);
      if (!aula) {
        return reply.code(404).send({ erro: "Aula não encontrada" });
      }

      // R2: verifica se é aula do tipo pdf e tem conteudo_url
      if (aula.tipo !== "pdf") {
        return reply.code(404).send({ erro: "Esta aula não possui material disponível" });
      }

      if (!aula.conteudo_url) {
        return reply.code(404).send({ erro: "Esta aula não possui material disponível" });
      }

      // R3: encontra a matrícula DO ALUNO neste curso (mesma lógica de concluir)
      const { data: moduloData, error: erroModulo } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("modulos")
        .select("curso_id")
        .eq("id", aula.modulo_id)
        .single();

      if (erroModulo || !moduloData) {
        return reply.code(404).send({ erro: "Aula não encontrada" });
      }

      const { data: matriculaData, error: erroMatricula } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("matriculas")
        .select("id")
        .eq("aluno_id", usuario.id)
        .eq("curso_id", (moduloData as unknown as { curso_id: string }).curso_id)
        .eq("status", "ativa")
        .single();

      if (erroMatricula || !matriculaData) {
        return reply.code(404).send({ erro: "Aula não encontrada" });
      }

      // R4: gera signed URL para leitura — 300 segundos (5 minutos) de expiração
      // Usa sempre o caminho vindo do banco (aula.conteudo_url), nunca qualquer valor da requisição
      const cliente = fastify.supabaseComoUsuario(request.accessToken!);
      const { data, error } = await cliente
        .storage
        .from("materiais")
        .createSignedUrl(aula.conteudo_url, 300);

      if (error || !data) {
        request.log.error(error);
        return reply.code(500).send({ erro: "Não foi possível gerar o link de download" });
      }

      // Calcula expiraEm: agora + 300 segundos
      const agora = new Date();
      const expiraEm = new Date(agora.getTime() + 300 * 1000).toISOString();

      return reply.code(200).send({
        url: data.signedUrl,
        expiraEm,
      });
    }
  );
}
