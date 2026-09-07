create table public.certificados (
  id uuid primary key default gen_random_uuid(),
  matricula_id uuid not null references public.matriculas (id) on delete cascade,
  codigo_validacao text not null unique,
  emitido_em timestamptz not null default now()
);

comment on column public.certificados.codigo_validacao is 'Código curto usado na página pública /validar/{codigo}. MVP: sem layout customizável por instituição.';
