-- Habilita RLS e define as policies de isolamento multi-tenant.
-- Regra geral: toda tabela de negócio só é visível/editável dentro da própria instituição.
--
-- IMPORTANTE: nesta arquitetura o frontend NUNCA acessa o Supabase diretamente — todo acesso
-- passa pelo backend Fastify, que usa a service role key e portanto ignora estas policies.
-- O RLS aqui é DEFESA EM PROFUNDIDADE: protege os dados caso a service role key vaze, caso
-- alguém se conecte direto ao banco, ou caso um dia algum cliente passe a usar a anon key.
-- O isolamento que realmente vale no dia a dia é o filtro por request.usuario.instituicaoId
-- feito no backend (ver CLAUDE.md).

-- Fica em public pelo mesmo motivo de public.instituicao_atual() (migration 0003):
-- o schema auth é do Supabase e não aceita CREATE de roles normais.
create or replace function public.papel_atual()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select papel from public.usuarios where id = auth.uid()
$$;

-- ── instituicoes ─────────────────────────────────────────────────────────
-- Não guarda dado sensível (só branding público), por isso leitura é liberada
-- para qualquer um (inclusive anon) — necessário para a página pública /i/{slug}.
alter table public.instituicoes enable row level security;

create policy "instituicoes_select_publico"
  on public.instituicoes for select
  using (true);

create policy "instituicoes_update_admin"
  on public.instituicoes for update
  using (id = public.instituicao_atual() and public.papel_atual() = 'admin_instituicao');

-- ── usuarios ─────────────────────────────────────────────────────────────
alter table public.usuarios enable row level security;

create policy "usuarios_select_propria_instituicao"
  on public.usuarios for select
  using (instituicao_id = public.instituicao_atual());

-- Inserção/atualização de usuarios é feita pelo backend com service role (onboarding,
-- cadastro de aluno), que ignora RLS — por isso não há policy de insert/update aqui.

-- ── cursos ───────────────────────────────────────────────────────────────
alter table public.cursos enable row level security;

create policy "cursos_select_staff_propria_instituicao"
  on public.cursos for select
  using (
    instituicao_id = public.instituicao_atual()
    and public.papel_atual() in ('admin_instituicao', 'professor')
  );

create policy "cursos_select_publicado"
  on public.cursos for select
  using (publicado = true);

create policy "cursos_insert_staff"
  on public.cursos for insert
  with check (
    instituicao_id = public.instituicao_atual()
    and public.papel_atual() in ('admin_instituicao', 'professor')
  );

create policy "cursos_update_staff"
  on public.cursos for update
  using (
    instituicao_id = public.instituicao_atual()
    and public.papel_atual() in ('admin_instituicao', 'professor')
  );

create policy "cursos_delete_staff"
  on public.cursos for delete
  using (
    instituicao_id = public.instituicao_atual()
    and public.papel_atual() in ('admin_instituicao', 'professor')
  );

-- ── modulos ──────────────────────────────────────────────────────────────
-- Conteúdo do curso (módulos/aulas) fica atrás da matrícula: só staff da instituição
-- ou aluno efetivamente matriculado no curso pode ver, mesmo que o curso esteja publicado.
alter table public.modulos enable row level security;

create policy "modulos_select_staff"
  on public.modulos for select
  using (
    exists (
      select 1 from public.cursos
      where cursos.id = modulos.curso_id
        and cursos.instituicao_id = public.instituicao_atual()
        and public.papel_atual() in ('admin_instituicao', 'professor')
    )
  );

create policy "modulos_select_aluno_matriculado"
  on public.modulos for select
  using (
    exists (
      select 1 from public.matriculas
      where matriculas.curso_id = modulos.curso_id
        and matriculas.aluno_id = auth.uid()
        and matriculas.status = 'ativa'
    )
  );

create policy "modulos_crud_staff"
  on public.modulos for all
  using (
    exists (
      select 1 from public.cursos
      where cursos.id = modulos.curso_id
        and cursos.instituicao_id = public.instituicao_atual()
        and public.papel_atual() in ('admin_instituicao', 'professor')
    )
  )
  with check (
    exists (
      select 1 from public.cursos
      where cursos.id = modulos.curso_id
        and cursos.instituicao_id = public.instituicao_atual()
        and public.papel_atual() in ('admin_instituicao', 'professor')
    )
  );

-- ── aulas ────────────────────────────────────────────────────────────────
alter table public.aulas enable row level security;

create policy "aulas_select_staff"
  on public.aulas for select
  using (
    exists (
      select 1 from public.modulos
      join public.cursos on cursos.id = modulos.curso_id
      where modulos.id = aulas.modulo_id
        and cursos.instituicao_id = public.instituicao_atual()
        and public.papel_atual() in ('admin_instituicao', 'professor')
    )
  );

create policy "aulas_select_aluno_matriculado"
  on public.aulas for select
  using (
    exists (
      select 1 from public.modulos
      join public.matriculas on matriculas.curso_id = modulos.curso_id
      where modulos.id = aulas.modulo_id
        and matriculas.aluno_id = auth.uid()
        and matriculas.status = 'ativa'
    )
  );

create policy "aulas_crud_staff"
  on public.aulas for all
  using (
    exists (
      select 1 from public.modulos
      join public.cursos on cursos.id = modulos.curso_id
      where modulos.id = aulas.modulo_id
        and cursos.instituicao_id = public.instituicao_atual()
        and public.papel_atual() in ('admin_instituicao', 'professor')
    )
  )
  with check (
    exists (
      select 1 from public.modulos
      join public.cursos on cursos.id = modulos.curso_id
      where modulos.id = aulas.modulo_id
        and cursos.instituicao_id = public.instituicao_atual()
        and public.papel_atual() in ('admin_instituicao', 'professor')
    )
  );

-- ── matriculas ───────────────────────────────────────────────────────────
alter table public.matriculas enable row level security;

create policy "matriculas_select_aluno_proprio"
  on public.matriculas for select
  using (aluno_id = auth.uid());

create policy "matriculas_select_staff"
  on public.matriculas for select
  using (
    exists (
      select 1 from public.cursos
      where cursos.id = matriculas.curso_id
        and cursos.instituicao_id = public.instituicao_atual()
        and public.papel_atual() in ('admin_instituicao', 'professor')
    )
  );

create policy "matriculas_crud_staff"
  on public.matriculas for all
  using (
    exists (
      select 1 from public.cursos
      where cursos.id = matriculas.curso_id
        and cursos.instituicao_id = public.instituicao_atual()
        and public.papel_atual() in ('admin_instituicao', 'professor')
    )
  )
  with check (
    exists (
      select 1 from public.cursos
      where cursos.id = matriculas.curso_id
        and cursos.instituicao_id = public.instituicao_atual()
        and public.papel_atual() in ('admin_instituicao', 'professor')
    )
  );

-- ── progresso_aulas ──────────────────────────────────────────────────────
alter table public.progresso_aulas enable row level security;

create policy "progresso_select_proprio"
  on public.progresso_aulas for select
  using (
    exists (
      select 1 from public.matriculas
      where matriculas.id = progresso_aulas.matricula_id
        and matriculas.aluno_id = auth.uid()
    )
  );

create policy "progresso_select_staff"
  on public.progresso_aulas for select
  using (
    exists (
      select 1 from public.matriculas
      join public.cursos on cursos.id = matriculas.curso_id
      where matriculas.id = progresso_aulas.matricula_id
        and cursos.instituicao_id = public.instituicao_atual()
        and public.papel_atual() in ('admin_instituicao', 'professor')
    )
  );

create policy "progresso_upsert_proprio"
  on public.progresso_aulas for all
  using (
    exists (
      select 1 from public.matriculas
      where matriculas.id = progresso_aulas.matricula_id
        and matriculas.aluno_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.matriculas
      where matriculas.id = progresso_aulas.matricula_id
        and matriculas.aluno_id = auth.uid()
    )
  );

-- ── quizzes / quiz_perguntas / quiz_alternativas ────────────────────────
-- Sem policy de select para aluno: se o aluno lesse quiz_alternativas direto pela anon key,
-- veria a coluna `correta` antes de responder. O fluxo de "fazer o quiz" e "corrigir" passa
-- pelo backend Fastify (service role), que serve as perguntas sem a resposta certa.
alter table public.quizzes enable row level security;
alter table public.quiz_perguntas enable row level security;
alter table public.quiz_alternativas enable row level security;

create policy "quizzes_crud_staff"
  on public.quizzes for all
  using (
    exists (
      select 1 from public.cursos
      where cursos.id = quizzes.curso_id
        and cursos.instituicao_id = public.instituicao_atual()
        and public.papel_atual() in ('admin_instituicao', 'professor')
    )
  )
  with check (
    exists (
      select 1 from public.cursos
      where cursos.id = quizzes.curso_id
        and cursos.instituicao_id = public.instituicao_atual()
        and public.papel_atual() in ('admin_instituicao', 'professor')
    )
  );

create policy "quiz_perguntas_crud_staff"
  on public.quiz_perguntas for all
  using (
    exists (
      select 1 from public.quizzes
      join public.cursos on cursos.id = quizzes.curso_id
      where quizzes.id = quiz_perguntas.quiz_id
        and cursos.instituicao_id = public.instituicao_atual()
        and public.papel_atual() in ('admin_instituicao', 'professor')
    )
  )
  with check (
    exists (
      select 1 from public.quizzes
      join public.cursos on cursos.id = quizzes.curso_id
      where quizzes.id = quiz_perguntas.quiz_id
        and cursos.instituicao_id = public.instituicao_atual()
        and public.papel_atual() in ('admin_instituicao', 'professor')
    )
  );

create policy "quiz_alternativas_crud_staff"
  on public.quiz_alternativas for all
  using (
    exists (
      select 1 from public.quiz_perguntas
      join public.quizzes on quizzes.id = quiz_perguntas.quiz_id
      join public.cursos on cursos.id = quizzes.curso_id
      where quiz_perguntas.id = quiz_alternativas.pergunta_id
        and cursos.instituicao_id = public.instituicao_atual()
        and public.papel_atual() in ('admin_instituicao', 'professor')
    )
  )
  with check (
    exists (
      select 1 from public.quiz_perguntas
      join public.quizzes on quizzes.id = quiz_perguntas.quiz_id
      join public.cursos on cursos.id = quizzes.curso_id
      where quiz_perguntas.id = quiz_alternativas.pergunta_id
        and cursos.instituicao_id = public.instituicao_atual()
        and public.papel_atual() in ('admin_instituicao', 'professor')
    )
  );

-- ── quiz_tentativas ──────────────────────────────────────────────────────
alter table public.quiz_tentativas enable row level security;

create policy "quiz_tentativas_select_proprio"
  on public.quiz_tentativas for select
  using (aluno_id = auth.uid());

create policy "quiz_tentativas_select_staff"
  on public.quiz_tentativas for select
  using (
    exists (
      select 1 from public.quizzes
      join public.cursos on cursos.id = quizzes.curso_id
      where quizzes.id = quiz_tentativas.quiz_id
        and cursos.instituicao_id = public.instituicao_atual()
        and public.papel_atual() in ('admin_instituicao', 'professor')
    )
  );

create policy "quiz_tentativas_insert_proprio"
  on public.quiz_tentativas for insert
  with check (aluno_id = auth.uid());

-- ── certificados ─────────────────────────────────────────────────────────
-- Leitura pública liberada para permitir a página de validação /validar/{codigo}
-- sem exigir login. O código de validação é o "segredo" (não é enumerável em sequência).
alter table public.certificados enable row level security;

create policy "certificados_select_publico"
  on public.certificados for select
  using (true);

create policy "certificados_select_staff_para_emissao"
  on public.certificados for all
  using (
    exists (
      select 1 from public.matriculas
      join public.cursos on cursos.id = matriculas.curso_id
      where matriculas.id = certificados.matricula_id
        and cursos.instituicao_id = public.instituicao_atual()
        and public.papel_atual() in ('admin_instituicao', 'professor')
    )
  );
