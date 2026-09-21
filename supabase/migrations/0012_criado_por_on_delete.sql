-- Corrige um bug encontrado rodando o app de verdade contra o banco (não apareceu em nenhum
-- teste, porque a suíte usa mocks e nunca exercita foreign key).
--
-- Sintoma: apagar um usuário do Supabase Auth falha com "Database error deleting user",
-- uma mensagem que não diz nada sobre a causa.
--
-- Causa: `cursos.criado_por` (0004) e `convites.criado_por` (0009) referenciam
-- `public.usuarios (id)` SEM cláusula `on delete`, então o Postgres usa `NO ACTION`. A cadeia
-- que trava é:
--   delete em auth.users
--     -> cascata para public.usuarios (0003 declara `on delete cascade`)
--       -> BLOQUEADO por cursos.criado_por / convites.criado_por, que ainda apontam para a linha
--
-- Consequência prática: não é possível remover um professor que já criou qualquer curso — o
-- caso normal de alguém saindo da instituição.
--
-- Correção: `on delete set null`. A coluna já é nullable e existe primariamente para
-- auditoria/exibição (ver comentário em 0009), então perder a atribuição de autoria ao remover
-- o usuário é o comportamento certo: o curso é da INSTITUIÇÃO, não da pessoa que o criou, e
-- apagar o curso junto seria destrutivo demais. Impedir a remoção do usuário é pior ainda.
--
-- O bloco abaixo descobre o nome real da constraint em vez de assumir a convenção
-- `{tabela}_{coluna}_fkey` do Postgres. A convenção quase sempre vale, mas se alguém tiver
-- recriado a FK com outro nome em algum ambiente, um `drop constraint <nome fixo>` faria a
-- migration inteira falhar e dar rollback — e migration que falha no meio custa caro para
-- diagnosticar. Assim ela funciona independente de como a constraint foi nomeada, e é
-- idempotente: rodar duas vezes não quebra.

do $$
declare
  tabela text;
  nome_constraint text;
begin
  foreach tabela in array array['cursos', 'convites']
  loop
    -- Acha a FK que sai de (tabela, criado_por) para public.usuarios, qualquer que seja o nome.
    select con.conname into nome_constraint
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = tabela
      and con.contype = 'f'
      and con.conkey = array[
        (select attnum from pg_attribute
          where attrelid = rel.oid and attname = 'criado_por' and not attisdropped)
      ];

    if nome_constraint is not null then
      execute format('alter table public.%I drop constraint %I', tabela, nome_constraint);
    end if;

    execute format(
      'alter table public.%I add constraint %I foreign key (criado_por)
         references public.usuarios (id) on delete set null',
      tabela, tabela || '_criado_por_fkey'
    );
  end loop;
end $$;

comment on column public.cursos.criado_por is
  'Quem criou o curso, para auditoria/exibição. Vira null se o usuário for removido — o curso
   pertence à instituição, não à pessoa, e não deve sumir junto com ela (ver 0012).';

comment on column public.convites.criado_por is
  'Staff que emitiu o convite, para auditoria/exibição. Vira null se o usuário for removido,
   pelo mesmo motivo de cursos.criado_por (ver 0012).';
