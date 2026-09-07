create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  curso_id uuid not null references public.cursos (id) on delete cascade,
  titulo text not null,
  nota_minima_aprovacao numeric not null default 70
);

create index quizzes_curso_id_idx on public.quizzes (curso_id);

create table public.quiz_perguntas (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  enunciado text not null,
  ordem int not null default 0
);

create index quiz_perguntas_quiz_id_idx on public.quiz_perguntas (quiz_id);

create table public.quiz_alternativas (
  id uuid primary key default gen_random_uuid(),
  pergunta_id uuid not null references public.quiz_perguntas (id) on delete cascade,
  texto text not null,
  correta boolean not null default false
);

create index quiz_alternativas_pergunta_id_idx on public.quiz_alternativas (pergunta_id);

create table public.quiz_tentativas (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  aluno_id uuid not null references public.usuarios (id) on delete cascade,
  nota numeric,
  aprovado boolean,
  respostas jsonb,
  finalizada_em timestamptz
);

create index quiz_tentativas_aluno_id_idx on public.quiz_tentativas (aluno_id);
