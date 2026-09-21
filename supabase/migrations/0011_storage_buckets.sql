-- Buckets do Supabase Storage para os arquivos que NÃO são vídeo (vídeo fica no Bunny Stream,
-- ver 0010_video_externo.sql): PDF de aula ('materiais') e branding da instituição ('branding').
--
-- Convenção de caminho (o backend DEVE seguir isso ao gerar as signed upload URLs, é o que
-- permite às policies abaixo isolar por instituição sem uma tabela auxiliar):
--   {instituicao_id}/...  -- primeiro segmento do caminho é sempre o uuid da instituição dona
--
-- Exemplos:
--   materiais/{instituicao_id}/aulas/{aula_id}/{nome_arquivo}.pdf
--   branding/{instituicao_id}/logo.{ext}
--   branding/{instituicao_id}/cursos/{curso_id}/capa.{ext}
--
-- As policies extraem esse primeiro segmento com storage.foldername(name) — função helper do
-- próprio Supabase Storage que quebra o caminho do objeto em partes — e comparam com
-- public.instituicao_atual(), igual ao padrão usado nas tabelas de negócio (0008).
--
-- Comparação é sempre feita como texto (storage.foldername(...)[1] = instituicao_atual()::text),
-- nunca convertendo o segmento do caminho para uuid. RLS avalia o predicado linha a linha
-- durante o scan; se algum objeto no bucket tiver um primeiro segmento que não seja um uuid
-- válido (upload manual pelo dashboard, arquivo de teste, caminho legado, etc.), um cast
-- `::uuid` nesse segmento levantaria `invalid input syntax for type uuid` e derrubaria a
-- listagem inteira — inclusive para usuários sem nenhuma relação com o arquivo malformado.
-- `uuid::text` do lado de instituicao_atual() nunca lança exceção, então essa direção é segura.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('materiais', 'materiais', false, 26214400, array['application/pdf']),
  ('branding', 'branding', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

comment on column public.instituicoes.logo_url is
  'URL pública do objeto no bucket branding (storage.objects), caminho
   branding/{instituicao_id}/logo.{ext} — ver convenção em 0011_storage_buckets.sql.';

-- RLS em storage.objects já vem habilitado por padrão no Supabase — não precisamos (e não
-- temos permissão, a tabela é do schema storage/supabase_storage_admin) de dar
-- `alter table ... enable row level security` aqui. Só criamos as policies.

-- ── branding: leitura pública (logo/capa aparecem em /i/{slug} sem login) ──────────────────
create policy "branding_select_publico"
  on storage.objects for select
  using (bucket_id = 'branding');

create policy "branding_insert_staff"
  on storage.objects for insert
  with check (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] = public.instituicao_atual()::text
    and public.papel_atual() in ('admin_instituicao', 'professor')
  );

create policy "branding_update_staff"
  on storage.objects for update
  using (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] = public.instituicao_atual()::text
    and public.papel_atual() in ('admin_instituicao', 'professor')
  )
  with check (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] = public.instituicao_atual()::text
    and public.papel_atual() in ('admin_instituicao', 'professor')
  );

create policy "branding_delete_staff"
  on storage.objects for delete
  using (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] = public.instituicao_atual()::text
    and public.papel_atual() in ('admin_instituicao', 'professor')
  );

-- ── materiais: privado, só usuário autenticado da instituição dona do arquivo ───────────────
-- Nota (ver relatório final): a policy de leitura abaixo checa só "pertence à mesma
-- instituição", não "está matriculado no curso específico dessa aula" — segue literalmente o
-- requisito do MVP. Numa instituição com vários cursos, um aluno matriculado em um curso
-- consegue, via RLS, ler o PDF de uma aula de outro curso da mesma instituição se souber (ou
-- adivinhar) o caminho do objeto. Aceitável por ora porque: (a) o caminho carrega o uuid da
-- aula, não enumerável; (b) na prática a distribuição do link é via URL assinada gerada pelo
-- backend, que pode aplicar a checagem de matrícula antes de assinar. Sinalizado para revisão
-- caso o produto passe a tratar conteúdo por curso como sensível entre alunos da mesma
-- instituição.
create policy "materiais_select_propria_instituicao"
  on storage.objects for select
  using (
    bucket_id = 'materiais'
    and (storage.foldername(name))[1] = public.instituicao_atual()::text
  );

create policy "materiais_insert_staff"
  on storage.objects for insert
  with check (
    bucket_id = 'materiais'
    and (storage.foldername(name))[1] = public.instituicao_atual()::text
    and public.papel_atual() in ('admin_instituicao', 'professor')
  );

create policy "materiais_update_staff"
  on storage.objects for update
  using (
    bucket_id = 'materiais'
    and (storage.foldername(name))[1] = public.instituicao_atual()::text
    and public.papel_atual() in ('admin_instituicao', 'professor')
  )
  with check (
    bucket_id = 'materiais'
    and (storage.foldername(name))[1] = public.instituicao_atual()::text
    and public.papel_atual() in ('admin_instituicao', 'professor')
  );

create policy "materiais_delete_staff"
  on storage.objects for delete
  using (
    bucket_id = 'materiais'
    and (storage.foldername(name))[1] = public.instituicao_atual()::text
    and public.papel_atual() in ('admin_instituicao', 'professor')
  );
