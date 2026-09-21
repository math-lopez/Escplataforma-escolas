import type { FastifyInstance } from "fastify";
import { definirCookiesSessao } from "../lib/sessao.js";
import { montarRespostaPerfil } from "./auth.js";

interface OnboardingBody {
  nomeInstituicao: string;
  slug: string;
  nomeAdmin: string;
  email: string;
  senha: string;
}

interface PatchInstituicaoBody {
  nome?: unknown;
  modoIngresso?: unknown;
  corPrimaria?: unknown;
  logoUrl?: unknown;
}

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Valida se a cor é um hexadecimal válido: #RRGGBB ou #RGB
 */
function validarCorHexadecimal(cor: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(cor);
}

export default async function instituicoesRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: OnboardingBody }>("/api/instituicoes/onboarding", async (request, reply) => {
    const { nomeInstituicao, slug, nomeAdmin, email, senha } = request.body ?? {};

    if (!nomeInstituicao || !slug || !nomeAdmin || !email || !senha) {
      return reply.code(400).send({ erro: "Campos obrigatórios ausentes" });
    }
    if (!SLUG_REGEX.test(slug)) {
      return reply.code(400).send({ erro: "Slug inválido: use apenas letras minúsculas, números e hífen" });
    }

    const { data: instituicao, error: erroInstituicao } = await fastify.supabaseAdmin
      .from("instituicoes")
      .insert({ nome: nomeInstituicao, slug })
      .select("id")
      .single();

    if (erroInstituicao || !instituicao) {
      request.log.error(erroInstituicao);
      return reply.code(409).send({ erro: "Não foi possível criar a instituição (slug já existe?)" });
    }

    const { data: usuarioAuth, error: erroAuth } = await fastify.supabaseAdmin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
    });

    if (erroAuth || !usuarioAuth.user) {
      request.log.error(erroAuth);
      await fastify.supabaseAdmin.from("instituicoes").delete().eq("id", instituicao.id);
      return reply.code(409).send({ erro: "Não foi possível criar o usuário admin" });
    }

    const { error: erroPerfil } = await fastify.supabaseAdmin.from("usuarios").insert({
      id: usuarioAuth.user.id,
      instituicao_id: instituicao.id,
      papel: "admin_instituicao",
      nome: nomeAdmin,
    });

    if (erroPerfil) {
      request.log.error(erroPerfil);
      await fastify.supabaseAdmin.auth.admin.deleteUser(usuarioAuth.user.id);
      await fastify.supabaseAdmin.from("instituicoes").delete().eq("id", instituicao.id);
      return reply.code(500).send({ erro: "Não foi possível criar o perfil do admin" });
    }

    // Já autentica o admin recém-criado: o frontend sai do cadastro direto logado.
    const { data: sessao } = await fastify.supabaseAuth.auth.signInWithPassword({
      email,
      password: senha,
    });

    if (sessao?.session) {
      definirCookiesSessao(reply, sessao.session);
    }

    // Reaproveita o mesmo ponto único de montagem de resposta que login e /me usam (ver
    // comentário completo em routes/auth.ts) — sem isso, esta seria a terceira cópia do mesmo
    // formato de perfil divergindo com o tempo (já divergiu antes desta correção: faltava
    // `instituicao`, deixando quem acabou de criar a conta sem o próprio branding).
    //
    // Usa `supabaseAdmin` (já legitimamente na allowlist deste arquivo — onboarding cruza
    // instituições) em vez de `supabaseComoUsuario(sessao.session.access_token)` porque
    // `sessao?.session` pode ser undefined aqui (o sign-in acima pode falhar por motivo
    // transitório mesmo com o usuário recém-criado) — não há accessToken garantido para montar
    // esse client. Buscar `instituicoes` com o client admin não contorna isolamento nenhum: a
    // leitura já é pública via RLS (instituicoes_select_publico, 0008).
    const resposta = await montarRespostaPerfil(fastify, fastify.supabaseAdmin, {
      id: usuarioAuth.user.id,
      nome: nomeAdmin,
      papel: "admin_instituicao",
      instituicaoId: instituicao.id,
    });

    return reply.code(201).send(resposta);
  });

  // PATCH /api/instituicoes/atual — atualiza dados da instituição (admin_instituicao only)
  fastify.patch<{ Body: PatchInstituicaoBody }>(
    "/api/instituicoes/atual",
    { onRequest: [fastify.exigirPapel("admin_instituicao")] },
    async (request, reply) => {
      const usuario = request.usuario!;
      const corpo = request.body ?? {};

      // Prepara o objeto de atualização com apenas os campos fornecidos
      const atualizacao: Record<string, unknown> = {};

      if (corpo.nome !== undefined) {
        const nome = corpo.nome;
        if (typeof nome === "string" && nome.trim().length > 0) {
          atualizacao.nome = nome.trim();
        } else if (typeof nome === "string") {
          return reply.code(400).send({ erro: "Nome não pode estar vazio" });
        }
      }

      if (corpo.modoIngresso !== undefined) {
        const modoIngresso = corpo.modoIngresso;
        if (typeof modoIngresso === "string") {
          if (!["manual", "convite", "auto_aprovacao"].includes(modoIngresso)) {
            return reply
              .code(400)
              .send({ erro: "Modo de ingresso inválido (use: manual, convite, auto_aprovacao)" });
          }
          atualizacao.modo_ingresso = modoIngresso;
        } else {
          return reply.code(400).send({ erro: "Modo de ingresso deve ser uma string" });
        }
      }

      if (corpo.corPrimaria !== undefined) {
        const corPrimaria = corpo.corPrimaria;
        if (typeof corPrimaria === "string") {
          if (!validarCorHexadecimal(corPrimaria)) {
            return reply
              .code(400)
              .send({ erro: "Cor primária inválida (use formato hexadecimal: #RRGGBB ou #RGB)" });
          }
          atualizacao.cor_primaria = corPrimaria;
        } else {
          return reply.code(400).send({ erro: "Cor primária deve ser uma string" });
        }
      }

      if (corpo.logoUrl !== undefined) {
        const logoUrl = corpo.logoUrl;
        if (typeof logoUrl === "string" || logoUrl === null) {
          atualizacao.logo_url = logoUrl;
        } else {
          return reply.code(400).send({ erro: "URL do logo deve ser uma string ou null" });
        }
      }

      // Se nenhum campo foi fornecido, retorna a instituição atual sem atualizar
      if (Object.keys(atualizacao).length === 0) {
        const { data: instituicao } = await fastify
          .supabaseComoUsuario(request.accessToken!)
          .from("instituicoes")
          .select("id, nome, slug, logo_url, cor_primaria, modo_ingresso")
          .eq("id", usuario.instituicaoId)
          .single();

        if (instituicao) {
          const inst = instituicao as Record<string, unknown>;
          return reply.code(200).send({
            id: inst.id,
            nome: inst.nome,
            slug: inst.slug,
            logoUrl: inst.logo_url,
            corPrimaria: inst.cor_primaria,
            modoIngresso: inst.modo_ingresso,
          });
        }

        return reply.code(500).send({ erro: "Não foi possível recuperar dados da instituição" });
      }

      // Atualiza apenas a instituição da sessão (R3)
      const { data: instituicaoAtualizada, error: erroUpdate } = await fastify
        .supabaseComoUsuario(request.accessToken!)
        .from("instituicoes")
        .update(atualizacao)
        .eq("id", usuario.instituicaoId) // Garante que atualiza SEMPRE pela sessão
        .select("id, nome, slug, logo_url, cor_primaria, modo_ingresso")
        .single();

      if (erroUpdate || !instituicaoAtualizada) {
        request.log.error(erroUpdate);
        return reply.code(500).send({ erro: "Não foi possível atualizar a instituição" });
      }

      const inst = instituicaoAtualizada as Record<string, unknown>;
      return reply.code(200).send({
        id: inst.id,
        nome: inst.nome,
        slug: inst.slug,
        logoUrl: inst.logo_url,
        corPrimaria: inst.cor_primaria,
        modoIngresso: inst.modo_ingresso,
      });
    },
  );
}
