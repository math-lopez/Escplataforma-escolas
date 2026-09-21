-- Vídeo de aula passa a ficar no Bunny Stream (encoding, HLS adaptativo, player e token auth
-- inclusos), não no Supabase Storage — Storage guarda só o que não é vídeo (PDF, branding).

alter table public.aulas
  add column video_externo_id text,
  add column video_status text check (video_status in ('processando', 'pronto', 'erro'));

comment on column public.aulas.video_externo_id is
  'Id do vídeo no Bunny Stream (preenchido pelo backend ao criar o vídeo na Bunny, antes do
   upload). Só usado quando aulas.tipo = ''video''. O player busca a URL de reprodução na Bunny
   a partir deste id (com token assinado) — não fica guardado aqui.';
comment on column public.aulas.video_status is
  'Status do encoding no Bunny, espelhado via webhook para o backend: processando logo após o
   upload, pronto quando o HLS está disponível para reprodução, erro se o encoding falhar. Null
   enquanto aulas.tipo != ''video'' ou antes do primeiro upload.';

-- Divisão de responsabilidade entre as colunas de conteúdo de public.aulas, para não haver
-- ambiguidade sobre qual coluna ler de acordo com aulas.tipo:
--   tipo = 'video'   -> video_externo_id + video_status (Bunny Stream). conteudo_url fica null.
--   tipo = 'pdf'     -> conteudo_url aponta para o objeto em storage.objects (bucket
--                       'materiais', ver 0011_storage_buckets.sql), não a URL pública direta.
--   tipo = 'texto'   -> conteudo_texto guarda o conteúdo (markdown/rich text), conteudo_url null.
--   tipo = 'ao_vivo' -> conteudo_url guarda o link externo da videoconferência (Zoom/Meet/etc);
--                       não há integração real no MVP, é só um link.
comment on column public.aulas.conteudo_url is
  'Uso depende de aulas.tipo: link/caminho do PDF (tipo=pdf, bucket materiais) ou link externo de
   videoconferência (tipo=ao_vivo). Não é usado para tipo=video (ver video_externo_id) nem para
   tipo=texto (ver conteudo_texto).';
comment on column public.aulas.conteudo_texto is
  'Conteúdo da aula quando aulas.tipo = ''texto''. Null para os demais tipos.';
