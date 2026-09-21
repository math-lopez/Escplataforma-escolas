// Integração com Resend para envio de e-mail de convites (opcional). Siga o padrão de
// services/bunny.ts: funciona sem configuração, apenas registra no log para testes locais.
import { env } from "../env.js";

/** Verifica se a API do Resend foi configurada. */
export function emailConfigurado(): boolean {
  return Boolean(env.resendApiKey);
}

export class EmailNaoConfiguradoError extends Error {
  constructor() {
    super("Integração com Resend não configurada (falta RESEND_API_KEY)");
  }
}

export interface DadosEmailConvite {
  paraEmail: string;
  instituicaoNome: string;
  linkConvite: string;
}

/**
 * Envia e-mail de convite usando Resend. Se a API não estiver configurada, apenas registra
 * no log (intencional para desenvolvimento sem SMTP).
 */
export async function enviarEmailConvite(fastify: { log: { info: (msg: string) => void; error: (err: unknown) => void } }, dados: DadosEmailConvite): Promise<void> {
  if (!emailConfigurado()) {
    // Intencional: modo desenvolvimento sem e-mail real. Log serve para copiar o link.
    fastify.log.info(
      `[CONVITE] E-mail não configurado. Link para teste: ${dados.linkConvite}`,
    );
    return;
  }

  try {
    const resposta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.emailRemetente,
        to: dados.paraEmail,
        subject: `Você foi convidado para ${dados.instituicaoNome}`,
        html: `
          <p>Você foi convidado para participar de <strong>${dados.instituicaoNome}</strong>.</p>
          <p><a href="${dados.linkConvite}">Clique aqui para aceitar o convite</a></p>
          <p>Ou copie e abra esta URL no seu navegador:</p>
          <p><code>${dados.linkConvite}</code></p>
        `,
      }),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text();
      throw new Error(`Resend recusou o envio (status ${resposta.status}): ${corpo}`);
    }

    fastify.log.info(`E-mail de convite enviado para ${dados.paraEmail}`);
  } catch (erro) {
    // Falha no envio não derruba a criação do convite — ele já está gravado.
    fastify.log.error(`Erro ao enviar e-mail de convite para ${dados.paraEmail}: ${erro}`);
  }
}
