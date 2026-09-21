-- Aula de vídeo passa a ter DUAS origens possíveis: upload para a Bunny Stream (0010) ou um
-- vídeo que a instituição já tem no YouTube. Motivo: muito professor já gravou e publicou o
-- conteúdo, e reenviar tudo é atrito desnecessário — além de dispensar a integração com a
-- Bunny para quem só usa YouTube.
--
-- Decisão de modelagem: NÃO criamos um `tipo` novo em `aulas`. Do ponto de vista do aluno,
-- continua sendo uma aula de vídeo; o que muda é só qual player renderiza. Criar
-- `tipo = 'youtube'` obrigaria toda regra de negócio que hoje trata `tipo = 'video'`
-- (progresso, certificado, validação de upload) a passar a testar dois valores, e cada
-- provedor novo no futuro multiplicaria isso.
--
-- Em vez disso, `video_fonte` diz QUEM hospeda, e `video_externo_id` — que já existia —
-- passa a ser o id no provedor, seja ele qual for.

alter table public.aulas
  add column video_fonte text check (video_fonte in ('bunny', 'youtube'));

comment on column public.aulas.video_fonte is
  'Quem hospeda o vídeo desta aula: bunny (upload pela plataforma, com encoding e status) ou
   youtube (link que a instituição já tinha). Null quando aulas.tipo != ''video''.
   Para adicionar um provedor novo (Vimeo, por exemplo), basta estender este check — nenhuma
   regra de negócio que testa aulas.tipo = ''video'' precisa mudar.';

comment on column public.aulas.video_externo_id is
  'Id do vídeo NO PROVEDOR indicado por video_fonte: o guid da Bunny, ou o id de 11 caracteres
   do YouTube. O backend NUNCA guarda a URL colada pelo professor — ele extrai e valida o id, e
   monta a URL de reprodução no servidor. Guardar a URL crua permitiria apontar o player para
   qualquer destino (ver services/bunny.ts e services/youtube.ts).';

comment on column public.aulas.video_status is
  'Só faz sentido para video_fonte = ''bunny'', onde há encoding assíncrono: processando ->
   pronto | erro, espelhado pelo webhook. Para youtube o vídeo já está disponível no momento
   em que o link é salvo, então o status é gravado como ''pronto'' direto.';

-- Aulas de vídeo que já existem foram todas criadas pelo fluxo da Bunny (0010), antes de
-- existir qualquer outra origem. Marcamos a origem delas para que `video_fonte` nunca fique
-- null numa aula de vídeo com vídeo já associado — o backend usa essa coluna para decidir
-- qual player usar, e null ali seria um estado sem resposta.
update public.aulas
   set video_fonte = 'bunny'
 where tipo = 'video'
   and video_externo_id is not null
   and video_fonte is null;
