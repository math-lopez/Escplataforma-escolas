import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useSessao } from "../features/auth/useSessao";
import type { RespostaSessao } from "../features/auth/SessaoContext";
import { Botao } from "../components/Botao";
import { Campo } from "../components/Campo";
import { Card } from "../components/Card";

export default function CadastroInstituicao() {
  const navigate = useNavigate();
  const { definirSessao } = useSessao();
  const [nomeInstituicao, setNomeInstituicao] = useState("");
  const [slug, setSlug] = useState("");
  const [nomeAdmin, setNomeAdmin] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErro(null);
    setCarregando(true);

    try {
      // O backend já devolve o usuário autenticado (cookie de sessão setado na resposta).
      const dados = await api.post<RespostaSessao>("/api/instituicoes/onboarding", {
        nomeInstituicao,
        slug,
        nomeAdmin,
        email,
        senha,
      });
      definirSessao(dados);
      // Quem cria a instituição é sempre admin_instituicao — vai direto para os cursos.
      navigate("/cursos");
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Erro inesperado");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-soft px-base py-xxl">
      <Card className="flex w-full max-w-[480px] flex-col gap-lg">
        <div className="flex flex-col gap-xxs text-center">
          <h1 className="text-heading-lg text-ink-deep">Criar instituição</h1>
          <p className="text-body-sm text-steel">
            Monte sua página de cursos e cadastre seus alunos.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-base" noValidate>
          <Campo
            rotulo="Nome da instituição"
            value={nomeInstituicao}
            onChange={(e) => setNomeInstituicao(e.target.value)}
            required
          />
          <Campo
            rotulo="Slug (usado na URL pública, ex: escola-joao)"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            required
          />
          <Campo
            rotulo="Seu nome"
            value={nomeAdmin}
            onChange={(e) => setNomeAdmin(e.target.value)}
            required
          />
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
            autoComplete="new-password"
            minLength={6}
            required
          />
          {erro && (
            <p role="alert" className="text-body-sm text-critical-strong">
              {erro}
            </p>
          )}
          <Botao type="submit" variante="primary" disabled={carregando} className="w-full">
            {carregando ? "Criando..." : "Criar instituição"}
          </Botao>
        </form>

        <p className="text-center text-body-sm text-steel">
          Já tem uma conta?{" "}
          <Link to="/login" className="text-link-md text-primary">
            Entrar
          </Link>
        </p>
      </Card>
    </main>
  );
}
