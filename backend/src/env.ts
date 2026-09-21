import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente ausente: ${name}`);
  }
  return value;
}

function cookieSameSite(): "lax" | "strict" | "none" {
  const valor = process.env.COOKIE_SAME_SITE;
  if (valor === undefined) return "lax";
  if (valor === "lax" || valor === "strict" || valor === "none") return valor;
  throw new Error(`COOKIE_SAME_SITE inválido: "${valor}" (use lax, strict ou none)`);
}

export const env = {
  port: Number(process.env.PORT ?? 3333),
  producao: process.env.NODE_ENV === "production",
  supabaseUrl: required("SUPABASE_URL"),
  supabaseAnonKey: required("SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  // Cookie de sessão: default "lax"/`producao` preservado para dev. Só mexer via env se
  // front e back ficarem em domínios diferentes em produção (ver comentário em lib/sessao.ts).
  cookieSameSite: cookieSameSite(),
  cookieSecure: process.env.COOKIE_SECURE === undefined ? undefined : process.env.COOKIE_SECURE === "true",
  // Bunny Stream (upload/encoding de vídeo de aula, ver services/bunny.ts): deliberadamente NÃO
  // usa `required()` — o usuário ainda não criou a conta na Bunny quando esta fatia foi escrita,
  // e o resto do app (cursos, módulos, PDF, etc.) precisa continuar funcionando sem essas
  // variáveis. A ausência só vira erro (503) na hora de usar uma rota de vídeo, nunca no boot.
  bunnyApiKey: process.env.BUNNY_API_KEY,
  bunnyLibraryId: process.env.BUNNY_LIBRARY_ID,
  bunnyWebhookSecret: process.env.BUNNY_WEBHOOK_SECRET,
  // Resend (envio de e-mail de convites, ver services/email.ts): deliberadamente opcionais,
  // como Bunny. Sem configuração, apenas registra no log (útil para testes).
  resendApiKey: process.env.RESEND_API_KEY,
  emailRemetente: process.env.EMAIL_REMETENTE ?? "noreply@escplataforma.local",
  // Frontend URL para montar links de convite a serem enviados por e-mail.
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
};
