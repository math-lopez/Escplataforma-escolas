import { useCallback, useEffect, useState } from "react";
import { Badge } from "../../components/Badge";
import { Botao } from "../../components/Botao";
import { Campo } from "../../components/Campo";
import { Card } from "../../components/Card";
import { Abas } from "../../components/Abas";
import { EstadoVazio } from "../../components/EstadoVazio";
import { Modal } from "../../components/Modal";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/useToast";
import {
  listarAlunos,
  criarAluno,
  aprovarAluno,
  recusarAluno,
  matricularAluno,
} from "../../features/alunos/api";
import type { Aluno } from "../../features/alunos/tipos";
import { listarCursos } from "../../features/cursos/api";
import type { Curso } from "../../features/cursos/tipos";
import { ApiError } from "../../lib/api";

function mensagemErro(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

type StatusFiltro = "todos" | "ativo" | "pendente" | "recusado";

export default function ListaAlunos() {
  const { notificar } = useToast();

  // Estado da lista de alunos
  const [alunos, setAlunos] = useState<Aluno[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>("todos");

  // Modal de cadastro
  const [modalCadastroAberto, setModalCadastroAberto] = useState(false);
  const [formNome, setFormNome] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [erroFormulario, setErroFormulario] = useState<{ nome?: string; email?: string }>({});
  const [cadastrando, setCadastrando] = useState(false);

  // Modal de sucesso com senha
  const [senhaProvisoria, setSenhaProvisoria] = useState<string | null>(null);
  const [copiadoParaAreaTransferencia, setCopiadoParaAreaTransferencia] = useState(false);

  // Modal de recusa
  const [alunoParaRecusar, setAlunoParaRecusar] = useState<Aluno | null>(null);
  const [recusando, setRecusando] = useState(false);

  // Modal de matrícula
  const [alunoParaMatricular, setAlunoParaMatricular] = useState<Aluno | null>(null);
  const [cursos, setCursos] = useState<Curso[]>([]);
  const [cursoSelecionado, setCursoSelecionado] = useState<string>("");
  const [matriculando, setMatriculando] = useState(false);

  const buscarAlunos = useCallback(() => {
    const statusParam = statusFiltro === "todos" ? undefined : statusFiltro;
    listarAlunos(statusParam)
      .then((dados) => {
        setAlunos(dados);
        setErro(null);
      })
      .catch((error: unknown) => setErro(mensagemErro(error, "Não foi possível carregar os alunos.")));
  }, [statusFiltro]);

  useEffect(() => {
    buscarAlunos();
  }, [buscarAlunos]);

  // Carrega cursos ao montar o componente (para o select de matrícula)
  useEffect(() => {
    listarCursos()
      .then(setCursos)
      .catch(() => {
        notificar("Erro ao carregar cursos para matrícula", "critical");
      });
  }, [notificar]);

  function tentarNovamente() {
    setErro(null);
    setAlunos(null);
    buscarAlunos();
  }

  async function confirmarCadastro() {
    const novoErro: typeof erroFormulario = {};

    if (!formNome.trim()) {
      novoErro.nome = "Nome é obrigatório";
    }
    if (!formEmail.trim()) {
      novoErro.email = "Email é obrigatório";
    }

    if (Object.keys(novoErro).length > 0) {
      setErroFormulario(novoErro);
      return;
    }

    setCadastrando(true);
    try {
      const resposta = await criarAluno({
        nome: formNome.trim(),
        email: formEmail.trim(),
      });

      // Limpa o formulário e fecha o modal
      setFormNome("");
      setFormEmail("");
      setErroFormulario({});
      setModalCadastroAberto(false);

      // Mostra a senha em modal persistente
      setSenhaProvisoria(resposta.senhaProvisoria);

      // Atualiza a lista de alunos
      setAlunos((atual) => [resposta, ...(atual ?? [])]);
    } catch (error) {
      notificar(mensagemErro(error, "Não foi possível criar o aluno."), "critical");
    } finally {
      setCadastrando(false);
    }
  }

  async function confirmarRecusa() {
    if (!alunoParaRecusar) return;

    setRecusando(true);
    try {
      const alunoAtualizado = await recusarAluno(alunoParaRecusar.id);
      setAlunos((atual) =>
        atual?.map((a) => (a.id === alunoParaRecusar.id ? alunoAtualizado : a)) ?? null,
      );
      notificar("Aluno recusado com sucesso", "success");
      setAlunoParaRecusar(null);
    } catch (error) {
      notificar(mensagemErro(error, "Não foi possível recusar o aluno."), "critical");
    } finally {
      setRecusando(false);
    }
  }

  async function confirmarAprovacao(aluno: Aluno) {
    try {
      const alunoAtualizado = await aprovarAluno(aluno.id);
      setAlunos((atual) =>
        atual?.map((a) => (a.id === aluno.id ? alunoAtualizado : a)) ?? null,
      );
      notificar("Aluno aprovado com sucesso", "success");
    } catch (error) {
      notificar(mensagemErro(error, "Não foi possível aprovar o aluno."), "critical");
    }
  }

  async function confirmarMatricula() {
    if (!alunoParaMatricular || !cursoSelecionado) return;

    setMatriculando(true);
    try {
      await matricularAluno(cursoSelecionado, alunoParaMatricular.id);
      notificar("Aluno matriculado com sucesso", "success");
      setAlunoParaMatricular(null);
      setCursoSelecionado("");
    } catch (error) {
      const mensagem =
        error instanceof ApiError && error.status === 409
          ? "Aluno já está matriculado neste curso"
          : mensagemErro(error, "Não foi possível matricular o aluno.");
      notificar(mensagem, "critical");
    } finally {
      setMatriculando(false);
    }
  }

  async function copiarSenha() {
    if (!senhaProvisoria) return;
    try {
      await navigator.clipboard.writeText(senhaProvisoria);
      setCopiadoParaAreaTransferencia(true);
      setTimeout(() => setCopiadoParaAreaTransferencia(false), 2000);
    } catch {
      notificar("Erro ao copiar para a área de transferência", "critical");
    }
  }

  const abas: Array<{ id: StatusFiltro; rotulo: string }> = [
    { id: "todos", rotulo: "Todos" },
    { id: "ativo", rotulo: "Ativos" },
    { id: "pendente", rotulo: "Pendentes" },
    { id: "recusado", rotulo: "Recusados" },
  ];

  const varianteBadgeStatus = (status: string) => {
    switch (status) {
      case "ativo":
        return "success";
      case "pendente":
        return "attention";
      case "recusado":
        return "critical";
      default:
        return "neutro";
    }
  };

  return (
    <div className="flex flex-col gap-lg">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-base">
        <h1 className="text-heading-lg text-ink-deep">Alunos</h1>
        {alunos !== null && alunos.length > 0 && (
          <Botao variante="accent" onClick={() => setModalCadastroAberto(true)}>
            Novo aluno
          </Botao>
        )}
      </div>

      {/* Filtro por status */}
      {alunos !== null && alunos.length > 0 && (
        <Abas
          itens={abas}
          ativa={statusFiltro}
          aoSelecionar={(id) => setStatusFiltro(id as StatusFiltro)}
        />
      )}

      {/* Erro */}
      {erro && (
        <Card className="flex flex-col items-start gap-base">
          <p className="text-body-md text-critical-strong">{erro}</p>
          <Botao variante="accent" onClick={tentarNovamente}>
            Tentar novamente
          </Botao>
        </Card>
      )}

      {/* Carregando */}
      {!erro && alunos === null && (
        <div className="flex justify-center py-xxl">
          <Spinner />
        </div>
      )}

      {/* Estado vazio */}
      {!erro && alunos !== null && alunos.length === 0 && (
        <EstadoVazio
          titulo="Nenhum aluno ainda"
          descricao="Cadastre o primeiro aluno da sua instituição para começar a gerenciar o aprendizado."
          acao={
            <Botao variante="accent" onClick={() => setModalCadastroAberto(true)}>
              Cadastrar primeiro aluno
            </Botao>
          }
        />
      )}

      {/* Lista de alunos */}
      {!erro && alunos !== null && alunos.length > 0 && (
        <div className="flex flex-col gap-sm">
          {alunos.map((aluno) => (
            <Card key={aluno.id} className="flex flex-col gap-base sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-xs">
                <span className="text-body-md-bold text-ink-deep">{aluno.nome}</span>
                <Badge variante={varianteBadgeStatus(aluno.status)}>
                  {aluno.status.charAt(0).toUpperCase() + aluno.status.slice(1)}
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-sm">
                {aluno.status === "pendente" && (
                  <>
                    <Botao variante="accent" onClick={() => confirmarAprovacao(aluno)}>
                      Aprovar
                    </Botao>
                    <Botao variante="ghost" onClick={() => setAlunoParaRecusar(aluno)}>
                      Recusar
                    </Botao>
                  </>
                )}

                {(aluno.status === "ativo" || aluno.status === "pendente") && (
                  <Botao variante="ghost" onClick={() => {
                    setAlunoParaMatricular(aluno);
                    setCursoSelecionado("");
                  }}>
                    Matricular
                  </Botao>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Modal de cadastro */}
      <Modal
        aberto={modalCadastroAberto}
        aoFechar={() => {
          setModalCadastroAberto(false);
          setFormNome("");
          setFormEmail("");
          setErroFormulario({});
        }}
        titulo="Cadastrar aluno"
      >
        <div className="flex flex-col gap-lg">
          <Campo
            rotulo="Nome"
            value={formNome}
            onChange={(e) => {
              setFormNome(e.target.value);
              if (erroFormulario.nome) {
                setErroFormulario((atual) => ({ ...atual, nome: undefined }));
              }
            }}
            erro={erroFormulario.nome}
            disabled={cadastrando}
          />
          <Campo
            rotulo="Email"
            type="email"
            value={formEmail}
            onChange={(e) => {
              setFormEmail(e.target.value);
              if (erroFormulario.email) {
                setErroFormulario((atual) => ({ ...atual, email: undefined }));
              }
            }}
            erro={erroFormulario.email}
            disabled={cadastrando}
          />
          <div className="flex justify-end gap-sm">
            <Botao
              variante="ghost"
              onClick={() => {
                setModalCadastroAberto(false);
                setFormNome("");
                setFormEmail("");
                setErroFormulario({});
              }}
              disabled={cadastrando}
            >
              Cancelar
            </Botao>
            <Botao variante="accent" onClick={confirmarCadastro} disabled={cadastrando}>
              {cadastrando ? "Cadastrando..." : "Cadastrar"}
            </Botao>
          </div>
        </div>
      </Modal>

      {/* Modal de senha provisória */}
      <Modal
        aberto={senhaProvisoria !== null}
        aoFechar={() => {}}
        titulo="Aluno cadastrado com sucesso"
      >
        <div className="flex flex-col gap-lg">
          <div className="flex flex-col gap-base rounded-lg border border-attention bg-[rgba(241,192,27,0.1)] p-base">
            <p className="text-body-sm text-ink-deep">
              <strong>Importante:</strong> esta é a única vez que a senha será exibida. Anote-a ou
              copie para um local seguro.
            </p>
            <div className="flex items-center gap-sm">
              <code className="flex-1 rounded bg-canvas px-md py-sm font-mono text-body-md-bold text-ink-deep">
                {senhaProvisoria}
              </code>
              <Botao variante="ghost" onClick={copiarSenha} className="whitespace-nowrap">
                {copiadoParaAreaTransferencia ? "Copiado!" : "Copiar"}
              </Botao>
            </div>
          </div>
          <div className="flex justify-end">
            <Botao variante="accent" onClick={() => setSenhaProvisoria(null)}>
              Já anotei
            </Botao>
          </div>
        </div>
      </Modal>

      {/* Modal de recusa */}
      <Modal
        aberto={alunoParaRecusar !== null}
        aoFechar={() => setAlunoParaRecusar(null)}
        titulo="Recusar aluno"
      >
        <div className="flex flex-col gap-lg">
          <p className="text-body-md text-ink">
            Tem certeza que deseja recusar <strong>{alunoParaRecusar?.nome}</strong>? Essa ação não
            pode ser desfeita.
          </p>
          <div className="flex justify-end gap-sm">
            <Botao
              variante="ghost"
              onClick={() => setAlunoParaRecusar(null)}
              disabled={recusando}
            >
              Cancelar
            </Botao>
            <Botao variante="perigo" onClick={confirmarRecusa} disabled={recusando}>
              {recusando ? "Recusando..." : "Recusar"}
            </Botao>
          </div>
        </div>
      </Modal>

      {/* Modal de matrícula */}
      <Modal
        aberto={alunoParaMatricular !== null}
        aoFechar={() => {
          setAlunoParaMatricular(null);
          setCursoSelecionado("");
        }}
        titulo="Matricular aluno em curso"
      >
        <div className="flex flex-col gap-lg">
          <div className="flex flex-col gap-xs">
            <label htmlFor="select-curso" className="text-body-sm-bold text-ink">
              Curso
            </label>
            <select
              id="select-curso"
              value={cursoSelecionado}
              onChange={(e) => setCursoSelecionado(e.target.value)}
              disabled={matriculando || cursos.length === 0}
              className="h-11 rounded-lg border border-hairline bg-canvas px-md text-body-md text-ink outline-none focus:border-2 focus:border-fb-blue disabled:bg-disabled-text disabled:text-canvas"
            >
              <option value="">Selecione um curso...</option>
              {cursos.map((curso) => (
                <option key={curso.id} value={curso.id}>
                  {curso.titulo}
                </option>
              ))}
            </select>
            {cursos.length === 0 && (
              <p className="text-body-sm text-steel">Nenhum curso disponível para matrícula.</p>
            )}
          </div>
          <div className="flex justify-end gap-sm">
            <Botao
              variante="ghost"
              onClick={() => {
                setAlunoParaMatricular(null);
                setCursoSelecionado("");
              }}
              disabled={matriculando}
            >
              Cancelar
            </Botao>
            <Botao
              variante="accent"
              onClick={confirmarMatricula}
              disabled={matriculando || !cursoSelecionado}
            >
              {matriculando ? "Matriculando..." : "Matricular"}
            </Botao>
          </div>
        </div>
      </Modal>
    </div>
  );
}
