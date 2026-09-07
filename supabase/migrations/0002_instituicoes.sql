create table public.instituicoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text not null unique,
  logo_url text,
  cor_primaria text,
  criado_em timestamptz not null default now()
);

comment on table public.instituicoes is 'Tenant: cada instituição/professor que assina a plataforma.';
comment on column public.instituicoes.slug is 'Usado na URL pública /i/{slug} no MVP (sem subdomínio real ainda).';
