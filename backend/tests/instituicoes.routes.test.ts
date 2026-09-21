// Prova de que o onboarding (`POST /api/instituicoes/onboarding`) devolve exatamente o mesmo
// formato de perfil que `/api/auth/me` para o mesmo usuário — as duas rotas compartilham
// `montarRespostaPerfil` (routes/auth.ts). Sem este teste, o onboarding poderia voltar a montar
// a resposta na mão (como fazia antes desta correção, sem o campo `instituicao`) sem que nada
// acusasse a divergência: seria a terceira cópia do mesmo formato, depois da que já existiu
// entre login e /me.
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import authPlugin from "../src/plugins/auth.js";
import authRoutes from "../src/routes/auth.js";
import instituicoesRoutes from "../src/routes/instituicoes.js";
import { COOKIE_ACCESS } from "../src/lib/sessao.js";

interface Resultado {
  data: unknown;
  error: unknown;
}

/** Query builder fake e encadeável: select/eq/insert/update/delete devolvem o próprio builder;
 * `single()` e a resolução direta (`then`) devolvem sempre o mesmo `resultado` configurado. */
function criarBuilder(resultado: Resultado) {
  const builder: Record<string, unknown> = {};
  const encadeavel = () => vi.fn(() => builder);
  builder.select = encadeavel();
  builder.eq = encadeavel();
  builder.insert = encadeavel();
  builder.update = encadeavel();
  builder.delete = encadeavel();
  builder.single = vi.fn(() => Promise.resolve(resultado));
  builder.then = (resolve: (v: Resultado) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(resultado).then(resolve, reject);
  return builder;
}

const INSTITUICAO_CRIADA = { id: "inst-1" };
const USUARIO_AUTH_CRIADO = { id: "user-1" };
const INSTITUICAO_COMPLETA = {
  id: "inst-1",
  nome: "Escola Onboarding",
  slug: "escola-onboarding",
  logo_url: "https://cdn.exemplo.com/logo.png",
  cor_primaria: "#ff0000",
};
const PERFIL_USUARIO = {
  id: "user-1",
  instituicao_id: "inst-1",
  papel: "admin_instituicao",
  nome: "Admin Onboarding",
  status: "ativo",
};

function criarApp() {
  const createUser = vi.fn().mockResolvedValue({ data: { user: USUARIO_AUTH_CRIADO }, error: null });
  const deleteUser = vi.fn().mockResolvedValue({ error: null });
  const signInWithPassword = vi.fn().mockResolvedValue({
    data: {
      session: {
        access_token: "token-onboarding",
        refresh_token: "refresh-onboarding",
        user: { id: "user-1" },
      },
    },
    error: null,
  });
  const getClaims = vi.fn().mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null });
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  const refreshSession = vi.fn();

  // `supabaseAdmin.from("instituicoes")` é chamado duas vezes no fluxo feliz: 1) o insert que
  // cria a instituição, 2) a leitura dentro de montarRespostaPerfil. Cada chamada devolve um
  // builder novo com o resultado certo para aquela etapa — daí o contador.
  let chamadasInstituicoesAdmin = 0;
  const fromAdmin = vi.fn((tabela: string) => {
    if (tabela === "instituicoes") {
      chamadasInstituicoesAdmin += 1;
      return chamadasInstituicoesAdmin === 1
        ? criarBuilder({ data: INSTITUICAO_CRIADA, error: null })
        : criarBuilder({ data: INSTITUICAO_COMPLETA, error: null });
    }
    if (tabela === "usuarios") {
      // Awaited direto após `.insert(...)`, sem `.select()/.single()` — ver routes/instituicoes.ts.
      return criarBuilder({ data: null, error: null });
    }
    throw new Error(`tabela não mockada em supabaseAdmin: ${tabela}`);
  });

  // Client usado por /api/auth/me: precisa devolver o MESMO perfil e a MESMA instituição que o
  // onboarding gravou/leu, para a comparação entre as duas respostas fazer sentido.
  const comoUsuario = vi.fn(() => ({
    from: (tabela: string) =>
      tabela === "usuarios"
        ? criarBuilder({ data: PERFIL_USUARIO, error: null })
        : criarBuilder({ data: INSTITUICAO_COMPLETA, error: null }),
  }));

  const app = Fastify();
  app.register(cookie);
  app.register(
    fp(async (fastify) => {
      fastify.decorate("supabaseAdmin", {
        from: fromAdmin,
        auth: { admin: { createUser, deleteUser } },
      } as never);
      fastify.decorate("supabaseAuth", { auth: { signInWithPassword, getClaims, getUser, refreshSession } } as never);
      fastify.decorate("supabaseComoUsuario", comoUsuario as never);
    }),
  );
  app.register(authPlugin);
  app.register(authRoutes);
  app.register(instituicoesRoutes);

  return { app };
}

describe("onboarding e /me para o mesmo usuário", () => {
  it("resposta do onboarding tem o mesmo formato (com instituicao) da resposta de /me", async () => {
    const { app } = criarApp();

    const respostaOnboarding = await app.inject({
      method: "POST",
      url: "/api/instituicoes/onboarding",
      payload: {
        nomeInstituicao: "Escola Onboarding",
        slug: "escola-onboarding",
        nomeAdmin: "Admin Onboarding",
        email: "admin@escola-onboarding.com",
        senha: "123456",
      },
    });

    expect(respostaOnboarding.statusCode).toBe(201);
    expect(respostaOnboarding.json()).toEqual({
      id: "user-1",
      nome: "Admin Onboarding",
      papel: "admin_instituicao",
      instituicaoId: "inst-1",
      instituicao: {
        id: "inst-1",
        nome: "Escola Onboarding",
        slug: "escola-onboarding",
        logoUrl: "https://cdn.exemplo.com/logo.png",
        corPrimaria: "#ff0000",
      },
    });

    // Reusa o cookie que o próprio onboarding setou (login automático) para chamar /me — se as
    // duas rotas realmente compartilham montarRespostaPerfil, a resposta é idêntica byte a byte.
    const cookiesOnboarding = Object.fromEntries(respostaOnboarding.cookies.map((c) => [c.name, c.value]));
    expect(Object.keys(cookiesOnboarding)).toContain(COOKIE_ACCESS);

    const respostaMe = await app.inject({ method: "GET", url: "/api/auth/me", cookies: cookiesOnboarding });

    expect(respostaMe.statusCode).toBe(200);
    expect(respostaMe.json()).toEqual(respostaOnboarding.json());
  });
});
