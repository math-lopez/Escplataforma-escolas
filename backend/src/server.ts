import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { env } from "./env.js";
import supabasePlugin from "./plugins/supabase.js";
import authPlugin from "./plugins/auth.js";
import authRoutes from "./routes/auth.js";
import instituicoesRoutes from "./routes/instituicoes.js";
import publicoRoutes from "./routes/publico.js";
import cursosRoutes from "./routes/cursos.js";
import alunosRoutes from "./routes/alunos.js";
import alunoRoutes from "./routes/aluno.js";
import convitesRoutes from "./routes/convites.js";
import modulosRoutes from "./routes/modulos.js";
import aulasRoutes from "./routes/aulas.js";
import webhooksRoutes from "./routes/webhooks.js";
import quizzesRoutes from "./routes/quizzes.js";
import certificadosRoutes from "./routes/certificados.js";

const fastify = Fastify({ logger: true });

// credentials: true é necessário porque a sessão trafega em cookie httpOnly,
// não em header Authorization — o frontend nunca vê o token.
await fastify.register(cors, { origin: env.corsOrigin, credentials: true });
await fastify.register(cookie);
await fastify.register(supabasePlugin);
await fastify.register(authPlugin);
await fastify.register(authRoutes);
await fastify.register(instituicoesRoutes);
await fastify.register(publicoRoutes);
await fastify.register(cursosRoutes);
await fastify.register(alunosRoutes);
await fastify.register(alunoRoutes);
await fastify.register(convitesRoutes);
await fastify.register(modulosRoutes);
await fastify.register(aulasRoutes);
await fastify.register(webhooksRoutes);
await fastify.register(quizzesRoutes);
await fastify.register(certificadosRoutes);

fastify.get("/health", async () => ({ status: "ok" }));

try {
  await fastify.listen({ port: env.port, host: "0.0.0.0" });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
