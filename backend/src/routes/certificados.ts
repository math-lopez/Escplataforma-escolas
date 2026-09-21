import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";

// ── Certificados ──────────────────────────────────────────────────────
// Rotas de emissão e validação de certificados.

/**
 * Gera um código de validação legível: apenas letras maiúsculas e dígitos,
 * sem caracteres ambíguos (0, O, I, 1). Mínimo 12 caracteres.
 */
function gerarCodigoValidacao(): string {
  // Caracteres legíveis: sem 0/O, sem I/1, sem l
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const buffer = randomBytes(12);
  let codigo = "";
  for (const byte of buffer) {
    codigo += chars[byte % chars.length];
  }
  return codigo;
}

interface MatriculaComCurso {
  id: string;
  curso_id: string;
  status: string;
}

interface CursoComInstituicao {
  id: string;
  instituicao_id: string;
}

interface AulaDoModulo {
  id: string;
}

interface ProgressoAula {
  aula_id: string;
  concluida: boolean;
}

interface QuizTentativa {
  aprovado: boolean;
}

interface CertificadoExistente {
  id: string;
  matricula_id: string;
  codigo_validacao: string;
  emitido_em: string;
}

interface LinhaMatriculaComCurso {
  id: string;
  curso_id: string;
  status: string;
  cursos?: {
    id: string;
    titulo: string;
  };
}

interface LinhaCertificadoAluno {
  id: string;
  codigo_validacao: string;
  emitido_em: string;
  matriculas?: {
    cursos?: {
      id: string;
      titulo: string;
    };
  };
}

interface LinhaCertificadoPublico {
  id: string;
  matricula_id: string;
  codigo_validacao: string;
  emitido_em: string;
  matriculas?: {
    alunos?: {
      nome: string;
    };
    cursos?: {
      titulo: string;
      instituicao_id: string;
      instituicoes?: {
        nome: string;
      };
    };
  };
}

interface LinhaInstituicao {
  nome: string;
}

export default async function certificadosRoutes(fastify: FastifyInstance) {
  // POST /api/aluno/cursos/:cursoId/certificado — emite ou devolve certificado já emitido
  fastify.post<{ Params: { cursoId: string } }>(
    "/api/aluno/cursos/:cursoId/certificado",
    { onRequest: [fastify.exigirPapel("aluno")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { cursoId } = request.params;

      // R1: Busca matrícula ativa do aluno neste curso
      const { data: matriculaData, error: erroMatricula } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("matriculas")
        .select("id, curso_id, status")
        .eq("aluno_id", usuario.id)
        .eq("curso_id", cursoId)
        .eq("status", "ativa")
        .single();

      if (erroMatricula || !matriculaData) {
        return reply.code(404).send({ erro: "Curso não encontrado" });
      }

      const matriculaId = (matriculaData as unknown as MatriculaComCurso).id;

      // R1: Verifica que o curso pertence à instituição do aluno
      const { data: cursoData, error: erroCurso } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("cursos")
        .select("id, instituicao_id, titulo")
        .eq("id", cursoId)
        .eq("instituicao_id", usuario.instituicaoId)
        .single();

      if (erroCurso || !cursoData) {
        return reply.code(404).send({ erro: "Curso não encontrado" });
      }

      const cursoComTitulo = cursoData as unknown as CursoComInstituicao & { titulo: string };

      // R3: Verifica se já existe certificado para esta matrícula (idempotência)
      const { data: certificadoExistente, error: erroCertificadoExistente } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("certificados")
        .select("id, codigo_validacao, emitido_em")
        .eq("matricula_id", matriculaId)
        .single();

      if (erroCertificadoExistente && erroCertificadoExistente.code !== "PGRST116") {
        // PGRST116 = no rows (normal)
        request.log.error(erroCertificadoExistente);
        return reply.code(500).send({ erro: "Não foi possível emitir o certificado" });
      }

      if (certificadoExistente) {
        // Já existe: devolve o existente (R3) com o título do curso preenchido
        const cert = certificadoExistente as unknown as CertificadoExistente;
        return reply.code(200).send({
          id: cert.id,
          codigoValidacao: cert.codigo_validacao,
          emitidoEm: cert.emitido_em,
          curso: {
            id: cursoId,
            titulo: cursoComTitulo.titulo,
          },
        });
      }

      // R1: Verifica se o curso está REALMENTE concluído
      // Pega todos os módulos do curso
      const { data: modulosData, error: erroModulos } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("modulos")
        .select("id")
        .eq("curso_id", cursoId);

      if (erroModulos) {
        request.log.error(erroModulos);
        return reply.code(500).send({ erro: "Não foi possível verificar o progresso" });
      }

      const modulos = (modulosData as unknown as { id: string }[]) || [];
      const moduloIds = modulos.map((m) => m.id);

      // Se não tem módulos, o curso está "concluído" (vazio)
      let aulasConcluidas = 0;
      let totalAulas = 0;

      if (moduloIds.length > 0) {
        // Pega todas as aulas dos módulos
        const { data: aulasData, error: erroAulas } = await fastify
          .supabaseComoUsuario(request.accessToken!)
          .from("aulas")
          .select("id")
          .in("modulo_id", moduloIds);

        if (erroAulas) {
          request.log.error(erroAulas);
          return reply.code(500).send({ erro: "Não foi possível verificar o progresso" });
        }

        const aulas = (aulasData as unknown as AulaDoModulo[]) || [];
        totalAulas = aulas.length;

        if (totalAulas > 0) {
          const aulaIds = aulas.map((a) => a.id);

          // Pega progresso do aluno
          const { data: progressoData, error: erroProgresso } = await fastify
            .supabaseComoUsuario(request.accessToken!)
            .from("progresso_aulas")
            .select("aula_id, concluida")
            .eq("matricula_id", matriculaId)
            .in("aula_id", aulaIds);

          if (erroProgresso) {
            request.log.error(erroProgresso);
            return reply.code(500).send({ erro: "Não foi possível verificar o progresso" });
          }

          const progresso = (progressoData as unknown as ProgressoAula[]) || [];
          aulasConcluidas = progresso.filter((p) => p.concluida).length;
        }
      }

      // R1: Verifica se há quiz no curso
      const { data: quizData, error: erroQuiz } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("quizzes")
        .select("id")
        .eq("curso_id", cursoId)
        .single();

      // Verifica se existe tentativa aprovada (se há quiz)
      let quizAprovado = true; // assume true se não há quiz
      if (quizData) {
        const quizId = (quizData as unknown as { id: string }).id;

        const { data: tentativaData, error: erroTentativa } = await fastify
          .supabaseComoUsuario(request.accessToken!)
          .from("quiz_tentativas")
          .select("aprovado")
          .eq("aluno_id", usuario.id)
          .eq("quiz_id", quizId)
          .eq("aprovado", true)
          .single();

        if (erroTentativa && erroTentativa.code !== "PGRST116") {
          request.log.error(erroTentativa);
          return reply.code(500).send({ erro: "Não foi possível verificar o quiz" });
        }

        quizAprovado = !!tentativaData;
      }

      // R1: Verifica se está REALMENTE concluído
      if (aulasConcluidas < totalAulas || !quizAprovado) {
        return reply.code(409).send({
          erro: "Curso não foi concluído. Complete todas as aulas e o quiz.",
          aulasConcluidas,
          totalAulas,
          quizAprovado,
        });
      }

      // R2: Gera código de validação
      const codigoValidacao = gerarCodigoValidacao();

      // Emite o certificado
      const agora = new Date().toISOString();
      const { data: novoCertificado, error: erroInsert } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("certificados")
        .insert({
          matricula_id: matriculaId,
          codigo_validacao: codigoValidacao,
          emitido_em: agora,
        })
        .select("id, codigo_validacao, emitido_em")
        .single();

      if (erroInsert || !novoCertificado) {
        request.log.error(erroInsert);
        return reply.code(500).send({ erro: "Não foi possível emitir o certificado" });
      }

      const cert = novoCertificado as unknown as CertificadoExistente;
      return reply.code(201).send({
        id: cert.id,
        codigoValidacao: cert.codigo_validacao,
        emitidoEm: cert.emitido_em,
        curso: {
          id: cursoId,
          titulo: cursoComTitulo.titulo,
        },
      });
    }
  );

  // GET /api/aluno/certificados — lista certificados do aluno
  fastify.get(
    "/api/aluno/certificados",
    { onRequest: [fastify.exigirPapel("aluno")] },
    async (request, reply) => {
      const usuario = request.usuario!;

      // Busca todas as matriculas ativas do aluno com seus certificados
      const { data: matriculasData, error: erroMatriculas } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("matriculas")
        .select(
          `
          id,
          cursos!inner(id, titulo, instituicao_id),
          certificados(id, codigo_validacao, emitido_em)
        `
        )
        .eq("aluno_id", usuario.id)
        .eq("cursos.instituicao_id", usuario.instituicaoId);

      if (erroMatriculas) {
        request.log.error(erroMatriculas);
        return reply.code(500).send({ erro: "Não foi possível listar seus certificados" });
      }

      const matriculas = (matriculasData as unknown as any[]) || [];

      // Extrai apenas os certificados (flattena estrutura)
      const certificados = matriculas
        .flatMap((mat: any) => {
          const curso = mat.cursos;
          const certs = mat.certificados || [];
          return certs.map((cert: any) => ({
            id: cert.id,
            codigoValidacao: cert.codigo_validacao,
            emitidoEm: cert.emitido_em,
            curso: {
              id: curso.id,
              titulo: curso.titulo,
            },
          }));
        });

      return reply.code(200).send(certificados);
    }
  );

  // GET /api/publico/certificados/:codigo — validação pública de certificado
  fastify.get<{ Params: { codigo: string } }>(
    "/api/publico/certificados/:codigo",
    async (request, reply) => {
      const { codigo } = request.params;

      // R4: Usa supabaseAdmin pois é rota pública (sem sessão)
      // R5: Retorna apenas nome do aluno, nome do curso, instituição e data de emissão
      const { data: certificadoData, error: erroCertificado } = await fastify.supabaseAdmin
        .from("certificados")
        .select(
          `
          id,
          emitido_em,
          matriculas!inner(
            alunos!inner(nome),
            cursos!inner(titulo, instituicao_id, instituicoes!inner(nome))
          )
        `
        )
        .eq("codigo_validacao", codigo)
        .single();

      if (erroCertificado || !certificadoData) {
        // Código inválido ou inexistente: retorna 404 genérico
        return reply.code(404).send({ erro: "Certificado não encontrado" });
      }

      const cert = certificadoData as unknown as LinhaCertificadoPublico;
      const matricula = cert.matriculas;

      if (!matricula || !matricula.alunos || !matricula.cursos || !matricula.cursos.instituicoes) {
        return reply.code(404).send({ erro: "Certificado não encontrado" });
      }

      // R5: Apenas informações mínimas
      return reply.code(200).send({
        aluno: {
          nome: matricula.alunos.nome,
        },
        curso: {
          titulo: matricula.cursos.titulo,
        },
        instituicao: {
          nome: matricula.cursos.instituicoes.nome,
        },
        emitidoEm: cert.emitido_em,
      });
    }
  );
}
