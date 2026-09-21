import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Acordeao } from "../../components/Acordeao";
import { Botao } from "../../components/Botao";
import { Campo } from "../../components/Campo";
import { Card } from "../../components/Card";
import { EstadoVazio } from "../../components/EstadoVazio";
import { Modal } from "../../components/Modal";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/useToast";
import {
  carregarQuizProfessor,
  salvarQuiz,
  deletarQuiz,
} from "../../features/quiz/quizApi";
import type { Quiz, Pergunta } from "../../features/quiz/tipos";
import { ApiError } from "../../lib/api";

function mensagemErro(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

// Move um item uma posição para cima/baixo; devolve a MESMA referência se já
// estiver no limite, pra quem chama poder detectar "nada mudou" sem duplicar
// a checagem de índice.
function mover<T>(lista: T[], indice: number, direcao: -1 | 1): T[] {
  const alvo = indice + direcao;
  if (alvo < 0 || alvo >= lista.length) return lista;
  const copia = [...lista];
  [copia[indice], copia[alvo]] = [copia[alvo], copia[indice]];
  return copia;
}

// Valida a estrutura de um quiz completo — mesmo padrão do backend
function validarQuiz(quiz: {
  titulo: string;
  notaMinimaAprovacao: number;
  perguntas: Pergunta[];
}): string | null {
  if (!quiz.titulo || quiz.titulo.trim().length === 0) {
    return "Título é obrigatório";
  }

  if (
    typeof quiz.notaMinimaAprovacao !== "number" ||
    quiz.notaMinimaAprovacao < 0 ||
    quiz.notaMinimaAprovacao > 100
  ) {
    return "Nota mínima deve ser um número entre 0 e 100";
  }

  if (!Array.isArray(quiz.perguntas) || quiz.perguntas.length === 0) {
    return "O quiz deve ter pelo menos uma pergunta";
  }

  // Valida cada pergunta
  for (let idx = 0; idx < quiz.perguntas.length; idx++) {
    const pergunta = quiz.perguntas[idx];

    if (!pergunta.enunciado || pergunta.enunciado.trim().length === 0) {
      return `Pergunta ${idx}: enunciado é obrigatório`;
    }

    if (!Array.isArray(pergunta.alternativas) || pergunta.alternativas.length < 2) {
      return `Pergunta ${idx}: deve ter pelo menos 2 alternativas`;
    }

    let totalCorretas = 0;
    for (let altIdx = 0; altIdx < pergunta.alternativas.length; altIdx++) {
      const alt = pergunta.alternativas[altIdx];

      if (!alt.texto || alt.texto.trim().length === 0) {
        return `Pergunta ${idx}, alternativa ${altIdx}: texto é obrigatório`;
      }

      if (alt.correta === true) {
        totalCorretas++;
      }
    }

    if (totalCorretas === 0) {
      return `Pergunta ${idx}: nenhuma alternativa marcada como correta`;
    } else if (totalCorretas > 1) {
      return `Pergunta ${idx}: apenas uma alternativa pode ser correta`;
    }
  }

  return null;
}

export default function EditorQuiz() {
  const { id: cursoId } = useParams<{ id: string }>();
  const { notificar } = useToast();

  const [quiz, setQuiz] = useState<Quiz | null>(undefined as any);
  const [erro, setErro] = useState<string | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [quizParaExcluir, setQuizParaExcluir] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  // Estado temporário para criar nova pergunta
  const [novaEnunciado, setNovaEnunciado] = useState("");

  const buscar = useCallback(() => {
    if (!cursoId) return;
    carregarQuizProfessor(cursoId)
      .then((dados) => {
        setQuiz(dados);
        setErro(null);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) {
          // Quiz não existe — estado de "criar novo"
          setQuiz(null);
          setErro(null);
        } else {
          setErro(mensagemErro(error, "Não foi possível carregar o quiz."));
        }
      });
  }, [cursoId]);

  useEffect(() => {
    buscar();
  }, [buscar]);

  function tentarNovamente() {
    setErro(null);
    setQuiz(undefined as any);
    buscar();
  }

  function alternarPergunta(perguntaId: string) {
    setExpandidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(perguntaId)) novo.delete(perguntaId);
      else novo.add(perguntaId);
      return novo;
    });
  }

  // Inicializa um novo quiz vazio para criar do zero
  function iniciarNovoQuiz() {
    const novoQuiz: Quiz = {
      id: "",
      cursoId: cursoId!,
      titulo: "",
      notaMinimaAprovacao: 70,
      perguntas: [],
    };
    setQuiz(novoQuiz);
  }

  function adicionarPergunta() {
    if (!quiz || !novaEnunciado.trim()) return;

    const novaPergunta: Pergunta = {
      id: `temp_${Date.now()}`, // ID temporário para UI
      quizId: quiz.id,
      enunciado: novaEnunciado,
      ordem: quiz.perguntas.length,
      alternativas: [
        { id: `alt_${Date.now()}_0`, perguntaId: "", texto: "", correta: true },
        { id: `alt_${Date.now()}_1`, perguntaId: "", texto: "", correta: false },
      ],
    };

    setQuiz({
      ...quiz,
      perguntas: [...quiz.perguntas, novaPergunta],
    });

    setExpandidos((atual) => new Set(atual).add(novaPergunta.id));
    setNovaEnunciado("");
    notificar("Pergunta adicionada.", "success");
  }

  function atualizarEnunciadoPergunta(perguntaId: string, novoEnunciado: string) {
    if (!quiz) return;
    setQuiz({
      ...quiz,
      perguntas: quiz.perguntas.map((p) =>
        p.id === perguntaId ? { ...p, enunciado: novoEnunciado } : p
      ),
    });
  }

  function removerPergunta(perguntaId: string) {
    if (!quiz) return;
    setQuiz({
      ...quiz,
      perguntas: quiz.perguntas.filter((p) => p.id !== perguntaId),
    });
  }

  function moverPergunta(indice: number, direcao: -1 | 1) {
    if (!quiz) return;
    const reordenada = mover(quiz.perguntas, indice, direcao);
    if (reordenada === quiz.perguntas) return;
    setQuiz({ ...quiz, perguntas: reordenada });
  }

  function adicionarAlternativa(perguntaId: string) {
    if (!quiz) return;
    setQuiz({
      ...quiz,
      perguntas: quiz.perguntas.map((p) => {
        if (p.id !== perguntaId) return p;
        return {
          ...p,
          alternativas: [
            ...p.alternativas,
            {
              id: `alt_${Date.now()}`,
              perguntaId: p.id,
              texto: "",
              correta: false,
            },
          ],
        };
      }),
    });
  }

  function atualizarAlternativa(
    perguntaId: string,
    altId: string,
    campo: "texto" | "correta",
    valor: string | boolean
  ) {
    if (!quiz) return;
    setQuiz({
      ...quiz,
      perguntas: quiz.perguntas.map((p) => {
        if (p.id !== perguntaId) return p;
        return {
          ...p,
          alternativas: p.alternativas.map((alt) => {
            if (alt.id !== altId) {
              // Se marcando "correta" em outra alternativa, desmarcar todas
              if (campo === "correta" && valor === true) {
                return { ...alt, correta: false };
              }
              return alt;
            }
            return { ...alt, [campo]: valor };
          }),
        };
      }),
    });
  }

  function removerAlternativa(perguntaId: string, altId: string) {
    if (!quiz) return;
    setQuiz({
      ...quiz,
      perguntas: quiz.perguntas.map((p) => {
        if (p.id !== perguntaId) return p;
        return {
          ...p,
          alternativas: p.alternativas.filter((alt) => alt.id !== altId),
        };
      }),
    });
  }

  async function salvarQuizNaApi() {
    if (!quiz || !cursoId) return;

    const erroValidacao = validarQuiz(quiz);
    if (erroValidacao) {
      notificar(erroValidacao, "critical");
      return;
    }

    setSalvando(true);
    try {
      // Prepara os dados para enviar ao backend (sem os IDs temporários)
      const dadosParaEnviar = {
        titulo: quiz.titulo.trim(),
        notaMinimaAprovacao: quiz.notaMinimaAprovacao,
        perguntas: quiz.perguntas.map((p) => ({
          enunciado: p.enunciado.trim(),
          ordem: p.ordem,
          alternativas: p.alternativas.map((alt) => ({
            texto: alt.texto.trim(),
            correta: alt.correta === true,
          })),
        })),
      };

      const quizSalvo = await salvarQuiz(cursoId, dadosParaEnviar);
      setQuiz(quizSalvo);
      notificar("Quiz salvo com sucesso.", "success");
    } catch (error) {
      notificar(mensagemErro(error, "Não foi possível salvar o quiz."), "critical");
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarExclusao() {
    if (!cursoId) return;
    setExcluindo(true);
    try {
      await deletarQuiz(cursoId);
      setQuiz(null);
      notificar("Quiz excluído.", "success");
      setQuizParaExcluir(false);
    } catch (error) {
      notificar(mensagemErro(error, "Não foi possível excluir o quiz."), "critical");
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex items-center justify-between gap-base">
        <h1 className="text-heading-lg text-ink-deep">Quiz do curso</h1>
        {quiz !== undefined && quiz !== null && (
          <Botao variante="ghost" onClick={tentarNovamente}>
            Atualizar
          </Botao>
        )}
      </div>

      {erro && (
        <Card className="flex flex-col items-start gap-base">
          <p className="text-body-md text-critical-strong">{erro}</p>
          <Botao variante="accent" onClick={tentarNovamente}>
            Tentar novamente
          </Botao>
        </Card>
      )}

      {quiz === undefined && (
        <div className="flex justify-center py-xxl">
          <Spinner />
        </div>
      )}

      {quiz === null && !erro && (
        <EstadoVazio
          titulo="Sem quiz ainda"
          descricao="Use o botão abaixo para criar o primeiro quiz deste curso."
          acao={
            <Botao variante="accent" onClick={iniciarNovoQuiz} className="mt-base">
              Criar quiz
            </Botao>
          }
        />
      )}

      {quiz && (
        <>
          {/* Formulário com título e nota mínima */}
          <Card className="flex flex-col gap-md">
            <div className="flex flex-col gap-sm lg:flex-row lg:gap-md">
              <div className="flex-1">
                <Campo
                  rotulo="Título do quiz"
                  placeholder="Ex: Avaliação de Matemática"
                  value={quiz.titulo}
                  onChange={(e) => setQuiz({ ...quiz, titulo: e.target.value })}
                />
              </div>
              <div className="w-full lg:w-40">
                <Campo
                  rotulo="Nota mínima para aprovação (%)"
                  type="number"
                  min="0"
                  max="100"
                  value={quiz.notaMinimaAprovacao}
                  onChange={(e) =>
                    setQuiz({
                      ...quiz,
                      notaMinimaAprovacao: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
            </div>
          </Card>

          {/* Perguntas */}
          <div className="flex flex-col gap-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-subtitle-lg text-ink-deep">Perguntas ({quiz.perguntas.length})</h2>
            </div>

            {quiz.perguntas.length === 0 ? (
              <p className="text-body-sm text-steel">Nenhuma pergunta ainda. Use o formulário abaixo para adicionar.</p>
            ) : (
              <div className="flex flex-col gap-sm">
                {quiz.perguntas.map((pergunta, indice) => (
                  <Acordeao
                    key={pergunta.id}
                    aberto={expandidos.has(pergunta.id)}
                    aoAlternar={() => alternarPergunta(pergunta.id)}
                    titulo={
                      <span className="text-body-sm-bold text-ink-deep">
                        Pergunta {indice + 1}: {pergunta.enunciado || "(sem enunciado)"}
                      </span>
                    }
                    acoes={
                      <div onClick={(evento) => evento.stopPropagation()} className="flex items-center gap-xs">
                        <Botao
                          variante="ghost"
                          aria-label="Mover pergunta para cima"
                          onClick={() => moverPergunta(indice, -1)}
                          disabled={indice === 0}
                        >
                          ↑
                        </Botao>
                        <Botao
                          variante="ghost"
                          aria-label="Mover pergunta para baixo"
                          onClick={() => moverPergunta(indice, 1)}
                          disabled={indice === quiz.perguntas.length - 1}
                        >
                          ↓
                        </Botao>
                        <Botao
                          variante="ghost"
                          onClick={() => removerPergunta(pergunta.id)}
                        >
                          Remover
                        </Botao>
                      </div>
                    }
                  >
                    <div className="flex flex-col gap-lg">
                      {/* Enunciado */}
                      <div>
                        <Campo
                          rotulo="Enunciado da pergunta"
                          placeholder="Digite a pergunta..."
                          value={pergunta.enunciado}
                          onChange={(e) =>
                            atualizarEnunciadoPergunta(pergunta.id, e.target.value)
                          }
                        />
                      </div>

                      {/* Alternativas */}
                      <div className="flex flex-col gap-sm">
                        <div className="flex items-center justify-between">
                          <h3 className="text-body-sm-bold text-ink-deep">Alternativas</h3>
                          <Botao
                            variante="ghost"
                            onClick={() => adicionarAlternativa(pergunta.id)}
                          >
                            + Adicionar
                          </Botao>
                        </div>

                        {pergunta.alternativas.length === 0 ? (
                          <p className="text-body-sm text-steel">Nenhuma alternativa.</p>
                        ) : (
                          <div className="flex flex-col gap-sm">
                            {pergunta.alternativas.map((alt, altIndice) => (
                              <div key={alt.id} className="flex items-end gap-sm rounded-lg border border-hairline-soft p-sm">
                                <div className="flex-1">
                                  <Campo
                                    rotulo={`Alternativa ${altIndice + 1}`}
                                    placeholder="Digite a alternativa..."
                                    value={alt.texto}
                                    onChange={(e) =>
                                      atualizarAlternativa(pergunta.id, alt.id, "texto", e.target.value)
                                    }
                                    className="mb-0"
                                  />
                                </div>

                                <div className="flex items-center gap-xs">
                                  <label className="flex items-center gap-xs cursor-pointer">
                                    <input
                                      type="radio"
                                      name={`correta_${pergunta.id}`}
                                      checked={alt.correta === true}
                                      onChange={(e) =>
                                        atualizarAlternativa(
                                          pergunta.id,
                                          alt.id,
                                          "correta",
                                          e.target.checked
                                        )
                                      }
                                      className="w-4 h-4 cursor-pointer"
                                    />
                                    <span className="text-caption text-steel">Correta</span>
                                  </label>
                                  <Botao
                                    variante="ghost"
                                    onClick={() =>
                                      removerAlternativa(pergunta.id, alt.id)
                                    }
                                    disabled={pergunta.alternativas.length <= 2}
                                    title={
                                      pergunta.alternativas.length <= 2
                                        ? "Deve ter pelo menos 2 alternativas"
                                        : undefined
                                    }
                                  >
                                    Remover
                                  </Botao>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </Acordeao>
                ))}
              </div>
            )}
          </div>

          {/* Formulário para adicionar nova pergunta */}
          <Card className="flex gap-sm items-end">
            <div className="flex-1">
              <Campo
                rotulo="Nova pergunta"
                placeholder="Digite o enunciado da pergunta..."
                value={novaEnunciado}
                onChange={(e) => setNovaEnunciado(e.target.value)}
              />
            </div>
            <Botao
              variante="accent"
              onClick={adicionarPergunta}
              disabled={!novaEnunciado.trim()}
            >
              Adicionar pergunta
            </Botao>
          </Card>

          {/* Botões de ação: salvar e excluir */}
          <div className="flex gap-sm justify-end">
            {quiz.id && (
              <Botao
                variante="perigo"
                onClick={() => setQuizParaExcluir(true)}
                disabled={salvando}
              >
                Excluir quiz
              </Botao>
            )}
            <Botao
              variante="accent"
              onClick={salvarQuizNaApi}
              disabled={salvando}
            >
              {salvando ? "Salvando..." : "Salvar quiz"}
            </Botao>
          </div>
        </>
      )}

      {/* Modal de confirmação de exclusão */}
      <Modal
        aberto={quizParaExcluir}
        aoFechar={() => setQuizParaExcluir(false)}
        titulo="Excluir quiz"
      >
        <div className="flex flex-col gap-lg">
          <p className="text-body-md text-ink">
            Tem certeza que deseja excluir este quiz? Todas as tentativas dos alunos serão mantidas,
            mas o quiz não poderá ser respondido novamente. Essa ação não pode ser desfeita.
          </p>
          <div className="flex justify-end gap-sm">
            <Botao
              variante="ghost"
              onClick={() => setQuizParaExcluir(false)}
              disabled={excluindo}
            >
              Cancelar
            </Botao>
            <Botao
              variante="perigo"
              onClick={confirmarExclusao}
              disabled={excluindo}
            >
              {excluindo ? "Excluindo..." : "Excluir"}
            </Botao>
          </div>
        </div>
      </Modal>
    </div>
  );
}
