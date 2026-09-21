-- Suporta os três modos de ingresso de aluno (configurável por instituição): cadastro manual
-- pelo admin, convite por email, e auto-cadastro com aprovação (fila de moderação).
--
-- ── OBSERVAÇÃO DE SEGURANÇA sobre o 0008, não muda comportamento (revisão pedida) ──────────
-- public.cursos tem a policy "cursos_select_publicado" (0008):
--   using (publicado = true)
-- sem NENHUM filtro de instituição. Policies são permissivas e combinadas por OR com as demais
-- policies de select de `cursos` — então qualquer usuário autenticado, e também o anon, lê todo
-- curso publicado de QUALQUER instituição da plataforma via RLS. Isso é necessário para a
-- página pública /i/{slug} funcionar sem login, mas a consequência não estava documentada em
-- lugar nenhum: para leitura de `cursos`, o RLS NÃO isola entre tenants. Qualquer rota que liste
-- "cursos da instituição X" (inclusive a própria /i/{slug}, que deve listar só os cursos daquela
-- instituição, não de todas) precisa filtrar por instituicao_id explicitamente no backend —
-- não dá pra confiar que o RLS já restringe isso. Registrado aqui para quem for escrever as
-- rotas de curso na Fatia 1 não presumir isolamento que não existe.

alter table public.instituicoes
  add column modo_ingresso text not null default 'manual'
    check (modo_ingresso in ('manual', 'convite', 'auto_aprovacao'));

comment on column public.instituicoes.modo_ingresso is
  'Como novos alunos entram na instituição: manual (admin cadastra direto, sem fila),
   convite (staff envia convite por email, aluno define senha ao aceitar),
   auto_aprovacao (aluno se cadastra na página pública e fica pendente até um admin aprovar).';

alter table public.usuarios
  add column status text not null default 'ativo'
    check (status in ('ativo', 'pendente', 'recusado'));

comment on column public.usuarios.status is
  'ativo: acesso normal. pendente: auto-cadastro aguardando aprovação de um admin — ainda não
   deve enxergar dados da instituição nem conteúdo de curso (ver, logo abaixo, a redefinição de
   instituicao_atual()/papel_atual() e o novo helper usuario_ativo(), usados juntos para cobrir
   tanto as policies de staff/instituicao_id quanto as policies de aluno baseadas em auth.uid()).
   recusado: moderação negou o cadastro; mantido para auditoria em vez de apagar a linha.';

-- ── usuarios pendentes de aprovação ──────────────────────────────────────
-- Índice parcial: consulta típica do painel do admin é "listar pendentes da minha instituição",
-- e a maioria das linhas está em status = 'ativo', então o índice parcial fica pequeno.
create index usuarios_pendentes_idx
  on public.usuarios (instituicao_id)
  where status = 'pendente';

-- ── status pendente/recusado não deve valer para leitura/escrita de dados da instituição ──
--
-- public.instituicao_atual() e public.papel_atual() (criadas em 0003 e 0008) são os helpers
-- usados pelas policies de STAFF e pelas que comparam instituicao_id diretamente (praticamente
-- toda policy de "admin_instituicao"/"professor" do 0008, mais qualquer select que faça
-- `instituicao_id = instituicao_atual()`). Redefinimos aqui a implementação dos dois helpers
-- (via `create or replace function`, uma migration nova; os arquivos 0003 e 0008 não são
-- tocados) para retornarem null quando o usuário não está com status = 'ativo'. Isso cobre:
-- staff pendente/recusado perde acesso de CRUD sobre cursos/módulos/aulas/matrículas/quizzes/
-- convites da própria instituição, e qualquer select gated por instituicao_atual().
--
-- IMPORTANTE — o que essa redefinição NÃO cobre: várias policies do 0008 não passam por
-- instituicao_atual()/papel_atual() nenhuma, elas chaveiam direto em auth.uid() (é assim que um
-- aluno enxerga só o próprio progresso/matrícula, sem precisar de instituicao_id ali). Essas
-- policies são completamente indiferentes à redefinição acima:
--   modulos_select_aluno_matriculado, aulas_select_aluno_matriculado (join em matriculas +
--   auth.uid()), matriculas_select_aluno_proprio, progresso_select_proprio,
--   progresso_upsert_proprio, quiz_tentativas_select_proprio, quiz_tentativas_insert_proprio.
-- Hoje isso é inofensivo porque quem está pendente ainda não tem matrícula — mas o modo
-- auto_aprovacao que esta própria migration introduz torna plausível que uma fatia futura
-- matricule o aluno no ato do auto-cadastro, antes da aprovação. Nesse cenário, um usuário
-- pendente com uma matrícula ativa continuaria lendo módulos, aulas, progresso e tentativas
-- normalmente através dessas policies, mesmo sem estar aprovado. Por isso criamos o helper
-- public.usuario_ativo() logo abaixo e damos drop/create nessas sete policies para também
-- exigi-lo, fechando o buraco de verdade (e não só documentando).
--
-- Efeito colateral que esta redefinição sozinha causaria, e que corrigimos logo abaixo com uma
-- policy nova: a policy "usuarios_select_propria_instituicao" do 0008 usa
-- `instituicao_id = instituicao_atual()`, então um usuário pendente/recusado (cujo
-- instituicao_atual() agora retorna null) deixaria de conseguir ler A PRÓPRIA linha em
-- public.usuarios. Isso não é só um detalhe de RLS: o backend passou a montar o perfil do
-- usuário autenticado com o client-com-RLS (não mais service role), fazendo
-- `select ... from usuarios where id = <uid>`. Sem conseguir ler a própria linha, esse select
-- volta vazio, o backend interpreta como "usuário sem perfil na plataforma", responde 401 e
-- limpa a sessão — no modo auto_aprovacao (que esta migration introduz), a pessoa se cadastra,
-- loga, e é imediatamente deslogada com uma mensagem enganosa, sem nunca ver uma tela de
-- "cadastro enviado, aguarde aprovação".
create or replace function public.instituicao_atual()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select instituicao_id from public.usuarios where id = auth.uid() and status = 'ativo'
$$;

create or replace function public.papel_atual()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select papel from public.usuarios where id = auth.uid() and status = 'ativo'
$$;

-- Helper para as policies do 0008 que chaveiam só em auth.uid() (aluno vendo o próprio
-- progresso/matrícula/tentativa), sem passar por instituicao_atual()/papel_atual(). Mesmo
-- padrão das duas functions acima: security definer + search_path fixo + stable.
create or replace function public.usuario_ativo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.usuarios where id = auth.uid() and status = 'ativo'
  )
$$;

-- ── usuarios: garante que o próprio usuário sempre consegue ler a própria linha ─────────────
-- Deliberadamente indiferente a status — não usa instituicao_atual()/papel_atual()/
-- usuario_ativo(), só `id = auth.uid()`. É isso que permite ao backend distinguir dois casos
-- que exigem respostas diferentes ao usuário logo após o login:
--   (a) select não retorna nada -> não existe linha em public.usuarios para esse auth.uid()
--       (perfil nunca foi criado / onboarding incompleto);
--   (b) select retorna a linha com status = 'pendente' -> perfil existe, mas está na fila de
--       auto_aprovacao; o backend deve responder algo como "cadastro enviado, aguarde
--       aprovação", não um 401 genérico que derruba a sessão.
-- Sem essa policy, um usuário pendente cairia sempre no caso (a) mesmo tendo perfil — o backend
-- não teria como distinguir "não existe" de "existe mas pendente".
-- Convive sem afrouxar nada com "usuarios_select_propria_instituicao" (0008): policies são
-- permissivas e combinadas por OR, e esta aqui já restringe a leitura à própria linha
-- (id = auth.uid()), então nenhum usuário passa a enxergar linha de terceiro.
create policy "usuarios_select_propria_linha"
  on public.usuarios for select
  using (id = auth.uid());

-- ── fecha o buraco: policies do 0008 baseadas só em auth.uid() também exigem usuário ativo ──
-- Recriação via drop/create nesta migration nova (0008 não é editado). Mantém exatamente a
-- mesma condição de negócio de cada policy original, só adicionando `usuario_ativo()`.

drop policy "modulos_select_aluno_matriculado" on public.modulos;
create policy "modulos_select_aluno_matriculado"
  on public.modulos for select
  using (
    public.usuario_ativo()
    and exists (
      select 1 from public.matriculas
      where matriculas.curso_id = modulos.curso_id
        and matriculas.aluno_id = auth.uid()
        and matriculas.status = 'ativa'
    )
  );

drop policy "aulas_select_aluno_matriculado" on public.aulas;
create policy "aulas_select_aluno_matriculado"
  on public.aulas for select
  using (
    public.usuario_ativo()
    and exists (
      select 1 from public.modulos
      join public.matriculas on matriculas.curso_id = modulos.curso_id
      where modulos.id = aulas.modulo_id
        and matriculas.aluno_id = auth.uid()
        and matriculas.status = 'ativa'
    )
  );

drop policy "matriculas_select_aluno_proprio" on public.matriculas;
create policy "matriculas_select_aluno_proprio"
  on public.matriculas for select
  using (public.usuario_ativo() and aluno_id = auth.uid());

drop policy "progresso_select_proprio" on public.progresso_aulas;
create policy "progresso_select_proprio"
  on public.progresso_aulas for select
  using (
    public.usuario_ativo()
    and exists (
      select 1 from public.matriculas
      where matriculas.id = progresso_aulas.matricula_id
        and matriculas.aluno_id = auth.uid()
    )
  );

drop policy "progresso_upsert_proprio" on public.progresso_aulas;
create policy "progresso_upsert_proprio"
  on public.progresso_aulas for all
  using (
    public.usuario_ativo()
    and exists (
      select 1 from public.matriculas
      where matriculas.id = progresso_aulas.matricula_id
        and matriculas.aluno_id = auth.uid()
    )
  )
  with check (
    public.usuario_ativo()
    and exists (
      select 1 from public.matriculas
      where matriculas.id = progresso_aulas.matricula_id
        and matriculas.aluno_id = auth.uid()
    )
  );

drop policy "quiz_tentativas_select_proprio" on public.quiz_tentativas;
create policy "quiz_tentativas_select_proprio"
  on public.quiz_tentativas for select
  using (public.usuario_ativo() and aluno_id = auth.uid());

drop policy "quiz_tentativas_insert_proprio" on public.quiz_tentativas;
create policy "quiz_tentativas_insert_proprio"
  on public.quiz_tentativas for insert
  with check (public.usuario_ativo() and aluno_id = auth.uid());

-- ── convites ─────────────────────────────────────────────────────────────
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

comment on table public.convites is
  'Convite de ingresso (modo_ingresso = convite). Ciclo de vida: staff cria -> email enviado com
   link contendo o token -> convidado abre o link e define senha -> backend efetiva o aceite.';
comment on column public.convites.token is
  'Identificador opaco e não sequencial (gerado pelo backend, ex.: crypto.randomBytes) usado no
   link de convite enviado por email. É o "segredo" do fluxo: quem tem o token pode aceitar.';
comment on column public.convites.criado_por is
  'Staff (admin_instituicao ou professor) que emitiu o convite. Null não deve acontecer em
   condições normais (sempre há um staff autenticado criando), mas a FK não é not null porque
   o backend usa service role e a coluna existe primariamente para auditoria/exibição.';
comment on column public.convites.expira_em is
  'Definido pelo backend na criação (ex.: now() + 7 dias). Convite expirado não pode mais ser
   aceito; a checagem é feita no backend, que é quem processa o aceite (ver nota abaixo).';
comment on column public.convites.aceito_em is
  'Null enquanto pendente. Setado pelo backend no momento do aceite; um convite já aceito não
   pode ser aceito de novo (o backend deve checar isso antes de efetivar).';

-- Índice parcial: cobre tanto "listar convites pendentes da instituição" (prefixo
-- instituicao_id) quanto "já existe convite pendente para esse email nessa instituição?"
-- (usado pra evitar reenvio duplicado). Convites já aceitos saem do índice, mantendo-o pequeno.
create index convites_pendentes_idx
  on public.convites (instituicao_id, email)
  where aceito_em is null;

-- A busca de convite por token na tela de aceite já é coberta pelo índice único da coluna
-- `token` (unique implica índice btree automático) — não precisa de índice adicional.

alter table public.convites enable row level security;

-- Quem pode criar/ver/revogar convite: staff (admin_instituicao ou professor) da própria
-- instituição, igual ao padrão de cursos/matriculas no 0008.
create policy "convites_crud_staff"
  on public.convites for all
  using (
    instituicao_id = public.instituicao_atual()
    and public.papel_atual() in ('admin_instituicao', 'professor')
  )
  with check (
    instituicao_id = public.instituicao_atual()
    and public.papel_atual() in ('admin_instituicao', 'professor')
  );

-- Sem policy de select/update para o convidado: no momento em que ele abre o link do convite,
-- ele ainda não está autenticado (não tem sessão Supabase) ou acabou de ser criado e ainda não
-- tem linha em public.usuarios (a linha só é criada como parte do próprio aceite). Não existe
-- "auth.uid() do convidado" para uma policy usar nesse instante. Por isso o fluxo de aceite —
-- validar token, checar expiração/aceito_em, criar o usuário no Supabase Auth (ou reaproveitar,
-- se já existir), criar a linha em public.usuarios com status='ativo' e marcar aceito_em — é
-- feito inteiramente pelo backend Fastify com a service role key, que ignora RLS. Isso é
-- intencional e coerente com o resto do projeto (onboarding de instituição já funciona assim).
