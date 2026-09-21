import type { FastifyInstance } from "fastify";
import { env } from "../env.js";

interface InscricaoBody {
  nome?: unknown;
  email?: unknown;
  senha?: unknown;
}

interface LinhaInstituicao {
  id: string;
  nome: string;
  slug: string;
  logo_url: string | null;
  cor_primaria: string | null;
  modo_ingresso: string;
}

interface LinhaCurso {
  id: string;
  titulo: string;
  descricao: string | null;
  capa_url: string | null;
}

function validarEmail(email: unknown): boolean {
  return typeof email === "string" && email.trim().length > 0;
}

function validarNome(nome: unknown): boolean {
  return typeof nome === "string" && nome.trim().length > 0;
}

function validarSenha(senha: unknown): boolean {
  return typeof senha === "string" && senha.length >= 8;
}

/**
 * Valida se a cor é um hexadecimal válido: #RRGGBB ou #RGB
 */
function validarCorHexadecimal(cor: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(cor);
}

export default async function publicoRoutes(fastify: FastifyInstance) {
  // GET /api/publico/instituicoes/:slug — dados públicos da instituição e cursos publicados
  fastify.get<{ Params: { slug: string } }>(
    "/api/publico/instituicoes/:slug",
    async (request, reply) => {
      const { slug } = request.params;

      // R3: Resolve instituição pelo slug usando supabaseAdmin (rota pública)
      const { data: instituicao, error: erroInstituicao } = await fastify.supabaseAdmin
        .from("instituicoes")
        .select("id, nome, slug, logo_url, cor_primaria, modo_ingresso")
        .eq("slug", slug)
        .single();

      if (erroInstituicao || !instituicao) {
        return reply.code(404).send({ erro: "Instituição não encontrada" });
      }

      const inst = instituicao as unknown as LinhaInstituicao;

      // Busca apenas cursos publicados (R1: não lê a policy, lê explicitamente via backend)
      const { data: cursos, error: erroCursos } = await fastify.supabaseAdmin
        .from("cursos")
        .select("id, titulo, descricao, capa_url")
        .eq("instituicao_id", inst.id)
        .eq("publicado", true)
        .order("criado_em", { ascending: true });

      if (erroCursos) {
        request.log.error(erroCursos);
        return reply.code(500).send({ erro: "Erro ao buscar cursos" });
      }

      const cursosParsed = (cursos as unknown as LinhaCurso[]) ?? [];

      return reply.code(200).send({
        nome: inst.nome,
        slug: inst.slug,
        logoUrl: inst.logo_url,
        corPrimaria: inst.cor_primaria,
        modoIngresso: inst.modo_ingresso,
        cursos: cursosParsed.map((c) => ({
          id: c.id,
          titulo: c.titulo,
          descricao: c.descricao,
          capaUrl: c.capa_url,
        })),
      });
    },
  );

  // POST /api/publico/instituicoes/:slug/inscricao — auto-cadastro público
  fastify.post<{ Params: { slug: string }; Body: InscricaoBody }>(
    "/api/publico/instituicoes/:slug/inscricao",
    async (request, reply) => {
      const { slug } = request.params;
      const corpo = request.body ?? {};

      // Valida campos
      if (!validarNome(corpo.nome)) {
        return reply.code(400).send({ erro: "Nome é obrigatório e não pode estar vazio" });
      }

      if (!validarEmail(corpo.email)) {
        return reply.code(400).send({ erro: "E-mail é obrigatório e não pode estar vazio" });
      }

      if (!validarSenha(corpo.senha)) {
        return reply
          .code(400)
          .send({ erro: "Senha é obrigatória e deve ter no mínimo 8 caracteres" });
      }

      const nome = (corpo.nome as string).trim();
      const email = (corpo.email as string).trim();
      const senha = corpo.senha as string;

      // R3: Resolve instituição pelo slug
      const { data: instituicao, error: erroInstituicao } = await fastify.supabaseAdmin
        .from("instituicoes")
        .select("id, modo_ingresso")
        .eq("slug", slug)
        .single();

      if (erroInstituicao || !instituicao) {
        return reply.code(404).send({ erro: "Instituição não encontrada" });
      }

      const inst = instituicao as unknown as { id: string; nome: string; modo_ingresso: string };

      // R1: Verifica se modo_ingresso permite auto-aprovação
      if (inst.modo_ingresso !== "auto_aprovacao") {
        return reply.code(403).send({
          erro: "Auto-cadastro não está habilitado para esta instituição",
        });
      }

      // R5: Não revelamos se o e-mail já existe — respondemos 201 com mensagem verdadeira em
      // ambos os casos (cadastro novo E e-mail já registrado). A mensagem é redigida de forma
      // genérica para cobrir os dois cenários sem enganar o usuário:
      // - Se é novo: "Se este e-mail ainda não tiver cadastro..." será avaliado (verdade)
      // - Se já existe: "Se você já tem conta..." leia a segunda metade e faça login (verdade)
      // Isso protege contra enumeração de e-mail (resposta idêntica) SEM deixar o usuário em
      // beco sem saída (ele entende qual é a situação lendo a mensagem).
      const { data: usuarioAuth, error: erroAuth } = await fastify.supabaseAdmin.auth.admin
        .createUser({
          email,
          password: senha,
          email_confirm: true,
        });

      // Se falhou por "já existe", respondemos com a mesma resposta que o sucesso
      // Se falhou por outro motivo, é erro real do servidor
      if (erroAuth) {
        if (
          typeof erroAuth.message === "string" &&
          erroAuth.message.toLowerCase().includes("already exists")
        ) {
          // E-mail já registrado — respondemos com a mesma estrutura (não revelamos)
          return reply.code(201).send({
            status: "pendente",
            mensagem:
              "Se este e-mail ainda não tiver cadastro nesta instituição, sua solicitação foi enviada e será avaliada. Se você já tem conta, faça login.",
            instituicao: { nome: inst.nome, slug },
          });
        }

        request.log.error(erroAuth);
        return reply.code(500).send({ erro: "Não foi possível criar a conta de usuário" });
      }

      if (!usuarioAuth.user) {
        return reply.code(500).send({ erro: "Não foi possível criar a conta de usuário" });
      }

      // R2: Insere em `usuarios` com papel='aluno' e status='pendente' fixos
      const { error: erroPerfil } = await fastify.supabaseAdmin.from("usuarios").insert({
        id: usuarioAuth.user.id,
        instituicao_id: inst.id, // R3: vem da resolução pelo slug
        papel: "aluno", // R2: fixo, nunca lê do corpo
        status: "pendente", // R2: fixo, nunca lê do corpo
        nome,
      });

      if (erroPerfil) {
        request.log.error(erroPerfil);
        // Rollback: apaga o usuário do Auth que acabou de ser criado
        await fastify.supabaseAdmin.auth.admin.deleteUser(usuarioAuth.user.id);
        return reply.code(500).send({ erro: "Não foi possível criar o perfil do usuário" });
      }

      // Sucesso: responde 201 com a mesma mensagem que o e-mail duplicado para não revelar diferença
      return reply.code(201).send({
        status: "pendente",
        mensagem:
          "Se este e-mail ainda não tiver cadastro nesta instituição, sua solicitação foi enviada e será avaliada. Se você já tem conta, faça login.",
        instituicao: { nome: inst.nome, slug },
      });
    },
  );
}
