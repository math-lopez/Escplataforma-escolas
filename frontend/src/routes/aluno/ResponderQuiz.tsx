import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Botao } from "../../components/Botao";
import { Card } from "../../components/Card";
import { EstadoVazio } from "../../components/EstadoVazio";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/useToast";
import {
  carregarQuizAluno,
  submeterTentativa,
  listarTentativas,
} from "../../features/quiz/quizApi";
import type { Quiz, TentativaQuiz, ResultadoTentativa } from "../../features/quiz/tipos";
import { ApiError } from "../../lib/api";

function mensagemErro(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function formatarData(dataIso: string): string {
  return new Date(dataIso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ResponderQuiz() {
  const { cursoId } = useParams<{ cursoId: string }>();
  const { notificar } = useToast();

  const [quiz, setQuiz] = useState<Quiz | null>(undefined as any);
  const [tentativas, setTentativas] = useState<TentativaQuiz[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Estado do quiz em progresso
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoTentativa | null>(null);

  const buscar = useCallback(() => {
    if (!cursoId) return;

    Promise.all([
      carregarQuizAluno(cursoId)
        .then((dados) => setQuiz(dados))
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 404) {
            setQuiz(null);
          } else {
            throw error;
          }
        }),

      listarTentativas(cursoId)
        .then((dados) => setTentativas(dados))
        .catch((error: unknown) => {
          // Se não conseguir carregar tentativas, continua mesmo assim
          console.error("Erro ao carregar tentativas:", error);
          setTentativas([]);
        }),
    ]).catch((error: unknown) => {
      setErro(mensagemErro(error, "Não foi possível carregar o quiz."));
    });
  }, [cursoId]);

  useEffect(() => {
    buscar();
  }, [buscar]);

  function tentarNovamente() {
    setErro(null);
    setQuiz(undefined as any);
    setResultado(null);
    buscar();
  }

  function alterarResposta(perguntaId: string, alternativaId: string) {
    setRespostas({
      ...respostas,
      [perguntaId]: alternativaId,
    });
  }

  async function handleSubmeter() {
    if (!quiz || !cursoId) return;

    // Validação: todas as perguntas respondidas
    const perguntasNaoRespondidas = quiz.perguntas.filter(
      (p) => !respostas[p.id]
    );

    if (perguntasNaoRespondidas.length > 0) {
      notificar(
        `Por favor, responda todas as ${perguntasNaoRespondidas.length} pergunta(s) antes de enviar.`,
        "critical"
      );
      return;
    }

    setEnviando(true);
    try {
      const resultado = await submeterTentativa(cursoId, respostas);
      setResultado(resultado);
      notificar(
        resultado.aprovado ? "Quiz aprovado!" : "Quiz respondido.",
        resultado.aprovado ? "success" : "neutro"
      );
    } catch (error) {
      notificar(
        mensagemErro(error, "Não foi possível submeter o quiz."),
        "critical"
      );
    } finally {
      setEnviando(false);
    }
  }

  // Detecta se o aluno foi aprovado em qualquer tentativa anterior
  const aprovado = tentativas && tentativas.some((t) => t.aprovado);

  return (
    <div className="flex flex-col gap-lg">
      <h1 className="text-heading-lg text-ink-deep">Quiz</h1>

      {erro && (
        <Card className="flex flex-col items-start gap-base">
          <p className="text-body-md text-critical-strong">{erro}</p>
          <Botao variante="accent" onClick={tentarNovamente}>
            Tentar novamente
          </Botao>
        </Card>
      )}

      {quiz === undefined && !erro && (
        <div className="flex justify-center py-xxl">
          <Spinner />
        </div>
      )}

      {quiz === null && !erro && (
        <EstadoVazio
          titulo="Sem quiz"
          descricao="Este curso não possui um quiz para você responder."
        />
      )}

      {quiz && (
        <>
          {/* Mostrar resultado se ja foi submetido */}
          {resultado && (
            <Card className="flex flex-col gap-md bg-surface-soft rounded-xl p-lg border border-hairline-soft">
              <h2 className="text-heading-sm text-ink-deep">
                {resultado.aprovado ? "✓ Aprovado!" : "Quiz respondido"}
              </h2>
              <div className="grid grid-cols-2 gap-md sm:grid-cols-4">
                <div className="flex flex-col gap-xs">
                  <p className="text-caption text-steel">Nota</p>
                  <p className="text-heading-sm text-ink-deep">
                    {resultado.nota.toFixed(1)}%
                  </p>
                </div>
                <div className="flex flex-col gap-xs">
                  <p className="text-caption text-steel">Acertos</p>
                  <p className="text-heading-sm text-ink-deep">
                    {resultado.acertos}/{resultado.totalPerguntas}
                  </p>
                </div>
                <div className="flex flex-col gap-xs">
                  <p className="text-caption text-steel">Status</p>
                  <p className={`text-body-sm-bold ${resultado.aprovado ? "text-success" : "text-attention"}`}>
                    {resultado.aprovado ? "Aprovado" : "Não aprovado"}
                  </p>
                </div>
                <div className="flex flex-col gap-xs">
                  <p className="text-caption text-steel">Finalizado em</p>
                  <p className="text-caption text-ink">
                    {formatarData(resultado.finalizadaEm)}
                  </p>
                </div>
              </div>
              <div className="flex gap-sm">
                <Botao
                  variante="accent"
                  onClick={() => {
                    setResultado(null);
                    setRespostas({});
                  }}
                  disabled={enviando}
                >
                  Responder novamente
                </Botao>
              </div>
            </Card>
          )}

          {/* Mostrar aviso se já foi aprovado em tentativa anterior */}
          {!resultado && aprovado && (
            <Card className="border-l-4 border-success bg-surface-soft flex flex-col gap-xs p-md">
              <p className="text-body-sm-bold text-success">Já aprovado</p>
              <p className="text-body-sm text-ink">
                Você já foi aprovado neste quiz. Pode responder novamente se quiser melhorar sua nota.
              </p>
            </Card>
          )}

          {/* Formulário do quiz (não mostrar se já foi submetido) */}
          {!resultado && quiz && (
            <>
              <Card className="flex flex-col gap-sm bg-surface-soft border border-hairline-soft rounded-xl p-md">
                <p className="text-body-sm-bold text-ink-deep">{quiz.titulo}</p>
                <p className="text-caption text-steel">
                  Nota mínima para aprovação: {quiz.notaMinimaAprovacao}%
                </p>
                <p className="text-caption text-steel">
                  {quiz.perguntas.length} pergunta(s)
                </p>
              </Card>

              {/* Perguntas */}
              <div className="flex flex-col gap-lg">
                {quiz.perguntas.map((pergunta, indice) => {
                  const respondida = !!respostas[pergunta.id];
                  return (
                    <Card
                      key={pergunta.id}
                      className={`p-lg border-l-4 ${
                        respondida
                          ? "border-l-primary bg-primary/5"
                          : "border-l-hairline"
                      }`}
                    >
                      <div className="flex flex-col gap-md">
                        <div className="flex items-start gap-sm">
                          <span className="text-heading-sm text-ink-deep font-bold">
                            {indice + 1}.
                          </span>
                          <p className="text-body-md text-ink-deep">
                            {pergunta.enunciado}
                          </p>
                        </div>

                        {/* Alternativas como radio buttons */}
                        <fieldset className="flex flex-col gap-sm">
                          <legend className="sr-only">
                            Escolha a resposta
                          </legend>
                          {pergunta.alternativas.map((alt) => (
                            <label
                              key={alt.id}
                              className="flex items-center gap-sm p-sm rounded-lg hover:bg-surface-soft cursor-pointer transition-colors"
                            >
                              <input
                                type="radio"
                                name={`pergunta_${pergunta.id}`}
                                value={alt.id}
                                checked={respostas[pergunta.id] === alt.id}
                                onChange={() =>
                                  alterarResposta(pergunta.id, alt.id)
                                }
                                className="w-4 h-4 cursor-pointer"
                              />
                              <span className="text-body-md text-ink flex-1">
                                {alt.texto}
                              </span>
                            </label>
                          ))}
                        </fieldset>
                      </div>
                    </Card>
                  );
                })}
              </div>

              {/* Botão de envio */}
              <div className="flex gap-sm justify-end">
                <Botao
                  variante="accent"
                  onClick={handleSubmeter}
                  disabled={
                    enviando ||
                    Object.keys(respostas).length !== quiz.perguntas.length
                  }
                >
                  {enviando
                    ? "Enviando..."
                    : `Enviar (${Object.keys(respostas).length}/${quiz.perguntas.length} respondidas)`}
                </Botao>
              </div>
            </>
          )}

          {/* Histórico de tentativas */}
          {tentativas && tentativas.length > 0 && (
            <div className="flex flex-col gap-md">
              <h2 className="text-heading-sm text-ink-deep">
                Histórico de tentativas
              </h2>
              <div className="flex flex-col gap-sm">
                {tentativas.map((tentativa, indice) => (
                  <Card
                    key={tentativa.id}
                    className={`p-md border-l-4 ${
                      tentativa.aprovado
                        ? "border-l-success bg-success/5"
                        : "border-l-attention bg-attention/5"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-md">
                      <div className="flex flex-col gap-xs flex-1">
                        <p className="text-body-sm-bold text-ink-deep">
                          Tentativa {tentativas.length - indice}
                        </p>
                        <p className="text-caption text-steel">
                          {formatarData(tentativa.finalizadaEm || "")}
                        </p>
                      </div>
                      <div className="flex items-end gap-md">
                        <div className="text-right">
                          <p className="text-caption text-steel">Nota</p>
                          <p
                            className={`text-body-md-bold ${
                              tentativa.aprovado
                                ? "text-success"
                                : "text-attention"
                            }`}
                          >
                            {tentativa.nota !== null
                              ? tentativa.nota.toFixed(1) + "%"
                              : "—"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-caption text-steel">Status</p>
                          <p
                            className={`text-caption-bold ${
                              tentativa.aprovado
                                ? "text-success"
                                : "text-attention"
                            }`}
                          >
                            {tentativa.aprovado
                              ? "Aprovado"
                              : "Não aprovado"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
