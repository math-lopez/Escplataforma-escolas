import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSessao } from "../features/auth/useSessao";
import { Botao } from "../components/Botao";
import { Campo } from "../components/Campo";
import { Card } from "../components/Card";

export default function Login() {
  const navigate = useNavigate();
  const { entrar } = useSessao();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErro(null);
    setCarregando(true);

    try {
      const usuario = await entrar(email, senha);
      // Staff (admin/professor) trabalha a partir da lista de cursos; aluno
      // ainda não tem área própria nesta fatia, fica na home.
      navigate(usuario.papel === "aluno" ? "/" : "/cursos");
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Erro inesperado");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-soft px-base py-xxl">
      <Card className="flex w-full max-w-[420px] flex-col gap-lg">
        <div className="flex flex-col gap-xxs text-center">
          <h1 className="text-heading-lg text-ink-deep">Entrar</h1>
          <p className="text-body-sm text-steel">Acesse sua conta na Plataforma Escolas.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-base" noValidate>
          <Campo
            rotulo="E-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <Campo
            rotulo="Senha"
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="current-password"
            required
          />
          {erro && (
            <p role="alert" className="text-body-sm text-critical-strong">
              {erro}
            </p>
          )}
          <Botao type="submit" variante="primary" disabled={carregando} className="w-full">
            {carregando ? "Entrando..." : "Entrar"}
          </Botao>
        </form>

        <p className="text-center text-body-sm text-steel">
          Ainda não tem uma instituição?{" "}
          <Link to="/cadastro-instituicao" className="text-link-md text-primary">
            Criar instituição
          </Link>
        </p>
      </Card>
    </main>
  );
}
