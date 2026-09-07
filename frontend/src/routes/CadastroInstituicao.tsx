import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useSessao } from "../features/auth/useSessao";
import type { Usuario } from "../features/auth/SessaoContext";

export default function CadastroInstituicao() {
  const navigate = useNavigate();
  const { definirUsuario } = useSessao();
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
      const usuario = await api.post<Usuario>("/api/instituicoes/onboarding", {
        nomeInstituicao,
        slug,
        nomeAdmin,
        email,
        senha,
      });
      definirUsuario(usuario);
      navigate("/");
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Erro inesperado");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <main>
      <h1>Criar instituição</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Nome da instituição
          <input value={nomeInstituicao} onChange={(e) => setNomeInstituicao(e.target.value)} required />
        </label>
        <label>
          Slug (usado na URL pública, ex: escola-joao)
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            required
          />
        </label>
        <label>
          Seu nome
          <input value={nomeAdmin} onChange={(e) => setNomeAdmin(e.target.value)} required />
        </label>
        <label>
          E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Senha
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            minLength={6}
            required
          />
        </label>
        {erro && <p role="alert">{erro}</p>}
        <button type="submit" disabled={carregando}>
          {carregando ? "Criando..." : "Criar instituição"}
        </button>
      </form>
    </main>
  );
}
