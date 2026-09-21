import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Botao } from "./components/Botao";
import { RotaProtegida } from "./components/RotaProtegida";
import { useSessao } from "./features/auth/useSessao";
import { TemaProvider } from "./features/tema/TemaProvider";
import Login from "./routes/Login";
import CadastroInstituicao from "./routes/CadastroInstituicao";
import PaginaInstituicao from "./routes/publico/PaginaInstituicao";
import EditorConteudo from "./routes/cursos/EditorConteudo";
import EditorCurso from "./routes/cursos/EditorCurso";
import EditorQuiz from "./routes/cursos/EditorQuiz";
import ListaCursos from "./routes/cursos/ListaCursos";
import ListaAlunos from "./routes/alunos/ListaAlunos";
import MeusCursos from "./routes/aluno/MeusCursos";
import VerCurso from "./routes/aluno/VerCurso";
import ResponderQuiz from "./routes/aluno/ResponderQuiz";
import MeusCertificados from "./routes/aluno/MeusCertificados";
import ValidarCertificado from "./routes/publico/ValidarCertificado";

function obterItensNavegacao(papel: string | undefined) {
  if (papel === "aluno") {
    return [
      { rotulo: "Meus cursos", para: "/aluno/cursos" },
      { rotulo: "Certificados", para: "/aluno/certificados" },
    ];
  }
  return [
    { rotulo: "Cursos", para: "/cursos" },
    { rotulo: "Alunos", para: "/alunos" },
  ];
}

// Junta TemaProvider (cor da instituição) + AppShell (sidebar/topbar com o
// branding) num só lugar. É o ÚNICO ponto onde o TemaProvider entra — telas
// anônimas (Home deslogada, Login, CadastroInstituicao) nunca passam por
// aqui e continuam com o cobalto fixo do DESIGN.md.
function AreaLogada({ children }: { children: ReactNode }) {
  const { usuario, instituicao, sair } = useSessao();
  if (!usuario) return null; // só é montado atrás de RotaProtegida

  const itensNavegacao = obterItensNavegacao(usuario.papel);

  return (
    <TemaProvider corPrimaria={instituicao?.corPrimaria}>
      <AppShell
        usuario={usuario}
        aoSair={sair}
        itensNavegacao={itensNavegacao}
        nomeInstituicao={instituicao?.nome}
        logoUrl={instituicao?.logoUrl}
      >
        {children}
      </AppShell>
    </TemaProvider>
  );
}

function Home() {
  const { usuario, carregando } = useSessao();

  if (carregando) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas">
        <p className="text-body-md text-steel">Carregando...</p>
      </main>
    );
  }

  // Staff (admin/professor) usa a lista de cursos como base de trabalho —
  // alunos vão para seus cursos.
  if (usuario && usuario.papel === "aluno") {
    return <Navigate to="/aluno/cursos" replace />;
  }

  if (usuario && usuario.papel !== "aluno") {
    return <Navigate to="/cursos" replace />;
  }

  if (usuario) {
    return (
      <AreaLogada>
        <div className="flex flex-col gap-base">
          <h1 className="text-heading-lg text-ink-deep">Olá, {usuario.nome}</h1>
          <p className="text-body-md text-steel">Você está logado como {usuario.papel}.</p>
        </div>
      </AreaLogada>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-canvas">
      <section className="flex flex-1 flex-col items-center justify-center gap-lg px-base py-section-lg text-center">
        <h1 className="max-w-[720px] text-heading-sm text-ink-deep sm:text-heading-lg md:text-hero-display">
          Plataforma Escolas
        </h1>
        <p className="max-w-[520px] text-subtitle-md text-steel">
          Crie sua instituição e comece a treinar seus alunos.
        </p>
        <nav className="flex flex-wrap items-center justify-center gap-base">
          <Link to="/cadastro-instituicao">
            <Botao variante="primary">Criar instituição</Botao>
          </Link>
          <Link to="/login">
            <Botao variante="secondary">Entrar</Botao>
          </Link>
        </nav>
      </section>
    </main>
  );
}

const PAPEIS_STAFF = ["admin_instituicao", "professor"] as const;

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/cadastro-instituicao" element={<CadastroInstituicao />} />
      <Route path="/i/:slug" element={<PaginaInstituicao />} />
      <Route path="/validar/:codigo" element={<ValidarCertificado />} />

      <Route
        path="/cursos"
        element={
          <RotaProtegida papel={[...PAPEIS_STAFF]}>
            <AreaLogada>
              <ListaCursos />
            </AreaLogada>
          </RotaProtegida>
        }
      />
      <Route
        path="/cursos/novo"
        element={
          <RotaProtegida papel={[...PAPEIS_STAFF]}>
            <AreaLogada>
              <EditorCurso />
            </AreaLogada>
          </RotaProtegida>
        }
      />
      <Route
        path="/cursos/:id/editar"
        element={
          <RotaProtegida papel={[...PAPEIS_STAFF]}>
            <AreaLogada>
              <EditorCurso />
            </AreaLogada>
          </RotaProtegida>
        }
      />
      <Route
        path="/cursos/:id/conteudo"
        element={
          <RotaProtegida papel={[...PAPEIS_STAFF]}>
            <AreaLogada>
              <EditorConteudo />
            </AreaLogada>
          </RotaProtegida>
        }
      />
      <Route
        path="/cursos/:id/quiz"
        element={
          <RotaProtegida papel={[...PAPEIS_STAFF]}>
            <AreaLogada>
              <EditorQuiz />
            </AreaLogada>
          </RotaProtegida>
        }
      />
      <Route
        path="/alunos"
        element={
          <RotaProtegida papel={[...PAPEIS_STAFF]}>
            <AreaLogada>
              <ListaAlunos />
            </AreaLogada>
          </RotaProtegida>
        }
      />

      <Route
        path="/aluno/cursos"
        element={
          <RotaProtegida papel="aluno">
            <AreaLogada>
              <MeusCursos />
            </AreaLogada>
          </RotaProtegida>
        }
      />
      <Route
        path="/aluno/cursos/:cursoId"
        element={
          <RotaProtegida papel="aluno">
            <AreaLogada>
              <VerCurso />
            </AreaLogada>
          </RotaProtegida>
        }
      />
      <Route
        path="/aluno/cursos/:cursoId/quiz"
        element={
          <RotaProtegida papel="aluno">
            <AreaLogada>
              <ResponderQuiz />
            </AreaLogada>
          </RotaProtegida>
        }
      />
      <Route
        path="/aluno/certificados"
        element={
          <RotaProtegida papel="aluno">
            <AreaLogada>
              <MeusCertificados />
            </AreaLogada>
          </RotaProtegida>
        }
      />
    </Routes>
  );
}

export default App;
