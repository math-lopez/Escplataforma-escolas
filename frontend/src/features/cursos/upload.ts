import { DetailedError, Upload } from "tus-js-client";
import type { CredenciaisUploadPdf, CredenciaisUploadVideo } from "./tiposConteudo";

// PDF e vídeo sobem por protocolos DIFERENTES e propositalmente NÃO estão
// atrás de uma função/tipo genérico: PDF é um PUT único numa signed URL do
// Supabase Storage; vídeo é uma sessão TUS resumável da Bunny (POST de
// criação + PATCH em chunks com offset, tudo escondido dentro do
// tus-js-client). Um vídeo de aula tem centenas de MB subindo de conexão de
// escola — TUS existe justamente para retomar do ponto onde a conexão caiu,
// o que um PUT simples não faz. Se alguém for "simplificar" isso de volta
// pra uma função só, vai quebrar a retomada de upload.

// PDF: PUT do arquivo direto na signedUrl — nunca pelo backend (limite de
// ~4,5MB de corpo na Vercel). XMLHttpRequest em vez de fetch só por causa do
// `upload.onprogress`.
export function enviarPdf(
  credenciais: CredenciaisUploadPdf,
  arquivo: File,
  aoProgredir: (percentual: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", credenciais.signedUrl);

    xhr.upload.onprogress = (evento) => {
      if (evento.lengthComputable) {
        aoProgredir(Math.round((evento.loaded / evento.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Falha no upload do PDF (status ${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error("Falha de rede durante o upload do PDF."));

    xhr.send(arquivo);
  });
}

// Vídeo: sessão TUS na Bunny. `retryDelays` é o que faz a retomada valer na
// prática (reconexão automática se a conexão cair no meio do upload).
export function enviarVideo(
  credenciais: CredenciaisUploadVideo,
  arquivo: File,
  aoProgredir: (percentual: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const upload = new Upload(arquivo, {
      endpoint: credenciais.tusEndpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        AuthorizationSignature: credenciais.authorizationSignature,
        AuthorizationExpire: String(credenciais.authorizationExpire),
        VideoId: credenciais.videoId,
        LibraryId: credenciais.libraryId,
      },
      metadata: {
        filetype: arquivo.type,
        title: arquivo.name,
      },
      onProgress: (bytesEnviados, bytesTotal) => {
        aoProgredir(Math.round((bytesEnviados / bytesTotal) * 100));
      },
      onSuccess: () => resolve(),
      onError: (erro) => {
        // A assinatura da Bunny vale 1 hora (contrato do backend). Se o
        // professor abre a tela, sai pro almoço e volta, o upload falha por
        // autorização expirada — isso VAI acontecer, merece mensagem própria
        // em vez de um erro genérico de rede.
        const status = erro instanceof DetailedError ? erro.originalResponse?.getStatus() : undefined;
        if (status === 401 || status === 403) {
          reject(
            new Error(
              'A autorização para envio expirou (ela vale 1 hora). Clique em "Enviar arquivo" novamente para gerar uma nova.',
            ),
          );
          return;
        }
        reject(new Error("Não foi possível enviar o vídeo. Verifique a conexão e tente novamente."));
      },
    });
    upload.start();
  });
}
