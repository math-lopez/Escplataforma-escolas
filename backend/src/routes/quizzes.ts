import type { FastifyInstance } from "fastify";
import { buscarCursoDaInstituicao } from "../services/conteudoCurso.js";

// ── Tipos ──────────────────────────────────────────────────────────────────

interface CursoParams {
  cursoId: string;
}

interface QuizBody {
  titulo?: unknown;
  notaMinimaAprovacao?: unknown;
  perguntas?: unknown;
}

interface RespostasBody {
  respostas?: unknown;
  // nota e aprovado são ignorados deliberadamente — calculados no servidor
}

interface AlternativaInput {
  texto?: unknown;
  correta?: unknown;
}

interface PerguntaInput {
  enunciado?: unknown;
  ordem?: unknown;
  alternativas?: unknown;
}

// Seleção explícita de colunas — nunca select(*)
const COLUNAS_QUIZ = "id, curso_id, titulo, nota_minima_aprovacao";
const COLUNAS_PERGUNTA = "id, quiz_id, enunciado, ordem";
const COLUNAS_ALTERNATIVA_STAFF = "id, pergunta_id, texto, correta";
const COLUNAS_ALTERNATIVA_ALUNO = "id, pergunta_id, texto"; // sem "correta"
const COLUNAS_TENTATIVA = "id, quiz_id, aluno_id, nota, aprovado, respostas, finalizada_em";

interface LinhaQuiz {
  id: string;
  curso_id: string;
  titulo: string;
  nota_minima_aprovacao: number;
}

interface LinhaPergunta {
  id: string;
  quiz_id: string;
  enunciado: string;
  ordem: number;
}

interface LinhaAlternativa {
  id: string;
  pergunta_id: string;
  texto: string;
  correta?: boolean;
}

interface LinhaTentativa {
  id: string;
  quiz_id: string;
  aluno_id: string;
  nota: number | null;
  aprovado: boolean | null;
  respostas: Record<string, unknown> | null;
  finalizada_em: string | null;
}

const PAPEIS_STAFF = ["admin_instituicao", "professor"] as const;

// ── Validadores ─────────────────────────────────────────────────────────

function tituloValido(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim().length > 0;
}

function notaMinimaValida(valor: unknown): valor is number {
  return (
    typeof valor === "number" &&
    Number.isFinite(valor) &&
    valor >= 0 &&
    valor <= 100
  );
}

function enunciadoValido(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim().length > 0;
}

function textoAlternativaValido(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim().length > 0;
}

// ── Conversão de resposta para API (camelCase) ──────────────────────────

function paraApiQuiz(linha: LinhaQuiz) {
  return {
    id: linha.id,
    cursoId: linha.curso_id,
    titulo: linha.titulo,
    notaMinimaAprovacao: linha.nota_minima_aprovacao,
  };
}

function paraApiPergunta(linha: LinhaPergunta) {
  return {
    id: linha.id,
    quizId: linha.quiz_id,
    enunciado: linha.enunciado,
    ordem: linha.ordem,
  };
}

function paraApiAlternativa(linha: LinhaAlternativa, incluirCorreta: boolean = false) {
  const resultado: Record<string, unknown> = {
    id: linha.id,
    perguntaId: linha.pergunta_id,
    texto: linha.texto,
  };
  if (incluirCorreta && linha.correta !== undefined) {
    resultado.correta = linha.correta;
  }
  return resultado;
}

function paraApiTentativa(linha: LinhaTentativa) {
  return {
    id: linha.id,
    quizId: linha.quiz_id,
    alunoId: linha.aluno_id,
    nota: linha.nota,
    aprovado: linha.aprovado,
    respostas: linha.respostas,
    finalizadaEm: linha.finalizada_em,
  };
}

// ── Rotas ──────────────────────────────────────────────────────────────────

export default async function quizzesRoutes(fastify: FastifyInstance) {
  // ── Rotas de STAFF (admin_instituicao, professor) ─────────────────────

  // GET /api/cursos/:cursoId/quiz — retorna o quiz com perguntas e alternativas (COM correta)
  fastify.get<{ Params: CursoParams }>(
    "/api/cursos/:cursoId/quiz",
    { onRequest: [fastify.exigirPapel(...PAPEIS_STAFF)] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { cursoId } = request.params;

      // Verifica que o curso pertence à instituição do usuário
      const curso = await buscarCursoDaInstituicao(fastify, request.accessToken!, cursoId, usuario.instituicaoId);
      if (!curso) return reply.code(404).send({ erro: "Curso não encontrado" });

      const cliente = fastify.supabaseComoUsuario(request.accessToken!);

      // Busca o quiz do curso
      const { data: quizData, error: erroQuiz } = await cliente
        .from("quizzes")
        .select(COLUNAS_QUIZ)
        .eq("curso_id", cursoId)
        .single();

      // Nenhum quiz ainda é ok — retorna null ou 404 de acordo com a política de produto
      // Por enquanto, se não houver quiz retorna 404
      if (erroQuiz || !quizData) {
        return reply.code(404).send({ erro: "Quiz não encontrado neste curso" });
      }

      const quiz = quizData as unknown as LinhaQuiz;

      // Busca as perguntas do quiz, ordenadas
      const { data: perguntasData, error: erroPergunta } = await cliente
        .from("quiz_perguntas")
        .select(COLUNAS_PERGUNTA)
        .eq("quiz_id", quiz.id)
        .order("ordem", { ascending: true });

      if (erroPergunta) {
        request.log.error(erroPergunta);
        return reply.code(500).send({ erro: "Não foi possível carregar o quiz" });
      }

      const perguntas = (perguntasData as unknown as LinhaPergunta[]) || [];

      // Para cada pergunta, busca as alternativas
      const perguntasComAlternativas = await Promise.all(
        perguntas.map(async (pergunta) => {
          const { data: alternativasData, error: erroAlternativa } = await cliente
            .from("quiz_alternativas")
            .select(COLUNAS_ALTERNATIVA_STAFF) // Staff VÊ a coluna correta
            .eq("pergunta_id", pergunta.id)
            .order("id", { ascending: true });

          if (erroAlternativa) {
            request.log.error(erroAlternativa);
            throw new Error("Não foi possível carregar as alternativas");
          }

          const alternativas = (alternativasData as unknown as LinhaAlternativa[]) || [];

          return {
            ...paraApiPergunta(pergunta),
            alternativas: alternativas.map((alt) => paraApiAlternativa(alt, true)),
          };
        }),
      );

      return {
        ...paraApiQuiz(quiz),
        perguntas: perguntasComAlternativas,
      };
    },
  );

  // PUT /api/cursos/:cursoId/quiz — cria ou substitui o quiz inteiro
  fastify.put<{ Params: CursoParams; Body: QuizBody }>(
    "/api/cursos/:cursoId/quiz",
    { onRequest: [fastify.exigirPapel(...PAPEIS_STAFF)] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { cursoId } = request.params;
      const corpo = request.body ?? {};

      // Validação de entrada
      if (!tituloValido(corpo.titulo)) {
        return reply.code(400).send({ erro: "Título é obrigatório" });
      }

      if (!notaMinimaValida(corpo.notaMinimaAprovacao)) {
        return reply.code(400).send({ erro: "notaMinimaAprovacao deve ser um número entre 0 e 100" });
      }

      if (!Array.isArray(corpo.perguntas) || corpo.perguntas.length === 0) {
        return reply.code(400).send({ erro: "O quiz deve ter pelo menos uma pergunta" });
      }

      // Valida cada pergunta
      let erroValidacao = "";
      corpo.perguntas.forEach((pergunta: unknown, idx: number) => {
        if (!erroValidacao && typeof pergunta !== "object" || pergunta === null) {
          erroValidacao = `Pergunta ${idx} é inválida`;
          return;
        }

        const p = pergunta as Record<string, unknown>;

        if (!enunciadoValido(p.enunciado)) {
          erroValidacao = `Pergunta ${idx} não tem enunciado válido`;
          return;
        }

        if (!Array.isArray(p.alternativas) || p.alternativas.length < 2) {
          erroValidacao = `Pergunta ${idx} deve ter pelo menos 2 alternativas`;
          return;
        }

        // Conta quantas alternativas estão marcadas como correta
        let totalCorretas = 0;
        p.alternativas.forEach((alt: unknown, altIdx: number) => {
          if (typeof alt !== "object" || alt === null) {
            erroValidacao = `Alternativa ${altIdx} da pergunta ${idx} é inválida`;
            return;
          }

          const a = alt as Record<string, unknown>;

          if (!textoAlternativaValido(a.texto)) {
            erroValidacao = `Alternativa ${altIdx} da pergunta ${idx} não tem texto válido`;
            return;
          }

          if (a.correta === true) {
            totalCorretas++;
          }
        });

        if (totalCorretas === 0) {
          erroValidacao = `Pergunta ${idx} não tem nenhuma alternativa marcada como correta`;
        } else if (totalCorretas > 1) {
          erroValidacao = `Pergunta ${idx} tem mais de uma alternativa marcada como correta`;
        }
      });

      if (erroValidacao) {
        return reply.code(400).send({ erro: erroValidacao });
      }

      // Verifica que o curso pertence à instituição do usuário
      const curso = await buscarCursoDaInstituicao(fastify, request.accessToken!, cursoId, usuario.instituicaoId);
      if (!curso) return reply.code(404).send({ erro: "Curso não encontrado" });

      const cliente = fastify.supabaseComoUsuario(request.accessToken!);

      // Busca quiz existente para deletar (cascade faz o resto)
      const { data: quizExistente } = await cliente
        .from("quizzes")
        .select("id")
        .eq("curso_id", cursoId)
        .single();

      // Se existe um quiz anterior, deleta (cascade deleta perguntas e alternativas)
      if (quizExistente) {
        const { error: erroDelete } = await cliente.from("quizzes").delete().eq("id", (quizExistente as any).id);

        if (erroDelete) {
          request.log.error(erroDelete);
          return reply.code(500).send({ erro: "Não foi possível atualizar o quiz" });
        }
      }

      // Cria novo quiz
      const { data: novoQuizData, error: erroNovoQuiz } = await cliente
        .from("quizzes")
        .insert({
          curso_id: cursoId,
          titulo: (corpo.titulo as string).trim(),
          nota_minima_aprovacao: corpo.notaMinimaAprovacao,
        })
        .select(COLUNAS_QUIZ)
        .single();

      if (erroNovoQuiz || !novoQuizData) {
        request.log.error(erroNovoQuiz);
        return reply.code(500).send({ erro: "Não foi possível criar o quiz" });
      }

      const novoQuiz = novoQuizData as unknown as LinhaQuiz;

      // Insere perguntas e alternativas
      const perguntasComAlternativas = await Promise.all(
        (corpo.perguntas as PerguntaInput[]).map(async (pergunta, idx) => {
          const { data: perguntaData, error: erroPergunta } = await cliente
            .from("quiz_perguntas")
            .insert({
              quiz_id: novoQuiz.id,
              enunciado: (pergunta.enunciado as string).trim(),
              ordem: typeof pergunta.ordem === "number" ? pergunta.ordem : idx,
            })
            .select(COLUNAS_PERGUNTA)
            .single();

          if (erroPergunta || !perguntaData) {
            request.log.error(erroPergunta);
            throw new Error("Não foi possível criar a pergunta");
          }

          const novaPerguntas = perguntaData as unknown as LinhaPergunta;

          // Insere alternativas para esta pergunta
          const { data: alternativasData, error: erroAlternativa } = await cliente
            .from("quiz_alternativas")
            .insert(
              (pergunta.alternativas as AlternativaInput[]).map((alt) => ({
                pergunta_id: novaPerguntas.id,
                texto: (alt.texto as string).trim(),
                correta: alt.correta === true,
              })),
            )
            .select(COLUNAS_ALTERNATIVA_STAFF);

          if (erroAlternativa) {
            request.log.error(erroAlternativa);
            throw new Error("Não foi possível criar as alternativas");
          }

          const alternativas = (alternativasData as unknown as LinhaAlternativa[]) || [];

          return {
            ...paraApiPergunta(novaPerguntas),
            alternativas: alternativas.map((alt) => paraApiAlternativa(alt, true)),
          };
        }),
      );

      return reply.code(201).send({
        ...paraApiQuiz(novoQuiz),
        perguntas: perguntasComAlternativas,
      });
    },
  );

  // DELETE /api/cursos/:cursoId/quiz
  fastify.delete<{ Params: CursoParams }>(
    "/api/cursos/:cursoId/quiz",
    { onRequest: [fastify.exigirPapel(...PAPEIS_STAFF)] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { cursoId } = request.params;

      // Verifica que o curso pertence à instituição do usuário
      const curso = await buscarCursoDaInstituicao(fastify, request.accessToken!, cursoId, usuario.instituicaoId);
      if (!curso) return reply.code(404).send({ erro: "Curso não encontrado" });

      const cliente = fastify.supabaseComoUsuario(request.accessToken!);

      // Busca o quiz para confirmar que existe
      const { data: quizData } = await cliente
        .from("quizzes")
        .select("id")
        .eq("curso_id", cursoId)
        .single();

      if (!quizData) {
        return reply.code(404).send({ erro: "Quiz não encontrado" });
      }

      // Deleta (cascade faz o resto)
      const { error: erroDelete } = await cliente.from("quizzes").delete().eq("id", (quizData as any).id);

      if (erroDelete) {
        request.log.error(erroDelete);
        return reply.code(500).send({ erro: "Não foi possível deletar o quiz" });
      }

      return reply.code(204).send();
    },
  );

  // ── Rotas do ALUNO (papel "aluno") ────────────────────────────────────

  // GET /api/aluno/cursos/:cursoId/quiz — quiz SEM a coluna correta
  fastify.get<{ Params: CursoParams }>(
    "/api/aluno/cursos/:cursoId/quiz",
    { onRequest: [fastify.exigirPapel("aluno")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { cursoId } = request.params;

      const clienteComoUsuario = fastify.supabaseComoUsuario(request.accessToken!);

      // R4: Verifica matrícula ativa do aluno no curso
      const { data: matriculaData, error: erroMatricula } = await clienteComoUsuario
        .from("matriculas")
        .select("id")
        .eq("aluno_id", usuario.id)
        .eq("curso_id", cursoId)
        .eq("status", "ativa")
        .single();

      if (erroMatricula || !matriculaData) {
        return reply.code(404).send({ erro: "Curso não encontrado" });
      }

      // A partir daqui, usamos supabaseAdmin para as tabelas de quiz.
      // RAZÃO: quiz*, quiz_perguntas e quiz_alternativas NÃO têm policy de SELECT para aluno —
      // por desenho, o backend serve o quiz com service role e controla quais colunas o aluno vê.
      // Se usássemos supabaseComoUsuario, as queries falhavam com RLS (erro de politica). A
      // matrícula ativa (verificada acima com RLS) é a única proteção multi-tenant.
      const clienteAdmin = fastify.supabaseAdmin;

      // Busca o quiz
      const { data: quizData, error: erroQuiz } = await clienteAdmin
        .from("quizzes")
        .select(COLUNAS_QUIZ)
        .eq("curso_id", cursoId)
        .single();

      if (erroQuiz || !quizData) {
        return reply.code(404).send({ erro: "Quiz não encontrado neste curso" });
      }

      const quiz = quizData as unknown as LinhaQuiz;

      // Busca perguntas
      const { data: perguntasData, error: erroPergunta } = await clienteAdmin
        .from("quiz_perguntas")
        .select(COLUNAS_PERGUNTA)
        .eq("quiz_id", quiz.id)
        .order("ordem", { ascending: true });

      if (erroPergunta) {
        request.log.error(erroPergunta);
        return reply.code(500).send({ erro: "Não foi possível carregar o quiz" });
      }

      const perguntas = (perguntasData as unknown as LinhaPergunta[]) || [];

      // Para cada pergunta, busca alternativas SEM a coluna correta
      const perguntasComAlternativas = await Promise.all(
        perguntas.map(async (pergunta) => {
          const { data: alternativasData, error: erroAlternativa } = await clienteAdmin
            .from("quiz_alternativas")
            .select(COLUNAS_ALTERNATIVA_ALUNO) // Aluno NÃO VÊ a coluna correta
            .eq("pergunta_id", pergunta.id)
            .order("id", { ascending: true });

          if (erroAlternativa) {
            request.log.error(erroAlternativa);
            throw new Error("Não foi possível carregar as alternativas");
          }

          const alternativas = (alternativasData as unknown as LinhaAlternativa[]) || [];

          return {
            ...paraApiPergunta(pergunta),
            alternativas: alternativas.map((alt) => paraApiAlternativa(alt, false)), // false = sem correta
          };
        }),
      );

      return {
        ...paraApiQuiz(quiz),
        perguntas: perguntasComAlternativas,
      };
    },
  );

  // POST /api/aluno/cursos/:cursoId/quiz/tentativas — registra tentativa
  fastify.post<{ Params: CursoParams; Body: RespostasBody }>(
    "/api/aluno/cursos/:cursoId/quiz/tentativas",
    { onRequest: [fastify.exigirPapel("aluno")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { cursoId } = request.params;
      const corpo = request.body ?? {};

      const clienteComoUsuario = fastify.supabaseComoUsuario(request.accessToken!);

      // R4: Verifica matrícula ativa
      const { data: matriculaData, error: erroMatricula } = await clienteComoUsuario
        .from("matriculas")
        .select("id")
        .eq("aluno_id", usuario.id)
        .eq("curso_id", cursoId)
        .eq("status", "ativa")
        .single();

      if (erroMatricula || !matriculaData) {
        return reply.code(404).send({ erro: "Curso não encontrado" });
      }

      // A partir daqui, usamos supabaseAdmin para as tabelas de quiz.
      // RAZÃO: quiz*, quiz_perguntas e quiz_alternativas NÃO têm policy de SELECT para aluno —
      // por desenho, o backend serve o quiz com service role e controla quais colunas o aluno vê.
      // Se usássemos supabaseComoUsuario, as queries falhavam com RLS (erro de politica). A
      // matrícula ativa (verificada acima com RLS) é a única proteção multi-tenant.
      const clienteAdmin = fastify.supabaseAdmin;

      // Busca o quiz
      const { data: quizData, error: erroQuiz } = await clienteAdmin
        .from("quizzes")
        .select(COLUNAS_QUIZ)
        .eq("curso_id", cursoId)
        .single();

      if (erroQuiz || !quizData) {
        return reply.code(404).send({ erro: "Quiz não encontrado" });
      }

      const quiz = quizData as unknown as LinhaQuiz;

      // Valida respostas do corpo
      const respostasEnviadas = typeof corpo.respostas === "object" && corpo.respostas !== null ? corpo.respostas : {};

      // Busca TODAS as perguntas e alternativas corretas do quiz
      const { data: perguntasData, error: erroPergunta } = await clienteAdmin
        .from("quiz_perguntas")
        .select(COLUNAS_PERGUNTA)
        .eq("quiz_id", quiz.id)
        .order("ordem", { ascending: true });

      if (erroPergunta) {
        request.log.error(erroPergunta);
        return reply.code(500).send({ erro: "Não foi possível processar a tentativa" });
      }

      const perguntas = (perguntasData as unknown as LinhaPergunta[]) || [];

      if (perguntas.length === 0) {
        return reply.code(400).send({ erro: "Quiz sem perguntas" });
      }

      // Para cada pergunta, busca quais alternativas são corretas
      const alternativasCorretas = new Map<string, string>(); // perguntaId -> alternativaId correta
      const alternativasValidas = new Map<string, Set<string>>(); // perguntaId -> Set de alternativaIds válidas

      await Promise.all(
        perguntas.map(async (pergunta) => {
          const { data: alternativasData, error: erroAlternativa } = await clienteAdmin
            .from("quiz_alternativas")
            .select("id, correta")
            .eq("pergunta_id", pergunta.id);

          if (erroAlternativa) {
            request.log.error(erroAlternativa);
            throw new Error("Não foi possível validar as respostas");
          }

          const alternativas = alternativasData as unknown as { id: string; correta: boolean }[];
          const validas = new Set<string>();
          alternativas.forEach((alt) => {
            validas.add(alt.id);
            if (alt.correta) {
              alternativasCorretas.set(pergunta.id, alt.id);
            }
          });
          alternativasValidas.set(pergunta.id, validas);
        }),
      );

      // Calcula acertos
      let acertos = 0;
      perguntas.forEach((pergunta) => {
        const respostaAluno = (respostasEnviadas as Record<string, unknown>)[pergunta.id];

        // Se o aluno não respondeu ou respondeu algo inválido, é erro
        if (typeof respostaAluno !== "string") {
          return; // Sem incrementar acertos
        }

        // Se a resposta não é uma alternativa válida daquela pergunta, é erro
        if (!alternativasValidas.get(pergunta.id)?.has(respostaAluno)) {
          return; // Sem incrementar acertos
        }

        // Se a resposta é a correta, incrementa
        if (alternativasCorretas.get(pergunta.id) === respostaAluno) {
          acertos++;
        }
      });

      // R2: Calcula nota no servidor, ignora qualquer nota/aprovado vindo do corpo
      const nota = parseFloat(((acertos / perguntas.length) * 100).toFixed(2));
      const aprovado = nota >= quiz.nota_minima_aprovacao;

      // Grava tentativa — R2: não aceita nota nem aprovado do corpo
      const { data: tentativaData, error: erroTentativa } = await clienteAdmin
        .from("quiz_tentativas")
        .insert({
          quiz_id: quiz.id,
          aluno_id: usuario.id,
          nota,
          aprovado,
          respostas: respostasEnviadas,
          finalizada_em: new Date().toISOString(),
        })
        .select(COLUNAS_TENTATIVA)
        .single();

      if (erroTentativa || !tentativaData) {
        request.log.error(erroTentativa);
        return reply.code(500).send({ erro: "Não foi possível registrar a tentativa" });
      }

      const tentativa = tentativaData as unknown as LinhaTentativa;

      return reply.code(201).send({
        id: tentativa.id,
        nota: tentativa.nota,
        aprovado: tentativa.aprovado,
        totalPerguntas: perguntas.length,
        acertos,
        finalizadaEm: tentativa.finalizada_em,
        // Sem revelar quais questões o aluno errou (decisão de produto para depois)
      });
    },
  );

  // GET /api/aluno/cursos/:cursoId/quiz/tentativas — lista tentativas do aluno
  fastify.get<{ Params: CursoParams }>(
    "/api/aluno/cursos/:cursoId/quiz/tentativas",
    { onRequest: [fastify.exigirPapel("aluno")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { cursoId } = request.params;

      const clienteComoUsuario = fastify.supabaseComoUsuario(request.accessToken!);

      // R4: Verifica matrícula ativa
      const { data: matriculaData, error: erroMatricula } = await clienteComoUsuario
        .from("matriculas")
        .select("id")
        .eq("aluno_id", usuario.id)
        .eq("curso_id", cursoId)
        .eq("status", "ativa")
        .single();

      if (erroMatricula || !matriculaData) {
        return reply.code(404).send({ erro: "Curso não encontrado" });
      }

      // A partir daqui, usamos supabaseAdmin para as tabelas de quiz.
      // RAZÃO: quiz*, quiz_perguntas e quiz_alternativas NÃO têm policy de SELECT para aluno —
      // por desenho, o backend serve o quiz com service role e controla quais colunas o aluno vê.
      // Se usássemos supabaseComoUsuario, as queries falhavam com RLS (erro de politica). A
      // matrícula ativa (verificada acima com RLS) é a única proteção multi-tenant.
      const clienteAdmin = fastify.supabaseAdmin;

      // Busca o quiz
      const { data: quizData, error: erroQuiz } = await clienteAdmin
        .from("quizzes")
        .select("id")
        .eq("curso_id", cursoId)
        .single();

      if (erroQuiz || !quizData) {
        return reply.code(404).send({ erro: "Quiz não encontrado" });
      }

      const quizId = (quizData as any).id;

      // Busca as tentativas DO ALUNO (RLS garante isso quando usamos supabaseComoUsuario)
      // Mas aqui usamos supabaseAdmin, então filtramos manualmente por aluno_id
      const { data: tentativasData, error: erroTentativas } = await clienteAdmin
        .from("quiz_tentativas")
        .select(COLUNAS_TENTATIVA)
        .eq("quiz_id", quizId)
        .eq("aluno_id", usuario.id)
        .order("finalizada_em", { ascending: false });

      if (erroTentativas) {
        request.log.error(erroTentativas);
        return reply.code(500).send({ erro: "Não foi possível carregar as tentativas" });
      }

      const tentativas = (tentativasData as unknown as LinhaTentativa[]) || [];

      return tentativas.map(paraApiTentativa);
    },
  );
}
