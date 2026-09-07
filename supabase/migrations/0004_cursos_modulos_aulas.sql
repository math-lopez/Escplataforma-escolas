create table public.cursos (
  id uuid primary key default gen_random_uuid(),
  instituicao_id uuid not null references public.instituicoes (id) on delete cascade,
  titulo text not null,
  descricao text,
  capa_url text,
  publicado boolean not null default false,
  criado_por uuid references public.usuarios (id),
  criado_em timestamptz not null default now()
);

create index cursos_instituicao_id_idx on public.cursos (instituicao_id);

create table public.modulos (
  id uuid primary key default gen_random_uuid(),
  curso_id uuid not null references public.cursos (id) on delete cascade,
  titulo text not null,
  ordem int not null default 0
);

create index modulos_curso_id_idx on public.modulos (curso_id);

create table public.aulas (
  id uuid primary key default gen_random_uuid(),
  modulo_id uuid not null references public.modulos (id) on delete cascade,
  titulo text not null,
  tipo text not null check (tipo in ('video', 'texto', 'pdf', 'ao_vivo')),
  conteudo_url text,
  conteudo_texto text,
  ordem int not null default 0,
  duracao_estimada_min int
);

create index aulas_modulo_id_idx on public.aulas (modulo_id);
