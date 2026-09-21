import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";

interface AlunoBody {
  nome?: unknown;
  email?: unknown;
}

interface AlunoParams {
  id: string;
}

interface MatriculaParams {
  cursoId: string;
  alunoId: string;
}

interface MatriculaBody {
  alunoId?: unknown;
}

const COLUNAS_ALUNO = "id, nome, papel, status, criado_em";

interface LinhaAluno {
  id: string;
  nome: string;
  papel: string;
  status: string;
  criado_em: string;
}

interface LinhaMatricula {
  id: string;
  curso_id: string;
  aluno_id: string;
  status: string;
  matriculado_em: string;
}

function paraApiAluno(linha: LinhaAluno) {
  return {
    id: linha.id,
    nome: linha.nome,
    papel: linha.papel,
    status: linha.status,
    criadoEm: linha.criado_em,
  };
}

function paraApiMatricula(linha: LinhaMatricula) {
  return {
    id: linha.id,
    cursoId: linha.curso_id,
    alunoId: linha.aluno_id,
    status: linha.status,
    matriculadoEm: linha.matriculado_em,
  };
}

/** Gera uma senha provisória legível de 12+ caracteres para ser ditada por telefone.
 * Nota: byte % 55 introduz viés leve (256 não é múltiplo de 55), mas a entropia permanece alta para temporária. */
function gerarSenhaProvisoria(): string {
  // Usa apenas caracteres legíveis: letras maiúsculas e minúsculas + dígitos (sem 0/O/I/1/l para evitar confusão)
  const caracteres = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  let senha = "";
  for (const byte of bytes) {
    senha += caracteres[byte % caracteres.length];
  }
  return senha;
}

/** Nome e email são obrigatórios e não podem ser vazios. */
function validarCamposAluno(nome: unknown, email: unknown): boolean {
  return (
    typeof nome === "string" &&
    typeof email === "string" &&
    nome.trim().length > 0 &&
    email.trim().length > 0
  );
}

export default async function alunosRoutes(fastify: FastifyInstance) {
  // GET /api/alunos — lista alunos da instituição com filtro opcional por status
  fastify.get(
    "/api/alunos",
    { onRequest: [fastify.exigirPapel("admin_instituicao", "professor")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { status } = request.query as Record<string, unknown>;

      // Valida o filtro de status, se fornecido
      const statusValidos = ["ativo", "pendente", "recusado"];
      if (status !== undefined && !statusValidos.includes(String(status))) {
        return reply.code(400).send({ erro: "Status inválido: use ativo, pendente ou recusado" });
      }

      let query = fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("usuarios")
        .select(COLUNAS_ALUNO)
        .eq("instituicao_id", usuario.instituicaoId)
        .eq("papel", "aluno");

      if (status) {
        query = query.eq("status", status as string);
      }

      const { data, error } = await query.order("nome", { ascending: true });

      if (error) {
        request.log.error(error);
        return reply.code(500).send({ erro: "Não foi possível listar os alunos" });
      }

      return (data as unknown as LinhaAluno[]).map(paraApiAluno);
    },
  );

  // POST /api/alunos — cria novo aluno manualmente
  fastify.post<{ Body: AlunoBody }>(
    "/api/alunos",
    { onRequest: [fastify.exigirPapel("admin_instituicao", "professor")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const corpo = request.body ?? {};

      if (!validarCamposAluno(corpo.nome, corpo.email)) {
        return reply
          .code(400)
          .send({ erro: "Nome e email são obrigatórios e não podem estar vazios" });
      }

      const nome = (corpo.nome as string).trim();
      const email = (corpo.email as string).trim();
      const senhaProvisoria = gerarSenhaProvisoria();

      // Cria o usuário no Supabase Auth — supabaseAdmin é autorizado aqui (Admin API).
      const { data: usuarioAuth, error: erroAuth } = await fastify.supabaseAdmin.auth.admin.createUser({
        email,
        password: senhaProvisoria,
        email_confirm: true,
      });

      if (erroAuth || !usuarioAuth.user) {
        request.log.error(erroAuth);
        return reply.code(409).send({ erro: "Não foi possível criar o usuário" });
      }

      // Insere o perfil do aluno em `usuarios`
      // Nota: uso supabaseAdmin porque a tabela usuarios não tem policy de INSERT.
      // Isolamento multi-tenant é garantido por instituicao_id ser sempre do request.usuario.instituicaoId,
      // nunca do corpo da requisição — isso passa a ser a única defesa nesta escrita.
      const { error: erroPerfil } = await fastify
        .supabaseAdmin
        .from("usuarios")
        .insert({
          id: usuarioAuth.user.id,
          instituicao_id: usuario.instituicaoId,
          papel: "aluno",
          nome,
          status: "ativo",
        })
        .select(COLUNAS_ALUNO)
        .single();

      // Se o insert falhar, faz rollback deletando o usuário criado no Auth
      if (erroPerfil) {
        request.log.error(erroPerfil);
        await fastify.supabaseAdmin.auth.admin.deleteUser(usuarioAuth.user.id);
        return reply.code(500).send({ erro: "Não foi possível criar o perfil do aluno" });
      }

      // A senha provisória só aparece nesta resposta, uma única vez — nunca mais será retornada
      return reply.code(201).send({
        id: usuarioAuth.user.id,
        nome,
        papel: "aluno",
        status: "ativo",
        criadoEm: new Date().toISOString(),
        senhaProvisoria,
      });
    },
  );

  // POST /api/alunos/:id/aprovar — aprova aluno pendente
  fastify.post<{ Params: AlunoParams }>(
    "/api/alunos/:id/aprovar",
    { onRequest: [fastify.exigirPapel("admin_instituicao", "professor")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { id } = request.params;

      // Primeiro busca o aluno para verificar se existe e se está pendente
      const { data: alunoAtual, error: erroSelect } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("usuarios")
        .select(COLUNAS_ALUNO)
        .eq("id", id)
        .eq("instituicao_id", usuario.instituicaoId)
        .eq("papel", "aluno")
        .single();

      if (erroSelect || !alunoAtual) {
        return reply.code(404).send({ erro: "Aluno não encontrado" });
      }

      const linhaAtual = alunoAtual as unknown as LinhaAluno;

      if (linhaAtual.status !== "pendente") {
        return reply.code(400).send({ erro: "Aluno não está em status pendente" });
      }

      // Aprova o aluno mudando status para ativo
      // Nota: uso supabaseAdmin para o UPDATE porque a tabela usuarios não tem policy de UPDATE.
      // O filtro .eq("instituicao_id", usuario.instituicaoId) é obrigatório aqui — sem ele,
      // o cliente poderia atualizar qualquer aluno de qualquer instituição. É a única defesa nesta escrita.
      const { data: alunoAtualizado, error: erroUpdate } = await fastify
        .supabaseAdmin
        .from("usuarios")
        .update({ status: "ativo" })
        .eq("id", id)
        .eq("instituicao_id", usuario.instituicaoId)
        .select(COLUNAS_ALUNO)
        .single();

      if (erroUpdate || !alunoAtualizado) {
        request.log.error(erroUpdate);
        return reply.code(500).send({ erro: "Não foi possível aprovar o aluno" });
      }

      return paraApiAluno(alunoAtualizado as unknown as LinhaAluno);
    },
  );

  // POST /api/alunos/:id/recusar — recusa aluno pendente
  fastify.post<{ Params: AlunoParams }>(
    "/api/alunos/:id/recusar",
    { onRequest: [fastify.exigirPapel("admin_instituicao", "professor")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { id } = request.params;

      // Primeiro busca o aluno para verificar se existe e se está pendente
      const { data: alunoAtual, error: erroSelect } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("usuarios")
        .select(COLUNAS_ALUNO)
        .eq("id", id)
        .eq("instituicao_id", usuario.instituicaoId)
        .eq("papel", "aluno")
        .single();

      if (erroSelect || !alunoAtual) {
        return reply.code(404).send({ erro: "Aluno não encontrado" });
      }

      const linhaAtual = alunoAtual as unknown as LinhaAluno;

      if (linhaAtual.status !== "pendente") {
        return reply.code(400).send({ erro: "Aluno não está em status pendente" });
      }

      // Recusa o aluno mudando status para recusado
      // Nota: uso supabaseAdmin para o UPDATE porque a tabela usuarios não tem policy de UPDATE.
      // O filtro .eq("instituicao_id", usuario.instituicaoId) é obrigatório aqui — sem ele,
      // o cliente poderia atualizar qualquer aluno de qualquer instituição. É a única defesa nesta escrita.
      const { data: alunoAtualizado, error: erroUpdate } = await fastify
        .supabaseAdmin
        .from("usuarios")
        .update({ status: "recusado" })
        .eq("id", id)
        .eq("instituicao_id", usuario.instituicaoId)
        .select(COLUNAS_ALUNO)
        .single();

      if (erroUpdate || !alunoAtualizado) {
        request.log.error(erroUpdate);
        return reply.code(500).send({ erro: "Não foi possível recusar o aluno" });
      }

      return paraApiAluno(alunoAtualizado as unknown as LinhaAluno);
    },
  );

  // POST /api/cursos/:cursoId/matriculas — matricula aluno no curso
  fastify.post<{ Params: { cursoId: string }; Body: MatriculaBody }>(
    "/api/cursos/:cursoId/matriculas",
    { onRequest: [fastify.exigirPapel("admin_instituicao", "professor")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { cursoId } = request.params;
      const corpo = request.body ?? {};
      const { alunoId } = corpo;

      if (!alunoId || typeof alunoId !== "string") {
        return reply.code(400).send({ erro: "alunoId é obrigatório" });
      }

      // Verifica que o curso pertence à instituição da sessão
      const { data: cursoData, error: erroCurso } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("cursos")
        .select("id")
        .eq("id", cursoId)
        .eq("instituicao_id", usuario.instituicaoId)
        .single();

      if (erroCurso || !cursoData) {
        return reply.code(404).send({ erro: "Curso não encontrado" });
      }

      // Verifica que o aluno pertence à instituição da sessão e tem papel 'aluno'
      const { data: alunoData, error: erroAluno } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("usuarios")
        .select("id")
        .eq("id", alunoId as string)
        .eq("instituicao_id", usuario.instituicaoId)
        .eq("papel", "aluno")
        .single();

      if (erroAluno || !alunoData) {
        return reply.code(404).send({ erro: "Aluno não encontrado" });
      }

      // Tenta inserir a matrícula
      const { data: matricula, error: erroMatricula } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("matriculas")
        .insert({
          curso_id: cursoId,
          aluno_id: alunoId as string,
          status: "ativa",
        })
        .select("id, curso_id, aluno_id, status, matriculado_em")
        .single();

      // Se a constraint unique falhar, retorna 409 com mensagem clara
      if (erroMatricula) {
        if (erroMatricula.message?.includes("duplicate") || erroMatricula.code === "23505") {
          return reply
            .code(409)
            .send({ erro: "Aluno já está matriculado neste curso" });
        }
        request.log.error(erroMatricula);
        return reply.code(500).send({ erro: "Não foi possível criar a matrícula" });
      }

      return reply
        .code(201)
        .send(paraApiMatricula(matricula as unknown as LinhaMatricula));
    },
  );

  // DELETE /api/cursos/:cursoId/matriculas/:alunoId — remove matrícula
  fastify.delete<{ Params: MatriculaParams }>(
    "/api/cursos/:cursoId/matriculas/:alunoId",
    { onRequest: [fastify.exigirPapel("admin_instituicao", "professor")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { cursoId, alunoId } = request.params;

      // Verifica que o curso pertence à instituição da sessão
      const { data: cursoData, error: erroCurso } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("cursos")
        .select("id")
        .eq("id", cursoId)
        .eq("instituicao_id", usuario.instituicaoId)
        .single();

      if (erroCurso || !cursoData) {
        return reply.code(404).send({ erro: "Curso não encontrado" });
      }

      // Tenta deletar a matrícula
      const { data: deletados, error: erroDelete } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("matriculas")
        .delete()
        .eq("curso_id", cursoId)
        .eq("aluno_id", alunoId)
        .select("id");

      if (erroDelete) {
        request.log.error(erroDelete);
        return reply.code(500).send({ erro: "Não foi possível remover a matrícula" });
      }

      // Se nenhuma linha foi deletada, retorna 404
      if (!deletados || (deletados as unknown[]).length === 0) {
        return reply.code(404).send({ erro: "Matrícula não encontrada" });
      }

      return reply.code(204).send();
    },
  );
}
