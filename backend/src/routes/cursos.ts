import type { FastifyInstance } from "fastify";

interface CursoBody {
  titulo?: unknown;
  descricao?: unknown;
  publicado?: unknown;
  // instituicaoId/criadoPor podem vir no corpo (cliente malicioso ou desatualizado) — são
  // deliberadamente ignorados em favor de request.usuario abaixo, nunca lidos daqui.
}

interface CursoParams {
  id: string;
}

// Só estas colunas — nunca "select *" — para a conversão pra camelCase abaixo ficar explícita
// e para não vazar coluna nova adicionada à tabela sem decisão consciente do contrato da API.
const COLUNAS_CURSO = "id, titulo, descricao, capa_url, publicado, criado_por, criado_em";

interface LinhaCurso {
  id: string;
  titulo: string;
  descricao: string | null;
  capa_url: string | null;
  publicado: boolean;
  criado_por: string | null;
  criado_em: string;
}

function paraApi(linha: LinhaCurso) {
  return {
    id: linha.id,
    titulo: linha.titulo,
    descricao: linha.descricao,
    capaUrl: linha.capa_url,
    publicado: linha.publicado,
    criadoPor: linha.criado_por,
    criadoEm: linha.criado_em,
  };
}

/** Título é a única obrigatoriedade do contrato; valida que existe e não é só espaço. */
function tituloValido(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim().length > 0;
}

// Estas cinco rotas são o PAINEL DO PROFESSOR (staff da instituição monta/edita curso) — por
// isso todas, inclusive as duas de leitura, exigem admin_instituicao ou professor. Curso não
// publicado é material em preparação (aula pela metade, prova sendo montada); um aluno não pode
// ler isso. A listagem que o ALUNO usa é outra rota, ainda não implementada (Fatia 4): filtra
// por matrícula ativa + `publicado = true`, não por instituicao_id solto feito aqui. Não afrouxe
// o papel destas rotas para "resolver" a falta dela — crie a rota nova em vez disso.
export default async function cursosRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/api/cursos",
    { onRequest: [fastify.exigirPapel("admin_instituicao", "professor")] },
    async (request, reply) => {
      const usuario = request.usuario!;

      // Camada 2 de isolamento: filtro explícito por instituicao_id, mesmo com RLS ativo
      // (supabaseComoUsuario). Ver aviso no topo de 0009_ingresso_alunos.sql — para a tabela
      // cursos o RLS sozinho NÃO isola entre tenants (policy cursos_select_publicado não
      // filtra instituição), então este .eq() aqui é a linha que realmente impede o vazamento.
      const { data, error } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("cursos")
        .select(COLUNAS_CURSO)
        .eq("instituicao_id", usuario.instituicaoId)
        .order("criado_em", { ascending: false });

      if (error) {
        request.log.error(error);
        return reply.code(500).send({ erro: "Não foi possível listar os cursos" });
      }

      return (data as unknown as LinhaCurso[]).map(paraApi);
    },
  );

  fastify.get<{ Params: CursoParams }>(
    "/api/cursos/:id",
    { onRequest: [fastify.exigirPapel("admin_instituicao", "professor")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { id } = request.params;

      // Mesmo filtro explícito por instituicao_id — buscar por id sozinho deixaria um usuário
      // de outra instituição ler curso alheio via RLS (cursos_select_publicado é cross-tenant).
      const { data, error } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("cursos")
        .select(COLUNAS_CURSO)
        .eq("id", id)
        .eq("instituicao_id", usuario.instituicaoId)
        .single();

      // Não vaza se o curso não existe ou se é de outra instituição — as duas situações
      // caem aqui (RLS ou o filtro acima barram a leitura da mesma forma) e respondem 404 igual.
      if (error || !data) {
        return reply.code(404).send({ erro: "Curso não encontrado" });
      }

      return paraApi(data as unknown as LinhaCurso);
    },
  );

  fastify.post<{ Body: CursoBody }>(
    "/api/cursos",
    { onRequest: [fastify.exigirPapel("admin_instituicao", "professor")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const corpo = request.body ?? {};

      if (!tituloValido(corpo.titulo)) {
        return reply.code(400).send({ erro: "Título é obrigatório" });
      }

      const descricao =
        corpo.descricao === undefined || corpo.descricao === null ? null : String(corpo.descricao);
      const publicado = corpo.publicado === true;

      // instituicao_id e criado_por vêm SEMPRE de request.usuario, nunca do corpo — mesmo que
      // o client mande esses campos (ver interface CursoBody acima), eles não são lidos aqui.
      const { data, error } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("cursos")
        .insert({
          instituicao_id: usuario.instituicaoId,
          criado_por: usuario.id,
          titulo: corpo.titulo.trim(),
          descricao,
          publicado,
        })
        .select(COLUNAS_CURSO)
        .single();

      if (error || !data) {
        request.log.error(error);
        return reply.code(500).send({ erro: "Não foi possível criar o curso" });
      }

      return reply.code(201).send(paraApi(data as unknown as LinhaCurso));
    },
  );

  fastify.patch<{ Params: CursoParams; Body: CursoBody }>(
    "/api/cursos/:id",
    { onRequest: [fastify.exigirPapel("admin_instituicao", "professor")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { id } = request.params;
      const corpo = request.body ?? {};

      if ("titulo" in corpo && !tituloValido(corpo.titulo)) {
        return reply.code(400).send({ erro: "Título não pode ser vazio" });
      }

      // Monta só com os campos que o contrato permite em PATCH — instituicaoId/criadoPor do
      // corpo (se vierem) nunca chegam aqui dentro, únicos campos possíveis são estes três.
      const atualizacoes: Record<string, unknown> = {};
      if ("titulo" in corpo) atualizacoes.titulo = (corpo.titulo as string).trim();
      if ("descricao" in corpo) {
        atualizacoes.descricao = corpo.descricao === null ? null : String(corpo.descricao);
      }
      if ("publicado" in corpo) atualizacoes.publicado = corpo.publicado === true;

      if (Object.keys(atualizacoes).length === 0) {
        return reply.code(400).send({ erro: "Nenhum campo para atualizar" });
      }

      // Filtro explícito por instituicao_id no UPDATE: sem ele, mesmo com RLS
      // (cursos_update_staff já exige instituicao_atual()), ficaríamos dependendo só do RLS
      // para a segunda camada de isolamento — este .eq() é a defesa que não depende disso.
      const { data, error } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("cursos")
        .update(atualizacoes)
        .eq("id", id)
        .eq("instituicao_id", usuario.instituicaoId)
        .select(COLUNAS_CURSO)
        .single();

      if (error || !data) {
        return reply.code(404).send({ erro: "Curso não encontrado" });
      }

      return paraApi(data as unknown as LinhaCurso);
    },
  );

  fastify.delete<{ Params: CursoParams }>(
    "/api/cursos/:id",
    { onRequest: [fastify.exigirPapel("admin_instituicao", "professor")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const { id } = request.params;

      // Mesmo padrão: filtro explícito por instituicao_id no DELETE, independente do RLS.
      const { data, error } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("cursos")
        .delete()
        .eq("id", id)
        .eq("instituicao_id", usuario.instituicaoId)
        .select("id");

      if (error) {
        request.log.error(error);
        return reply.code(500).send({ erro: "Não foi possível remover o curso" });
      }

      // Nenhuma linha apagada: ou o id não existe, ou é de outra instituição — não distinguir.
      if (!data || (data as unknown[]).length === 0) {
        return reply.code(404).send({ erro: "Curso não encontrado" });
      }

      return reply.code(204).send();
    },
  );
}
