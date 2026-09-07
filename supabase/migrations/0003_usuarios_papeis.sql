create table public.usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  instituicao_id uuid not null references public.instituicoes (id) on delete cascade,
  papel text not null check (papel in ('admin_instituicao', 'professor', 'aluno')),
  nome text not null,
  criado_em timestamptz not null default now()
);

comment on table public.usuarios is 'Perfil de aplicação, 1:1 com auth.users. No MVP, um usuário pertence a uma única instituição.';

create index usuarios_instituicao_id_idx on public.usuarios (instituicao_id);

-- Função usada pelas policies de RLS para descobrir a instituição do usuário autenticado.
-- Fica no schema public (e não em auth) porque o schema auth pertence ao Supabase
-- (supabase_auth_admin) e o role usado no SQL editor/migrations não tem permissão de
-- criar objetos ali — só de ler (auth.uid(), auth.users), não de escrever.
-- security definer + search_path fixo evitam escalonamento de privilégio via search_path;
-- stable permite ao planner do Postgres cachear o resultado dentro do mesmo statement.
create or replace function public.instituicao_atual()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select instituicao_id from public.usuarios where id = auth.uid()
$$;
