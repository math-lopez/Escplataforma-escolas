// Guard arquitetural: mecaniza a regra "toda rota/serviço de negócio usa supabaseComoUsuario;
// supabaseAdmin (service role, ignora RLS) só para o que legitimamente cruza instituições"
// (ver backend/src/plugins/supabase.ts e CLAUDE.md, seção "Contrato de autenticação").
//
// Sem este teste, a regra depende só de lembrança em code review — exatamente o tipo de
// esquecimento que causou o problema original (isolamento multi-tenant dependendo 100% de
// um filtro manual). Varre TODO `backend/src/`, não só `routes/`: o CLAUDE.md define
// `backend/src/services/` como o lugar da lógica de negócio (é lá que a Fatia 1 vai colocar as
// queries de curso/matrícula/progresso), e um `services/*.ts` usando supabaseAdmin escaparia de
// um guard restrito a `routes/`.
//
// IMPORTANTE: a busca ignora comentários (linha e bloco) antes de procurar o identificador. Sem
// isso, o guard pune quem DOCUMENTA a decisão de segurança — um comentário explicando "por que
// esta rota não usa supabaseAdmin" vira um falso positivo, e o efeito prático é ensinar quem
// escreve o código a evitar citar o nome em comentário. Isso já aconteceu de verdade nesta
// fatia (ver routes/auth.ts). Uma limitação consciente: isto NÃO defende contra evasão
// deliberada (`fastify["supabaseAdmin"]`, concatenação de string, etc.) — o guard existe contra
// esquecimento, não contra alguém tentando burlá-lo de propósito, e complicar a detecção por
// causa desse cenário só tornaria o teste mais frágil para o caso comum.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SRC_DIR = join(__dirname, "../src");

/**
 * Allowlist de arquivos que legitimamente usam `supabaseAdmin`, caminho relativo a
 * `backend/src/`.
 *
 * Adicionar uma entrada aqui é uma decisão de segurança CONSCIENTE: só faz sentido para (a) o
 * próprio arquivo que define o client (`plugins/supabase.ts`) ou (b) operações que precisam
 * cruzar instituições (onboarding, criação de usuário via Admin API, operações administrativas
 * equivalentes). Qualquer rota/service de negócio comum (listar/criar/editar dado de uma
 * instituição) deve usar `fastify.supabaseComoUsuario(request.accessToken)`.
 */
const ALLOWLIST_SUPABASE_ADMIN = new Set<string>([
  "plugins/supabase.ts", // onde supabaseAdmin é declarado/instanciado — não um uso, a definição
  "routes/instituicoes.ts", // onboarding: cria instituição + primeiro admin, sem instituição/sessão prévia
  "routes/alunos.ts", // POST /api/alunos: criação de usuário no Supabase Auth via Admin API (único jeito)
  "routes/convites.ts", // POST /api/publico/convites/:token/aceitar: aceita convite sem sessão prévia, criação de usuário via Admin API
  "routes/publico.ts", // GET /api/publico/instituicoes/:slug e POST /api/publico/instituicoes/:slug/inscricao: rotas públicas sem sessão, auto-cadastro via Admin API
  "routes/webhooks.ts", // webhook da Bunny: chamada da Bunny, sem sessão/accessToken de usuário nenhum
  "routes/certificados.ts", // GET /api/publico/certificados/:codigo: validação pública de certificado sem sessão, só o código é o "segredo"
  "routes/quizzes.ts", // quiz*, quiz_perguntas, quiz_alternativas NÃO têm policy de SELECT para aluno — backend serve o quiz com service role, controlando colunas. Matrícula ativa é a única proteção multi-tenant.
]);

function listarArquivosTs(dir: string, prefixo = ""): string[] {
  const entradas = readdirSync(dir);
  let arquivos: string[] = [];

  for (const nome of entradas) {
    const caminho = join(dir, nome);
    const relativo = prefixo ? `${prefixo}/${nome}` : nome;

    if (statSync(caminho).isDirectory()) {
      arquivos = arquivos.concat(listarArquivosTs(caminho, relativo));
    } else if (nome.endsWith(".ts")) {
      arquivos.push(relativo);
    }
  }

  return arquivos;
}

/**
 * Remove comentários de linha (`//`) e de bloco (`/* *\/`) do código antes da busca pelo
 * identificador — preservando o conteúdo de strings/template literals, para uma URL como
 * `"https://..."` não ser confundida com o início de um comentário de linha. Não é um parser de
 * verdade (não lida com todo caso patológico de regex-em-string, por exemplo), mas é suficiente
 * para o TypeScript deste repositório.
 */
function removerComentarios(codigo: string): string {
  return codigo.replace(
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (trecho) => (trecho.startsWith("//") || trecho.startsWith("/*") ? "" : trecho),
  );
}

function usaSupabaseAdmin(caminhoAbsoluto: string): boolean {
  const codigo = removerComentarios(readFileSync(caminhoAbsoluto, "utf-8"));
  return /\bsupabaseAdmin\b/.test(codigo);
}

describe("guard: uso de supabaseAdmin em backend/src", () => {
  it("existe pelo menos um arquivo para verificar", () => {
    expect(listarArquivosTs(SRC_DIR).length).toBeGreaterThan(0);
  });

  it("nenhum arquivo fora da allowlist usa supabaseAdmin", () => {
    const arquivos = listarArquivosTs(SRC_DIR);

    const violacoes = arquivos.filter(
      (arquivo) => usaSupabaseAdmin(join(SRC_DIR, arquivo)) && !ALLOWLIST_SUPABASE_ADMIN.has(arquivo),
    );

    expect(
      violacoes,
      `Arquivo(s) usando supabaseAdmin sem estar na allowlist: ${violacoes.join(", ")}. ` +
        `Rota/service de negócio deve usar fastify.supabaseComoUsuario(request.accessToken) para manter o RLS ativo.`,
    ).toEqual([]);
  });

  it("a allowlist não tem entradas obsoletas", () => {
    for (const arquivo of ALLOWLIST_SUPABASE_ADMIN) {
      const caminho = join(SRC_DIR, arquivo);

      expect(existsSync(caminho), `${arquivo} está na allowlist mas o arquivo não existe mais`).toBe(true);
      expect(
        usaSupabaseAdmin(caminho),
        `${arquivo} está na allowlist mas não usa mais supabaseAdmin — remova a entrada`,
      ).toBe(true);
    }
  });
});

// Este par de testes documenta a intenção do guard melhor que qualquer comentário: ele existe
// para pegar USO real de supabaseAdmin fora da allowlist, não para punir quem escreve o nome
// numa explicação. Usa arquivos temporários fora de backend/src (não são o guard "de produção"
// rodando contra o próprio repo) para exercitar `usaSupabaseAdmin` isoladamente.
describe("usaSupabaseAdmin ignora comentários", () => {
  let dirTemporario: string;

  beforeEach(() => {
    dirTemporario = mkdtempSync(join(tmpdir(), "guard-supabase-admin-"));
  });

  afterEach(() => {
    rmSync(dirTemporario, { recursive: true, force: true });
  });

  it("não reporta violação quando supabaseAdmin só aparece em comentário", () => {
    const caminho = join(dirTemporario, "so-documenta.ts");
    writeFileSync(
      caminho,
      [
        "// Este arquivo NÃO usa supabaseAdmin — só documenta por que não precisa dele aqui.",
        "/* Explicação mais longa: supabaseAdmin ignora RLS, então rota de negócio comum",
        "   nunca deveria precisar dele. */",
        "export function urlDeExemplo() {",
        // O "//" dentro da string não pode ser confundido com início de comentário de linha —
        // se fosse, o resto da linha (inclusive o "// comentário" de verdade) seria engolido
        // junto, mas o identificador não aparece em lugar nenhum deste trecho de código real.
        '  const url = "https://exemplo.com"; // comentário depois de uma URL com // dentro da string',
        "  return url;",
        "}",
      ].join("\n"),
    );

    expect(usaSupabaseAdmin(caminho)).toBe(false);
  });

  it("continua reportando violação quando supabaseAdmin é usado de verdade", () => {
    const caminho = join(dirTemporario, "usa-de-verdade.ts");
    writeFileSync(
      caminho,
      [
        "// comentário qualquer, sem relação",
        "export async function listarTudo(fastify: { supabaseAdmin: { from: (t: string) => unknown } }) {",
        '  return fastify.supabaseAdmin.from("cursos");',
        "}",
      ].join("\n"),
    );

    expect(usaSupabaseAdmin(caminho)).toBe(true);
  });
});
