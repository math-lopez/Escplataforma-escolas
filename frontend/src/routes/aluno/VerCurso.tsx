import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Acordeao } from "../../components/Acordeao";
import { Badge } from "../../components/Badge";
import { Botao } from "../../components/Botao";
import { Card } from "../../components/Card";
import { EstadoVazio } from "../../components/EstadoVazio";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/useToast";
import {
  buscarCursoMatriculado,
  buscarMaterialAula,
  desmarcarAulaConcluida,
  marcarAulaConcluida,
  emitirCertificado,
} from "../../features/aluno/api";
import type { Aula, CursoDetalhado, Modulo, ErroEmissaoCertificado } from "../../features/aluno/tipos";
import { ApiError } from "../../lib/api";

function mensagemErro(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function VerCurso() {
  const { cursoId } = useParams<{ cursoId: string }>();
  const { notificar } = useToast();

  const [curso, setCurso] = useState<CursoDetalhado | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [aulaAtualId, setAulaAtualId] = useState<string | null>(null);

  const [concluindo, setConcluindo] = useState(false);
  const [abrindoMaterial, setAbrindoMaterial] = useState(false);
  const [emitindoCertificado, setEmitindoCertificado] = useState(false);
  const [certificadoCodigo, setCertificadoCodigo] = useState<string | null>(null);
  const [certificadoErro, setCertificadoErro] = useState<string | null>(null);
  const [certificadoDetalhesErro, setCertificadoDetalhesErro] = useState<ErroEmissaoCertificado | null>(null);

  const buscar = useCallback(() => {
    if (!cursoId) return;
    buscarCursoMatriculado(cursoId)
      .then((dados) => {
        setCurso(dados);
        setErro(null);

        // Expande o primeiro módulo por padrão
        if (dados.modulos.length > 0) {
          setExpandidos(new Set([dados.modulos[0].id]));
          if (dados.modulos[0].aulas.length > 0) {
            setAulaAtualId(dados.modulos[0].aulas[0].id);
          }
        }
      })
      .catch((error: unknown) =>
        setErro(mensagemErro(error, "Não foi possível carregar o curso."))
      );
  }, [cursoId]);

  useEffect(() => {
    buscar();
  }, [buscar]);

  function tentarNovamente() {
    setErro(null);
    setCurso(null);
    buscar();
  }

  async function abrirMaterialPdf(aulaId: string) {
    setAbrindoMaterial(true);

    // Abre a aba ANTES do await, enquanto ainda estamos na pilha do gesto do
    // usuário — depois do await o navegador bloqueia a abertura como pop-up.
    const aba = window.open("about:blank", "_blank");

    try {
      const { url } = await buscarMaterialAula(aulaId);

      if (aba) {
        // Recupera a proteção que o "noopener" daria (sem isso, a página
        // aberta teria referência à janela original)
        aba.opener = null;
        // location.replace evita deixar "about:blank" no histórico
        aba.location.replace(url);
        notificar("Material aberto em uma nova aba.", "success");
      } else {
        // O navegador bloqueou a abertura mesmo assim
        notificar(
          "Seu navegador bloqueou a abertura de uma nova aba. Libere pop-ups para este site.",
          "critical"
        );
      }
    } catch (error) {
      // Fecha a aba em branco se a busca falhar
      aba?.close();

      const mensagem =
        error instanceof ApiError && error.status === 404
          ? "Esta aula não possui material disponível."
          : mensagemErro(error, "Não foi possível abrir o material.");
      notificar(mensagem, "critical");
    } finally {
      setAbrindoMaterial(false);
    }
  }

  function alternarModulo(id: string) {
    setExpandidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  async function toggleConcluirAula(aula: Aula) {
    setConcluindo(true);
    try {
      if (aula.concluida) {
        await desmarcarAulaConcluida(aula.id);
        notificar("Aula desmarcada.", "success");
      } else {
        await marcarAulaConcluida(aula.id);
        notificar("Aula marcada como concluída.", "success");
      }

      // Atualiza o estado local
      setCurso((atual) => {
        if (!atual) return atual;
        const modulosAtualizados = atual.modulos.map((modulo) => ({
          ...modulo,
          aulas: modulo.aulas.map((a) =>
            a.id === aula.id ? { ...a, concluida: !a.concluida } : a
          ),
        }));
        return { ...atual, modulos: modulosAtualizados };
      });
    } catch (error) {
      notificar(
        mensagemErro(error, "Não foi possível atualizar a aula."),
        "critical"
      );
    } finally {
      setConcluindo(false);
    }
  }

  async function solicitarCertificado() {
    if (!cursoId) return;
    setEmitindoCertificado(true);
    setCertificadoErro(null);
    setCertificadoDetalhesErro(null);
    setCertificadoCodigo(null);

    try {
      const certificado = await emitirCertificado(cursoId);
      setCertificadoCodigo(certificado.codigoValidacao);
      notificar("Certificado emitido com sucesso!", "success");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const detalhes = error.data as unknown as ErroEmissaoCertificado;
        setCertificadoDetalhesErro(detalhes);
        setCertificadoErro(detalhes.erro);
      } else {
        const mensagem = mensagemErro(error, "Não foi possível emitir o certificado.");
        setCertificadoErro(mensagem);
      }
    } finally {
      setEmitindoCertificado(false);
    }
  }

  function copiarCodigo() {
    if (!certificadoCodigo) return;
    navigator.clipboard.writeText(certificadoCodigo);
    notificar("Código copiado!", "success");
  }

  function encontrarAulaAtual(): Aula | null {
    if (!curso) return null;
    for (const modulo of curso.modulos) {
      const aula = modulo.aulas.find((a) => a.id === aulaAtualId);
      if (aula) return aula;
    }
    return null;
  }

  function encontrarIndicesAula(aulaId: string): {
    modulo: Modulo;
    indice: number;
  } | null {
    if (!curso) return null;
    for (const modulo of curso.modulos) {
      const indice = modulo.aulas.findIndex((a) => a.id === aulaId);
      if (indice !== -1) return { modulo, indice };
    }
    return null;
  }

  function selecionarAula(aulaId: string) {
    setAulaAtualId(aulaId);
  }

  function proximaAula() {
    if (!aulaAtualId) return;
    const encontrado = encontrarIndicesAula(aulaAtualId);
    if (!encontrado) return;

    const { modulo, indice } = encontrado;
    if (indice < modulo.aulas.length - 1) {
      setAulaAtualId(modulo.aulas[indice + 1].id);
      return;
    }

    // Procura no próximo módulo
    const indiceModulo = curso!.modulos.findIndex((m) => m.id === modulo.id);
    if (indiceModulo < curso!.modulos.length - 1) {
      const proximoModulo = curso!.modulos[indiceModulo + 1];
      if (proximoModulo.aulas.length > 0) {
        setAulaAtualId(proximoModulo.aulas[0].id);
        setExpandidos((atual) => {
          const novo = new Set(atual);
          novo.add(proximoModulo.id);
          return novo;
        });
      }
    }
  }

  function aulaAnterior() {
    if (!aulaAtualId) return;
    const encontrado = encontrarIndicesAula(aulaAtualId);
    if (!encontrado) return;

    const { modulo, indice } = encontrado;
    if (indice > 0) {
      setAulaAtualId(modulo.aulas[indice - 1].id);
      return;
    }

    // Procura no módulo anterior
    const indiceModulo = curso!.modulos.findIndex((m) => m.id === modulo.id);
    if (indiceModulo > 0) {
      const moduloAnterior = curso!.modulos[indiceModulo - 1];
      if (moduloAnterior.aulas.length > 0) {
        setAulaAtualId(moduloAnterior.aulas[moduloAnterior.aulas.length - 1].id);
        setExpandidos((atual) => {
          const novo = new Set(atual);
          novo.add(moduloAnterior.id);
          return novo;
        });
      }
    }
  }

  if (erro) {
    return (
      <div className="flex flex-col gap-lg">
        <h1 className="text-heading-lg text-ink-deep">Curso</h1>
        <Card className="flex flex-col items-start gap-base">
          <p className="text-body-md text-critical-strong">{erro}</p>
          <Botao variante="accent" onClick={tentarNovamente}>
            Tentar novamente
          </Botao>
        </Card>
      </div>
    );
  }

  if (curso === null) {
    return (
      <div className="flex justify-center py-xxl">
        <Spinner />
      </div>
    );
  }

  if (curso.modulos.length === 0) {
    return (
      <div className="flex flex-col gap-lg">
        <h1 className="text-heading-lg text-ink-deep">{curso.titulo}</h1>
        <EstadoVazio
          titulo="Sem aulas ainda"
          descricao="Este curso ainda não possui módulos e aulas."
        />
      </div>
    );
  }

  const aulaAtual = encontrarAulaAtual();

  return (
    <div className="flex flex-col gap-lg">
      <h1 className="text-heading-lg text-ink-deep">{curso.titulo}</h1>

      <div className="flex flex-col gap-lg lg:flex-row lg:gap-xl">
        {/* Painel esquerdo: módulos e aulas */}
        <div className="flex flex-col gap-sm lg:w-72 lg:shrink-0">
          {curso.modulos.map((modulo) => (
            <Acordeao
              key={modulo.id}
              titulo={
                <span className="text-body-sm-bold text-ink-deep">
                  {modulo.titulo}
                </span>
              }
              aberto={expandidos.has(modulo.id)}
              aoAlternar={() => alternarModulo(modulo.id)}
            >
              <div className="flex flex-col gap-xs">
                {modulo.aulas.map((aula) => {
                  const selecionada = aula.id === aulaAtualId;
                  return (
                    <button
                      key={aula.id}
                      onClick={() => selecionarAula(aula.id)}
                      className={`flex items-start gap-xs rounded-lg px-md py-sm text-left transition-colors ${
                        selecionada
                          ? "bg-primary/10 text-ink-deep"
                          : "hover:bg-surface-soft text-ink"
                      }`}
                    >
                      <div className="flex flex-col gap-xxs flex-1 min-w-0">
                        <span className="text-body-sm-bold text-inherit">
                          {aula.titulo}
                        </span>
                        {aula.duracaoEstimadaMin && (
                          <span className="text-caption text-steel">
                            {aula.duracaoEstimadaMin} min
                          </span>
                        )}
                      </div>
                      {aula.concluida && (
                        <Badge variante="success" className="shrink-0">
                          ✓
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </Acordeao>
          ))}
        </div>

        {/* Painel direito: conteúdo da aula */}
        {aulaAtual && (
          <div className="flex flex-col gap-lg flex-1">
            <div className="flex items-start justify-between gap-base">
              <div className="flex flex-col gap-xs flex-1">
                <h2 className="text-heading-sm text-ink-deep">
                  {aulaAtual.titulo}
                </h2>
                {aulaAtual.duracaoEstimadaMin && (
                  <p className="text-body-sm text-steel">
                    Duração: {aulaAtual.duracaoEstimadaMin} minutos
                  </p>
                )}
              </div>
              <Botao
                variante={aulaAtual.concluida ? "secondary" : "accent"}
                onClick={() => toggleConcluirAula(aulaAtual)}
                disabled={concluindo}
              >
                {concluindo
                  ? "Atualizando..."
                  : aulaAtual.concluida
                    ? "Desmarcar"
                    : "Marcar como concluída"}
              </Botao>
            </div>

            {/* Renderiza o conteúdo conforme o tipo */}
            <Card className="flex flex-col gap-lg">
              {aulaAtual.tipo === "texto" && aulaAtual.conteudoTexto && (
                <div className="whitespace-pre-wrap text-body-md text-ink">
                  {aulaAtual.conteudoTexto}
                </div>
              )}

              {aulaAtual.tipo === "video" && (
                <>
                  {aulaAtual.videoStatus === "processando" && (
                    <div className="flex items-center gap-sm">
                      <Badge variante="attention">Processando</Badge>
                      <p className="text-body-sm text-steel">
                        O vídeo está sendo processado. Tente novamente em alguns
                        instantes.
                      </p>
                    </div>
                  )}
                  {aulaAtual.videoStatus === "erro" && (
                    <div className="flex items-center gap-sm">
                      <Badge variante="critical">Erro</Badge>
                      <p className="text-body-sm text-steel">
                        Houve um problema ao processar o vídeo.
                      </p>
                    </div>
                  )}
                  {aulaAtual.videoStatus === "pronto" &&
                    aulaAtual.videoEmbedUrl && (
                      <div className="aspect-video w-full rounded-lg overflow-hidden bg-ink-deep">
                        <iframe
                          src={aulaAtual.videoEmbedUrl}
                          title={aulaAtual.titulo}
                          className="w-full h-full border-none"
                          allowFullScreen
                          allow="autoplay; fullscreen; picture-in-picture"
                        />
                      </div>
                    )}
                  {!aulaAtual.videoEmbedUrl && (
                    <p className="text-body-sm text-steel">
                      O vídeo não está disponível.
                    </p>
                  )}
                </>
              )}

              {aulaAtual.tipo === "ao_vivo" && aulaAtual.conteudoUrl && (
                <a
                  href={aulaAtual.conteudoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-sm text-primary hover:text-primary-deep transition-colors"
                >
                  <span className="text-link-md">Acessar aula ao vivo</span>
                  <span aria-hidden="true">↗</span>
                </a>
              )}

              {aulaAtual.tipo === "pdf" && (
                <Botao
                  variante="accent"
                  onClick={() => abrirMaterialPdf(aulaAtual.id)}
                  disabled={abrindoMaterial}
                >
                  {abrindoMaterial ? "Abrindo material..." : "Abrir material"}
                </Botao>
              )}
            </Card>

            {/* Navegação entre aulas */}
            {(() => {
              const indices = encontrarIndicesAula(aulaAtual.id);
              const temAulaAnterior =
                indices &&
                !(
                  indices.indice === 0 &&
                  curso.modulos[0].id === indices.modulo.id
                );

              const temProximaAula =
                indices &&
                !(
                  indices.modulo.id === curso.modulos[curso.modulos.length - 1].id &&
                  indices.indice === indices.modulo.aulas.length - 1
                );

              return (
                <div className="flex gap-sm justify-between">
                  <Botao
                    variante="ghost"
                    onClick={aulaAnterior}
                    disabled={!temAulaAnterior}
                  >
                    ← Aula anterior
                  </Botao>
                  <Botao
                    variante="ghost"
                    onClick={proximaAula}
                    disabled={!temProximaAula}
                  >
                    Próxima aula →
                  </Botao>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Seção de certificado */}
      <div className="mt-xl">
        {certificadoCodigo ? (
          <Card className="flex flex-col gap-lg">
            <div className="flex items-start gap-base">
              <Badge variante="success">✓</Badge>
              <div className="flex flex-col gap-xs flex-1">
                <h3 className="text-body-md-bold text-ink-deep">Certificado emitido</h3>
                <p className="text-body-sm text-steel">
                  Seu certificado foi gerado com sucesso.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-sm">
              <div className="flex flex-col gap-xs">
                <label className="text-caption-bold text-ink-deep">Código de validação</label>
                <div className="flex gap-sm items-center">
                  <code className="flex-1 px-md py-sm bg-surface-soft rounded-lg text-body-md-bold text-ink-deep font-mono">
                    {certificadoCodigo}
                  </code>
                  <Botao variante="secondary" onClick={copiarCodigo}>
                    Copiar
                  </Botao>
                </div>
              </div>

              <div className="flex flex-col gap-xs">
                <label className="text-caption-bold text-ink-deep">Link de validação pública</label>
                <a
                  href={`/validar/${certificadoCodigo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary-deep transition-colors text-link-md"
                >
                  {`${window.location.origin}/validar/${certificadoCodigo}`}
                </a>
              </div>
            </div>
          </Card>
        ) : certificadoDetalhesErro ? (
          <Card className="flex flex-col gap-lg">
            <div className="flex items-start gap-base">
              <Badge variante="attention">!</Badge>
              <div className="flex flex-col gap-xs flex-1">
                <h3 className="text-body-md-bold text-ink-deep">Curso não concluído</h3>
                <p className="text-body-sm text-steel">
                  {certificadoDetalhesErro.erro}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-sm">
              {certificadoDetalhesErro.totalAulas > 0 && (
                <div className="flex flex-col gap-xs">
                  <span className="text-body-sm text-steel">
                    Aulas concluídas: {certificadoDetalhesErro.aulasConcluidas} de {certificadoDetalhesErro.totalAulas}
                  </span>
                </div>
              )}
              {!certificadoDetalhesErro.quizAprovado && (
                <div className="flex flex-col gap-xs">
                  <span className="text-body-sm text-steel">
                    Você ainda precisa ser aprovado no quiz do curso.
                  </span>
                </div>
              )}
            </div>
          </Card>
        ) : certificadoErro ? (
          <Card className="flex flex-col gap-base">
            <p className="text-body-md text-critical-strong">{certificadoErro}</p>
          </Card>
        ) : (
          <Card className="flex flex-col gap-lg">
            <div className="flex flex-col gap-xs">
              <h3 className="text-body-md-bold text-ink-deep">Solicitar certificado</h3>
              <p className="text-body-sm text-steel">
                Quando terminar o curso, gere seu certificado de conclusão.
              </p>
            </div>
            <Botao
              variante="accent"
              onClick={solicitarCertificado}
              disabled={emitindoCertificado}
            >
              {emitindoCertificado ? "Gerando..." : "Gerar certificado"}
            </Botao>
          </Card>
        )}
      </div>
    </div>
  );
}
