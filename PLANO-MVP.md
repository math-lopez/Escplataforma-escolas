# Plano de execução — fechamento do MVP

Continuação do plano de fundação (`~/.claude/plans/starry-mapping-wilkes.md`, passos 1–11, concluídos).
Este documento cobre os passos 12–16 e as decisões tomadas na sessão de planejamento.

---

## 1. Onde estamos

**Pronto:**
- Migrations 0001–0008: schema completo do MVP + RLS.
- Onboarding de instituição (`POST /api/instituicoes/onboarding`).
- Login/sessão via cookie httpOnly (`sb_access` / `sb_refresh`), com refresh transparente.
- Validação de token via `supabase.auth.getUser()` — sem `SUPABASE_JWT_SECRET`.

**Marco zero:**
- Todo o produto. 3 telas sem estilo nenhum (Home, Login, CadastroInstituicao).
- Nenhuma rota de negócio no backend além do onboarding.

O banco está pronto para o MVP inteiro; o app não começou. A parte cara (modelagem + isolamento
multi-tenant) já passou.

---

## 2. Decisões fechadas

| Tema | Decisão |
|---|---|
| **Entrada do aluno** | Os três modos, configurável por instituição: admin cadastra, convite por email, auto-cadastro com aprovação |
| **Vídeo** | Bunny Stream (encoding, HLS adaptativo, player e token auth inclusos) |
| **Arquivos** | Supabase Storage para PDF, logo e capa de curso |
| **Quiz e certificado** | Dentro do MVP |
| **Design** | `DESIGN.md` (IDS formato `@google/design.md`) como base |
| **White-label** | Telas anônimas usam o DESIGN.md; depois do login, a `cor_primaria` da instituição manda |
| **Deploy** | Vercel (front + back) inicialmente; back migra para Railway ao estabilizar |
| **Estreia** | O próprio autor usa primeiro → prioridade é o painel do professor e o editor de curso |

### Por que Bunny Stream

O custo de vídeo é **banda, não armazenamento**. Uma aula de 30min em 720p ≈ 300MB; um curso de
20 aulas ≈ 6GB; um aluno que assiste tudo consome 6GB de banda.

Cenário: curso de 20 aulas, turma de 30 alunos assistindo tudo no mês (180GB/instituição).

| | 1 instituição | 5 instituições | 20 instituições |
|---|---|---|---|
| Supabase Pro | $25 | $83 | $327 |
| Bunny Stream | $1 (mínimo) | ~$5 | ~$19 |
| Cloudflare R2 | $0 | ~$0,30 | ~$1,65 |

Supabase Pro inclui 250GB de egress = **~41 alunos concluindo um curso por mês**; o excedente é
$0,09/GB, o mais caro da tabela. R2 é estruturalmente o mais barato (egress zero) mas não tem
encoding, streaming adaptativo nem player. Bunny custa poucos dólares a mais que o R2 e entrega o
pipeline de vídeo pronto — no volume do MVP, é barato demais para recusar.

**Atenção operacional:** configurar a rede **Volume** ($0,005/GB). A rede Standard na zona South
America é $0,045/GB — 9x mais cara.

---

## 3. Débitos técnicos (Fatia 0, antes de qualquer feature)

### 3.1 CLAUDE.md está desatualizado
Descreve o frontend falando direto com Supabase Auth e fazendo leituras confiando em RLS. A
realidade mudou: o frontend **não tem `@supabase/supabase-js`**; tudo passa pelo backend via cookie
httpOnly. Atualizar a seção "Contrato de autenticação".

### 3.2 O RLS deixou de proteger o caminho principal
O backend usa service role em todas as queries, o que **ignora RLS**. Hoje o isolamento entre
instituições depende inteiramente de lembrar do `.eq("instituicao_id", ...)` em cada query. Um
esquecimento vaza dados entre tenants silenciosamente — o pior cenário possível neste produto.

**Correção:** adicionar ao plugin Supabase um client por request que usa a anon key + o access token
do usuário, fazendo o RLS voltar a valer:

```ts
// backend/src/plugins/supabase.ts
fastify.decorate("supabaseComoUsuario", (accessToken: string) =>
  createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  }),
);
```

Regra: **toda rota de negócio usa `supabaseComoUsuario`**. `supabaseAdmin` (service role) fica
restrito a onboarding, criação de usuário e operações administrativas que precisam cruzar tenants.
O filtro manual por `instituicao_id` continua — mas passa a ser a segunda linha, não a única.

### 3.3 Cookie cross-site quebra em produção
`sessao.ts` usa `sameSite: "lax"`, que **não envia o cookie cross-site**. Front em um domínio e back
em outro = login funciona local e falha em produção.

**Correção:** servir os dois sob o mesmo domínio via rewrite da Vercel (`/api/*` → backend),
mantendo `lax`. Alternativa pior: `sameSite: "none"` + `secure: true`, que exige HTTPS e é mais
exposto a CSRF.

### 3.4 Limite de payload da Vercel
Serverless na Vercel limita o corpo da requisição a ~4,5MB. **Nenhum upload pode passar pelo
backend** — nem vídeo, nem PDF grande. Todo upload vai do browser direto para o destino via URL
assinada gerada pelo backend:
- Vídeo → Bunny (upload TUS resumável)
- PDF / logo / capa → Supabase Storage (signed upload URL)

---

## 4. Novas migrations

Migrations existentes são **imutáveis**. Tudo abaixo entra como migration nova.

### `0009_ingresso_alunos.sql`
```sql
alter table public.instituicoes
  add column modo_ingresso text not null default 'manual'
    check (modo_ingresso in ('manual', 'convite', 'auto_aprovacao'));

alter table public.usuarios
  add column status text not null default 'ativo'
    check (status in ('ativo', 'pendente', 'recusado'));

create table public.convites (
  id uuid primary key default gen_random_uuid(),
  instituicao_id uuid not null references public.instituicoes (id) on delete cascade,
  email text not null,
  papel text not null check (papel in ('admin_instituicao', 'professor', 'aluno')),
  token text not null unique,
  criado_por uuid references public.usuarios (id),
  expira_em timestamptz not null,
  aceito_em timestamptz,
  criado_em timestamptz not null default now()
);
```
Mais índices e policies de RLS no mesmo padrão do `0008`.

### `0010_video_externo.sql`
```sql
alter table public.aulas
  add column video_externo_id text,
  add column video_status text check (video_status in ('processando', 'pronto', 'erro'));
```
`conteudo_url` continua servindo para PDF e link externo.

### `0011_storage_buckets.sql`
Buckets do Supabase Storage (`materiais`, `branding`) + policies de acesso por instituição.

> Toda tabela nova precisa de RLS habilitado + policy antes de mergear.

---

## 5. Fatias de execução

Ordem otimizada para o cenário de estreia: **você monta um curso de verdade o quanto antes**.

### Fatia 0 — Fundação de UI + débitos
- Tailwind v4; tokens do `DESIGN.md` como CSS variables em `index.css`
- Fonte **Montserrat** (Optimistic VF é proprietária da Meta — ver §6.1)
- Componentes base: `Botao`, `Campo`, `Card`, `Badge`, `Modal`, `Toast`, `Abas`
- Shell autenticado: sidebar + topbar, rota protegida por papel
- Tema por instituição: `--cor-primaria` sobrescrita em runtime após o login
- Débitos 3.1 a 3.4

### Fatia 1 — Painel do professor: cursos
- `GET/POST/PATCH/DELETE /api/cursos`
- Listagem, criação, edição, publicar/despublicar
- Upload de capa → Supabase Storage via URL assinada

### Fatia 2 — Editor de conteúdo
- Módulos: criar, renomear, reordenar, excluir
- Aulas: tipos `video`, `texto`, `pdf`, `ao_vivo`; ordenação
- Integração Bunny: criar vídeo, URL de upload assinada, webhook de status de encoding
- Upload de PDF → Supabase Storage
- **Marco: você consegue montar um curso completo aqui.**

### Fatia 3 — Alunos e ingresso
- Migration `0009`
- Modo *manual*: admin cadastra, senha provisória exibida na tela
- Modo *convite*: envio por email (requer Resend — ver §6.3)
- Modo *auto_aprovacao*: cadastro pela página pública + fila de moderação
- Tela de gestão de alunos: listar, aprovar, recusar, matricular

### Fatia 4 — Área do aluno
- "Meus cursos", navegação módulo/aula
- Player Bunny com token de acesso, colorido com a `cor_primaria`
- Marcar aula concluída, barra de progresso do curso
- Branding da instituição aplicado em toda a área logada

### Fatia 5 — Quiz
- Professor: montar quiz, perguntas, alternativas, nota mínima
- Aluno: responder e submeter
- **Correção sempre no backend** — as alternativas corretas nunca chegam ao client

### Fatia 6 — Certificado e página pública
- Emissão automática ao concluir o curso (e passar no quiz, quando houver)
- `/validar/{codigo}` público
- `/i/{slug}`: cursos publicados, logo e cor da instituição, sem login

### Fatia 7 — Deploy e revisão
- Vercel com rewrite `/api/*` → backend
- `security-review` focado em vazamento entre instituições
- Migração do backend para Railway quando estabilizar

---

## 6. Riscos e armadilhas conhecidas

### 6.1 A fonte do DESIGN.md não existe publicamente
Optimistic VF é proprietária da Meta. O próprio `DESIGN.md` lista o fallback: Montserrat, Helvetica,
Arial, Noto Sans. Usamos **Montserrat** e não aplicamos `ss01`/`ss02` (não existem nela). Desvio
consciente e documentado do IDS.

### 6.2 Cor arbitrária da instituição quebra contraste
Se a instituição escolher amarelo claro, texto branco em cima fica ilegível. Precisamos de uma
função que escolhe a cor do texto por luminância da cor de fundo, e de um piso de contraste ao
aplicar `cor_primaria` como fundo de botão.

### 6.3 Convite por email depende de SMTP próprio
O SMTP default do Supabase limita a poucos emails por hora e não é para produção. A Fatia 3 depende
de configurar **Resend** (free: 3.000 emails/mês, 100/dia) + domínio verificado. Se o domínio não
estiver pronto, os modos *manual* e *auto_aprovacao* funcionam sem essa dependência.

### 6.4 O DESIGN.md é de e-commerce, não de LMS
Os tokens (cor, tipografia, spacing, radius) e os componentes de base (botão, card, input, badge)
mapeiam bem. Os componentes de commerce (`product-gallery-pdp`, `card-checkout-summary`,
`color-sku-picker-row`, `color-swatch-circle`) não têm equivalente aqui — ignorar, não forçar.
Faltam no IDS e precisaremos criar: navegação lateral, tabela de dados, barra de progresso,
estado vazio, player de vídeo.

### 6.5 Cobalto vs. cor da instituição
Pela decisão de white-label, `{colors.primary}` (#0064E0) vale só nas telas anônimas. Depois do
login ele é substituído pela `cor_primaria`. Isso contraria o "Do" do DESIGN.md de reservar o
cobalto para CTAs de compra — desvio intencional, o produto não tem fluxo de compra.

---

## 7. Fora de escopo (reafirmado)

Sem alinhamento prévio, não implementar: videoconferência real, certificado com design customizável,
pagamentos, subdomínio real por instituição, CSS customizado por instituição, usuário em múltiplas
instituições, notificações além do convite, dashboard de analytics, fórum.
