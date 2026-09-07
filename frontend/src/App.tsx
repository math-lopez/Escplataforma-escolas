import { Link, Route, Routes } from "react-router-dom";
import Login from "./routes/Login";
import CadastroInstituicao from "./routes/CadastroInstituicao";
import { useSessao } from "./features/auth/useSessao";

function Home() {
  const { usuario, carregando, sair } = useSessao();

  if (carregando) return <main>Carregando...</main>;

  if (usuario) {
    return (
      <main>
        <h1>Olá, {usuario.nome}</h1>
        <p>Você está logado como {usuario.papel}.</p>
        <button type="button" onClick={sair}>
          Sair
        </button>
      </main>
    );
  }

  return (
    <main>
      <h1>Plataforma Escolas</h1>
      <p>Crie sua instituição e comece a treinar seus alunos.</p>
      <nav>
        <Link to="/cadastro-instituicao">Criar instituição</Link>
        {" · "}
        <Link to="/login">Entrar</Link>
      </nav>
    </main>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/cadastro-instituicao" element={<CadastroInstituicao />} />
    </Routes>
  );
}

export default App;
