create table public.matriculas (
  id uuid primary key default gen_random_uuid(),
  curso_id uuid not null references public.cursos (id) on delete cascade,
  aluno_id uuid not null references public.usuarios (id) on delete cascade,
  status text not null default 'ativa' check (status in ('ativa', 'concluida', 'cancelada')),
  matriculado_em timestamptz not null default now(),
  unique (curso_id, aluno_id)
);

create index matriculas_aluno_id_idx on public.matriculas (aluno_id);
create index matriculas_curso_id_idx on public.matriculas (curso_id);

create table public.progresso_aulas (
  id uuid primary key default gen_random_uuid(),
  matricula_id uuid not null references public.matriculas (id) on delete cascade,
  aula_id uuid not null references public.aulas (id) on delete cascade,
  concluida boolean not null default false,
  concluida_em timestamptz,
  unique (matricula_id, aula_id)
);

create index progresso_aulas_matricula_id_idx on public.progresso_aulas (matricula_id);
