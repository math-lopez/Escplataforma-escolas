# Plataforma Escolas

SaaS multi-tenant **white-label** para instituições de ensino e professores treinarem alunos: cada instituição cria conta, monta sua página de cursos e cadastra seus próprios alunos. Projeto em fase de **validação (MVP)** — priorize soluções simples e enxutas sobre generalidade.

## Stack

- **Frontend**: React + Vite + TypeScript (`frontend/`)
- **Backend**: Node.js + Fastify + TypeScript (`backend/`)
- **Banco/Auth**: Supabase (Postgres + Supabase Auth)

**Nunca usar ORM que gere schema automaticamente** (Prisma, TypeORM sync, etc). Todo schema do banco vive em `supabase/migrations/` como SQL puro, versionado e aplicado manualmente pelo usuário no projeto Supabase (via SQL editor ou `supabase db push`).

## Estrutura

```
frontend/src/
  lib/          # api.ts — ÚNICO ponto de saída do front (fetch para o backend)
  routes/       # páginas
  components/   # componentes de UI
  features/     # lógica de domínio (auth/, cursos/, aulas/, matriculas/...)
backend/src/
  lib/          # sessao.ts (cookies httpOnly)
  plugins/      # supabase.ts (clients admin, auth e comoUsuario), auth.ts (sessão/refresh/papéis)
  routes/       # endpoints Fastify
  services/     # lógica de negócio
supabase/migrations/   # SQL sequencial, numerado (0001_, 0002_...)
```

## Convenções

- Nomes de tabela/coluna no banco em **português**, `snake_case`.
- **Toda tabela nova precisa de RLS habilitado + policy antes de mergear.** Isolamento multi-tenant é feito por `instituicao_id` (direto ou via join até a tabela pai) comparado com `public.instituicao_atual()` — ver `supabase/migrations/0008_rls_policies.sql` para o padrão.
- Migrations são **imutáveis depois de aplicadas** em qualquer ambiente compartilhado. Correção de uma migration já rodada vira uma **nova migration**, nunca edite uma antiga.
- `public.papel_atual()` e `public.instituicao_atual()` (definidas nas migrations) são os helpers usados dentro das policies de RLS — ficam no schema `public`, não `auth`, porque o role usado nas migrations não tem permissão de `CREATE` no schema `auth` (reservado ao Supabase).

## Regra de ouro: o frontend só fala com o backend

**O frontend nunca conhece o Supabase.** Não existe `@supabase/supabase-js` em `frontend/`, nenhuma chave do Supabase em `frontend/.env`, nenhuma query direta ao banco. Toda comunicação passa por `frontend/src/lib/api.ts` → backend Fastify. Se uma feature nova parecer precisar do Supabase no front, a resposta é criar um endpoint no backend.

O backend abstrai tudo que é infraestrutura (banco, auth, storage), o que mantém a liberdade de trocar o Supabase depois sem tocar no frontend.

## Contrato de autenticação

- **Sessão em cookie httpOnly**, emitida pelo backend (`backend/src/lib/sessao.ts`). O token nunca é exposto ao JavaScript do frontend — não há token em `localStorage` nem header `Authorization`. O front só usa `credentials: "include"` (já embutido no `api.ts`).
- **Validação de token é local** (`backend/src/plugins/auth.ts`, função `idDoToken`): usamos `getClaims(token)` para extrair o `sub` (id do usuário) das claims JWT, com JWKS cacheado — isso é **0–1ms por requisição** contra 147–381ms de uma ida de rede a `getUser()`. O trade-off: um token revogado é aceito até expirar (tempo de vida típico: 1h), mitigado pelo reload do perfil a cada requisição, que detecta usuário apagado ou desativado no mesmo instante.
- **Endpoints de auth** (`backend/src/routes/auth.ts`): `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`. O backend chama o Supabase Auth internamente com a anon key.
- **Onboarding de instituição**: `POST /api/instituicoes/onboarding` cria instituição + usuário admin (service role via Admin API) e já devolve o usuário autenticado, com o cookie setado.
- **Refresh transparente**: o plugin `backend/src/plugins/auth.ts` renova a sessão automaticamente pelo refresh token quando o access token expira. O frontend não sabe que isso existe.
- **Autorização nas rotas**: `fastify.autenticar` (exige sessão) e `fastify.exigirPapel('professor', 'admin_instituicao')` como `onRequest`. Ambos populam `request.usuario = { id, instituicaoId, papel, nome, status }` e `request.accessToken` (o access token válido da requisição — o do cookie, ou o novo emitido caso tenha havido refresh).
- **Usuário pendente/recusado** (`usuarios.status`, migration 0009): `fastify.autorizarPerfil` é o ponto único que decide isso — usado tanto por `autenticar` quanto pelo login, para as duas rotas nunca divergirem na mesma regra. Sem perfil na tabela `usuarios` → 401. Perfil existe mas `status != 'ativo'` → **403** (não 401) com `{ erro, codigo: "cadastro_pendente" | "cadastro_recusado", nome }`, **sem limpar os cookies**: a sessão é legítima, falta é aprovação, e a mesma sessão deve passar a funcionar sozinha quando um admin aprovar — deslogar forçaria login de novo à toa.
- **Qual client Supabase usar (`backend/src/plugins/supabase.ts`)**: toda rota de negócio usa `fastify.supabaseComoUsuario(request.accessToken)` — anon key + token do usuário, o que faz o **RLS voltar a valer** como linha de defesa real, não só teórica. `fastify.supabaseAdmin` (service role, ignora RLS) fica restrito a onboarding, criação de usuário e operações que legitimamente cruzam instituições; um guard em `backend/tests/` falha o build se alguma rota fora dessa allowlist usar `supabaseAdmin`. `fastify.supabaseAuth` é só para as próprias operações de auth (login, refresh).
- **Isolamento multi-tenant tem duas camadas**: o filtro manual por `request.usuario.instituicaoId` em toda query (nunca aceitar `instituicao_id` vindo do corpo/query da requisição) **e** o RLS, ativo de verdade porque as rotas usam `supabaseComoUsuario`. Um esquecimento no filtro manual não vaza dado entre tenants — o RLS barra na mesma hora.
- No frontend, a sessão é consumida via `useSessao()` (`frontend/src/features/auth/`), que consulta `GET /api/auth/me` — única forma de saber se há sessão, já que o cookie é httpOnly.

## Como rodar em dev

1. `backend/.env` (a partir do `.env.example`): todas as chaves do Supabase ficam **só aqui** — URL, anon key, service role key e JWT secret, do dashboard em *Project Settings > API*. `frontend/.env` tem apenas `VITE_API_URL`.
2. Aplicar as migrations de `supabase/migrations/` em ordem, no SQL editor do Supabase (ou `supabase db push` se usar a CLI).
3. `npm install` na raiz (instala frontend e backend via workspaces).
4. `npm run dev:frontend` (porta 5173) e `npm run dev:backend` (porta 3333) em terminais separados.

## Escopo do MVP — o que NÃO está incluído ainda

Não implementar as itens abaixo sem alinhar antes — são fase 2, fora do MVP atual:
- Aulas ao vivo com integração real de videoconferência (Zoom/Meet) — no MVP é só um link externo
- Certificado com design customizável por instituição — MVP é texto simples + código de validação
- Pagamentos/cobrança
- Subdomínio real por instituição (DNS/certificado) — MVP usa path `/i/{slug}`
- Branding avançado (CSS customizado por instituição) — MVP é só logo + cor primária
- Um usuário pertencer a mais de uma instituição
- Notificações automatizadas além do convite básico do Supabase Auth
- Dashboard de analytics/engajamento para o professor
- Fórum/discussão entre alunos

## Plano completo

O plano de arquitetura detalhado (modelagem de dados completa, decisões e roadmap incremental) está em `C:\Users\Matheus\.claude\plans\starry-mapping-wilkes.md`.
