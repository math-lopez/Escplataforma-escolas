import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Abas } from "../../components/Abas";
import { Botao } from "../../components/Botao";
import { Campo } from "../../components/Campo";
import { CampoTextarea } from "../../components/CampoTextarea";
import { Card } from "../../components/Card";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/useToast";
import { atualizarCurso, buscarCurso, criarCurso } from "../../features/cursos/api";
import { ApiError } from "../../lib/api";

const OPCOES_STATUS = [
  { id: "rascunho", rotulo: "Rascunho" },
  { id: "publicado", rotulo: "Publicado" },
];

function mensagemErro(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

// Uma única tela cobre criar e editar: o comportamento difere só em "existe
// um id na rota" (carrega o curso e faz PATCH) ou não (faz POST) — separar em
// dois componentes duplicaria o formulário inteiro por nenhum ganho no MVP.
export default function EditorCurso() {
  const { id } = useParams<{ id: string }>();
  const modoEdicao = Boolean(id);
  const navigate = useNavigate();
  const { notificar } = useToast();

  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [publicado, setPublicado] = useState(false);
  const [erroTitulo, setErroTitulo] = useState<string | null>(null);
  const [erroServidor, setErroServidor] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(modoEdicao);
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    // `carregando`/`erroCarregamento` já nascem corretos para o único caminho
    // real de navegação (a tela remonta ao entrar via lista de cursos); nada
    // aqui precisa de um setState síncrono no corpo do efeito.
    if (!id) return;
    buscarCurso(id)
      .then((curso) => {
        setTitulo(curso.titulo);
        setDescricao(curso.descricao ?? "");
        setPublicado(curso.publicado);
      })
      .catch((error: unknown) => {
        setErroCarregamento(mensagemErro(error, "Não foi possível carregar o curso."));
      })
      .finally(() => setCarregando(false));
  }, [id]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErroServidor(null);

    // Validação no client além da do servidor — pedido explícito do escopo,
    // evita um round-trip só pra descobrir que o título está vazio.
    const tituloLimpo = titulo.trim();
    if (!tituloLimpo) {
      setErroTitulo("Informe um título para o curso.");
      return;
    }
    setErroTitulo(null);
    setSalvando(true);

    try {
      const dados = { titulo: tituloLimpo, descricao: descricao.trim() || null, publicado };
      if (modoEdicao && id) {
        await atualizarCurso(id, dados);
        notificar("Curso atualizado.", "success");
      } else {
        await criarCurso(dados);
        notificar("Curso criado.", "success");
      }
      navigate("/cursos");
    } catch (error) {
      setErroServidor(mensagemErro(error, "Não foi possível salvar o curso."));
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) {
    return (
      <div className="flex justify-center py-xxl">
        <Spinner />
      </div>
    );
  }

  if (erroCarregamento) {
    return (
      <Card className="flex flex-col items-start gap-base">
        <p className="text-body-md text-critical-strong">{erroCarregamento}</p>
        <Botao variante="accent" onClick={() => navigate("/cursos")}>
          Voltar para cursos
        </Botao>
      </Card>
    );
  }

  return (
    <div className="flex max-w-[640px] flex-col gap-lg">
      <h1 className="text-heading-lg text-ink-deep">{modoEdicao ? "Editar curso" : "Novo curso"}</h1>

      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-base" noValidate>
          <Campo
            rotulo="Título"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            erro={erroTitulo ?? undefined}
            required
          />
          <CampoTextarea
            rotulo="Descrição"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            rows={4}
          />
          <div className="flex flex-col gap-xxs">
            <span className="text-body-sm-bold text-ink">Status</span>
            <Abas
              itens={OPCOES_STATUS}
              ativa={publicado ? "publicado" : "rascunho"}
              aoSelecionar={(valor) => setPublicado(valor === "publicado")}
            />
          </div>

          {erroServidor && (
            <p role="alert" className="text-body-sm text-critical-strong">
              {erroServidor}
            </p>
          )}

          <div className="flex justify-end gap-sm">
            <Botao
              variante="ghost"
              type="button"
              onClick={() => navigate("/cursos")}
              disabled={salvando}
            >
              Cancelar
            </Botao>
            <Botao variante="accent" type="submit" disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar"}
            </Botao>
          </div>
        </form>
      </Card>
    </div>
  );
}
