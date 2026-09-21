import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Acordeao } from "../../components/Acordeao";
import { Badge } from "../../components/Badge";
import { Botao } from "../../components/Botao";
import { Campo } from "../../components/Campo";
import { Card } from "../../components/Card";
import { EstadoVazio } from "../../components/EstadoVazio";
import { Modal } from "../../components/Modal";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/useToast";
import {
  atualizarModulo,
  criarModulo,
  excluirAula,
  excluirModulo,
  listarModulos,
  reordenarAulas,
  reordenarModulos,
} from "../../features/cursos/conteudoApi";
import type { Aula, Modulo, TipoAula } from "../../features/cursos/tiposConteudo";
import { ApiError } from "../../lib/api";
import { AulaFormulario } from "./AulaFormulario";

function mensagemErro(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

const ROTULO_TIPO: Record<TipoAula, string> = {
  video: "Vídeo",
  texto: "Texto",
  pdf: "PDF",
  ao_vivo: "Ao vivo",
};

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

export default function EditorConteudo() {
  const { id: cursoId } = useParams<{ id: string }>();
  const { notificar } = useToast();

  // `modulos === null` é "carregando" — distinto de `[]` (curso sem módulo
  // ainda), mesmo padrão usado em ListaCursos.
  const [modulos, setModulos] = useState<Modulo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  const [tituloNovoModulo, setTituloNovoModulo] = useState("");
  const [criandoModulo, setCriandoModulo] = useState(false);

  const [moduloEditando, setModuloEditando] = useState<string | null>(null);
  const [tituloEditando, setTituloEditando] = useState("");
  const [salvandoModulo, setSalvandoModulo] = useState(false);

  const [moduloParaExcluir, setModuloParaExcluir] = useState<Modulo | null>(null);
  const [excluindoModulo, setExcluindoModulo] = useState(false);

  const [aulaParaExcluir, setAulaParaExcluir] = useState<{ moduloId: string; aula: Aula } | null>(null);
  const [excluindoAula, setExcluindoAula] = useState(false);

  const [modalAula, setModalAula] = useState<{ moduloId: string; aula: Aula | null } | null>(null);

  const buscar = useCallback(() => {
    if (!cursoId) return;
    listarModulos(cursoId)
      .then((dados) => {
        setModulos(dados);
        setErro(null);
      })
      .catch((error: unknown) => setErro(mensagemErro(error, "Não foi possível carregar os módulos.")));
  }, [cursoId]);

  useEffect(() => {
    buscar();
  }, [buscar]);

  function tentarNovamente() {
    setErro(null);
    setModulos(null);
    buscar();
  }

  function alternarModulo(id: string) {
    setExpandidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  async function handleCriarModulo(event: FormEvent) {
    event.preventDefault();
    if (!cursoId) return;
    const tituloLimpo = tituloNovoModulo.trim();
    if (!tituloLimpo) return;
    setCriandoModulo(true);
    try {
      const modulo = await criarModulo(cursoId, tituloLimpo);
      setModulos((atual) => [...(atual ?? []), modulo]);
      setExpandidos((atual) => new Set(atual).add(modulo.id));
      setTituloNovoModulo("");
      notificar("Módulo criado.", "success");
    } catch (error) {
      notificar(mensagemErro(error, "Não foi possível criar o módulo."), "critical");
    } finally {
      setCriandoModulo(false);
    }
  }

  function iniciarRenomeacao(modulo: Modulo) {
    setModuloEditando(modulo.id);
    setTituloEditando(modulo.titulo);
  }

  async function salvarRenomeacao(modulo: Modulo) {
    const tituloLimpo = tituloEditando.trim();
    if (!tituloLimpo) return;
    setSalvandoModulo(true);
    try {
      const atualizado = await atualizarModulo(modulo.id, tituloLimpo);
      setModulos(
        (atual) => atual?.map((m) => (m.id === modulo.id ? { ...m, titulo: atualizado.titulo } : m)) ?? null,
      );
      setModuloEditando(null);
      notificar("Módulo renomeado.", "success");
    } catch (error) {
      notificar(mensagemErro(error, "Não foi possível renomear o módulo."), "critical");
    } finally {
      setSalvandoModulo(false);
    }
  }

  async function confirmarExclusaoModulo() {
    if (!moduloParaExcluir) return;
    setExcluindoModulo(true);
    try {
      await excluirModulo(moduloParaExcluir.id);
      setModulos((atual) => atual?.filter((m) => m.id !== moduloParaExcluir.id) ?? null);
      notificar("Módulo excluído.", "success");
      setModuloParaExcluir(null);
    } catch (error) {
      notificar(mensagemErro(error, "Não foi possível excluir o módulo."), "critical");
    } finally {
      setExcluindoModulo(false);
    }
  }

  // Otimista: reordena local na hora, some pra ordem do servidor se ele
  // discordar, e desfaz se a chamada falhar — igual ao padrão de exclusão do
  // ListaCursos, só que com um passo a mais de reconciliação.
  async function moverModulo(indice: number, direcao: -1 | 1) {
    if (!modulos || !cursoId) return;
    const reordenada = mover(modulos, indice, direcao);
    if (reordenada === modulos) return;
    setModulos(reordenada);
    try {
      const atualizados = await reordenarModulos(
        cursoId,
        reordenada.map((m) => m.id),
      );
      setModulos(atualizados);
    } catch (error) {
      setModulos(modulos);
      notificar(mensagemErro(error, "Não foi possível reordenar os módulos."), "critical");
    }
  }

  async function moverAula(modulo: Modulo, indice: number, direcao: -1 | 1) {
    const reordenada = mover(modulo.aulas, indice, direcao);
    if (reordenada === modulo.aulas) return;
    const anterior = modulo.aulas;
    setModulos((atual) => atual?.map((m) => (m.id === modulo.id ? { ...m, aulas: reordenada } : m)) ?? null);
    try {
      const atualizadas = await reordenarAulas(
        modulo.id,
        reordenada.map((a) => a.id),
      );
      setModulos((atual) => atual?.map((m) => (m.id === modulo.id ? { ...m, aulas: atualizadas } : m)) ?? null);
    } catch (error) {
      setModulos((atual) => atual?.map((m) => (m.id === modulo.id ? { ...m, aulas: anterior } : m)) ?? null);
      notificar(mensagemErro(error, "Não foi possível reordenar as aulas."), "critical");
    }
  }

  function aoSalvarAula(moduloId: string, aula: Aula) {
    setModulos(
      (atual) =>
        atual?.map((m) => {
          if (m.id !== moduloId) return m;
          const existe = m.aulas.some((a) => a.id === aula.id);
          return {
            ...m,
            aulas: existe ? m.aulas.map((a) => (a.id === aula.id ? aula : a)) : [...m.aulas, aula],
          };
        }) ?? null,
    );
    setModalAula({ moduloId, aula });
    notificar("Aula salva.", "success");
  }

  // Depois do upload não sabemos com certeza o formato exato que o backend vai
  // devolver para o estado final (conteudoUrl do PDF, videoStatus/videoExternoId
  // do vídeo) — em vez de supor campos extras na resposta do upload,
  // recarregamos a lista inteira, que já é a fonte da verdade.
  function aoConcluirUpload() {
    notificar("Arquivo enviado.", "success");
    buscar();
  }

  async function confirmarExclusaoAula() {
    if (!aulaParaExcluir) return;
    setExcluindoAula(true);
    try {
      await excluirAula(aulaParaExcluir.aula.id);
      setModulos(
        (atual) =>
          atual?.map((m) =>
            m.id === aulaParaExcluir.moduloId
              ? { ...m, aulas: m.aulas.filter((a) => a.id !== aulaParaExcluir.aula.id) }
              : m,
          ) ?? null,
      );
      notificar("Aula excluída.", "success");
      setAulaParaExcluir(null);
    } catch (error) {
      notificar(mensagemErro(error, "Não foi possível excluir a aula."), "critical");
    } finally {
      setExcluindoAula(false);
    }
  }

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex items-center justify-between gap-base">
        <div className="flex flex-col gap-xxs">
          <Link to="/cursos" className="text-body-sm-bold text-steel hover:text-ink-deep">
            ← Voltar para cursos
          </Link>
          <h1 className="text-heading-lg text-ink-deep">Conteúdo do curso</h1>
        </div>
        {/* O editor de quiz não tinha nenhuma entrada na interface: a rota existia mas só era
            alcançável digitando a URL. Fica aqui porque montar a prova é a continuação natural
            de montar o conteúdo — o professor termina os módulos e cria a avaliação em seguida. */}
        <div className="flex items-center gap-xs">
          <Link to={`/cursos/${cursoId}/quiz`}>
            <Botao variante="secondary">Avaliação</Botao>
          </Link>
          {!erro && modulos !== null && (
            <Botao variante="ghost" onClick={tentarNovamente}>
              Atualizar
            </Botao>
          )}
        </div>
      </div>

      {erro && (
        <Card className="flex flex-col items-start gap-base">
          <p className="text-body-md text-critical-strong">{erro}</p>
          <Botao variante="accent" onClick={tentarNovamente}>
            Tentar novamente
          </Botao>
        </Card>
      )}

      {!erro && modulos === null && (
        <div className="flex justify-center py-xxl">
          <Spinner />
        </div>
      )}

      {!erro && modulos !== null && (
        <>
          <Card>
            <form onSubmit={handleCriarModulo} className="flex items-end gap-sm">
              <div className="flex-1">
                <Campo
                  rotulo="Novo módulo"
                  placeholder="Título do módulo"
                  value={tituloNovoModulo}
                  onChange={(e) => setTituloNovoModulo(e.target.value)}
                />
              </div>
              <Botao variante="accent" type="submit" disabled={criandoModulo || !tituloNovoModulo.trim()}>
                {criandoModulo ? "Criando..." : "Adicionar módulo"}
              </Botao>
            </form>
          </Card>

          {modulos.length === 0 ? (
            <EstadoVazio
              titulo="Nenhum módulo ainda"
              descricao="Use o campo acima para criar o primeiro módulo deste curso."
            />
          ) : (
            <div className="flex flex-col gap-sm">
              {modulos.map((modulo, indiceModulo) => (
                <Acordeao
                  key={modulo.id}
                  aberto={expandidos.has(modulo.id)}
                  aoAlternar={() => alternarModulo(modulo.id)}
                  titulo={
                    moduloEditando === modulo.id ? (
                      <div onClick={(evento) => evento.stopPropagation()}>
                        <Campo
                          rotulo="Título do módulo"
                          value={tituloEditando}
                          onChange={(e) => setTituloEditando(e.target.value)}
                          autoFocus
                        />
                      </div>
                    ) : (
                      <span className="text-subtitle-lg text-ink-deep">{modulo.titulo}</span>
                    )
                  }
                  acoes={
                    <div onClick={(evento) => evento.stopPropagation()} className="flex items-center gap-xs">
                      {moduloEditando === modulo.id ? (
                        <>
                          <Botao
                            variante="ghost"
                            onClick={() => setModuloEditando(null)}
                            disabled={salvandoModulo}
                          >
                            Cancelar
                          </Botao>
                          <Botao
                            variante="accent"
                            onClick={() => salvarRenomeacao(modulo)}
                            disabled={salvandoModulo}
                          >
                            Salvar
                          </Botao>
                        </>
                      ) : (
                        <>
                          <Botao
                            variante="ghost"
                            aria-label="Mover módulo para cima"
                            onClick={() => moverModulo(indiceModulo, -1)}
                            disabled={indiceModulo === 0}
                          >
                            ↑
                          </Botao>
                          <Botao
                            variante="ghost"
                            aria-label="Mover módulo para baixo"
                            onClick={() => moverModulo(indiceModulo, 1)}
                            disabled={indiceModulo === modulos.length - 1}
                          >
                            ↓
                          </Botao>
                          <Botao variante="ghost" onClick={() => iniciarRenomeacao(modulo)}>
                            Renomear
                          </Botao>
                          <Botao variante="ghost" onClick={() => setModuloParaExcluir(modulo)}>
                            Excluir
                          </Botao>
                        </>
                      )}
                    </div>
                  }
                >
                  <div className="flex flex-col gap-sm">
                    {modulo.aulas.length === 0 && (
                      <p className="text-body-sm text-steel">Nenhuma aula neste módulo ainda.</p>
                    )}

                    {modulo.aulas.map((aula, indiceAula) => (
                      <div
                        key={aula.id}
                        className="flex flex-wrap items-center justify-between gap-base rounded-lg border border-hairline-soft p-base"
                      >
                        <div className="flex flex-col gap-xxs">
                          <span className="text-body-md-bold text-ink-deep">{aula.titulo}</span>
                          <div className="flex flex-wrap items-center gap-xs">
                            <Badge variante="neutro">{ROTULO_TIPO[aula.tipo]}</Badge>
                            {aula.tipo === "video" && aula.videoStatus && (
                              <Badge
                                variante={
                                  aula.videoStatus === "pronto"
                                    ? "success"
                                    : aula.videoStatus === "erro"
                                      ? "critical"
                                      : "attention"
                                }
                              >
                                {aula.videoStatus === "pronto"
                                  ? "Pronto"
                                  : aula.videoStatus === "erro"
                                    ? "Erro no processamento"
                                    : "Processando"}
                              </Badge>
                            )}
                            {aula.duracaoEstimadaMin != null && (
                              <span className="text-caption text-steel">{aula.duracaoEstimadaMin} min</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-xs">
                          <Botao
                            variante="ghost"
                            aria-label="Mover aula para cima"
                            onClick={() => moverAula(modulo, indiceAula, -1)}
                            disabled={indiceAula === 0}
                          >
                            ↑
                          </Botao>
                          <Botao
                            variante="ghost"
                            aria-label="Mover aula para baixo"
                            onClick={() => moverAula(modulo, indiceAula, 1)}
                            disabled={indiceAula === modulo.aulas.length - 1}
                          >
                            ↓
                          </Botao>
                          <Botao
                            variante="ghost"
                            onClick={() => setModalAula({ moduloId: modulo.id, aula })}
                          >
                            Editar
                          </Botao>
                          <Botao
                            variante="ghost"
                            onClick={() => setAulaParaExcluir({ moduloId: modulo.id, aula })}
                          >
                            Excluir
                          </Botao>
                        </div>
                      </div>
                    ))}

                    <div>
                      <Botao
                        variante="accent"
                        onClick={() => setModalAula({ moduloId: modulo.id, aula: null })}
                      >
                        Nova aula
                      </Botao>
                    </div>
                  </div>
                </Acordeao>
              ))}
            </div>
          )}
        </>
      )}

      <Modal
        aberto={moduloParaExcluir !== null}
        aoFechar={() => setModuloParaExcluir(null)}
        titulo="Excluir módulo"
      >
        <div className="flex flex-col gap-lg">
          <p className="text-body-md text-ink">
            Tem certeza que deseja excluir <strong>{moduloParaExcluir?.titulo}</strong>? As{" "}
            {moduloParaExcluir?.aulas.length ?? 0} aulas deste módulo serão excluídas junto. Essa ação
            não pode ser desfeita.
          </p>
          <div className="flex justify-end gap-sm">
            <Botao variante="ghost" onClick={() => setModuloParaExcluir(null)} disabled={excluindoModulo}>
              Cancelar
            </Botao>
            <Botao variante="perigo" onClick={confirmarExclusaoModulo} disabled={excluindoModulo}>
              {excluindoModulo ? "Excluindo..." : "Excluir módulo e aulas"}
            </Botao>
          </div>
        </div>
      </Modal>

      <Modal aberto={aulaParaExcluir !== null} aoFechar={() => setAulaParaExcluir(null)} titulo="Excluir aula">
        <div className="flex flex-col gap-lg">
          <p className="text-body-md text-ink">
            Tem certeza que deseja excluir <strong>{aulaParaExcluir?.aula.titulo}</strong>? Essa ação
            não pode ser desfeita.
          </p>
          <div className="flex justify-end gap-sm">
            <Botao variante="ghost" onClick={() => setAulaParaExcluir(null)} disabled={excluindoAula}>
              Cancelar
            </Botao>
            <Botao variante="perigo" onClick={confirmarExclusaoAula} disabled={excluindoAula}>
              {excluindoAula ? "Excluindo..." : "Excluir"}
            </Botao>
          </div>
        </div>
      </Modal>

      <Modal
        aberto={modalAula !== null}
        aoFechar={() => setModalAula(null)}
        titulo={modalAula?.aula ? "Editar aula" : "Nova aula"}
        className="max-w-[560px]"
      >
        {modalAula && (
          <AulaFormulario
            moduloId={modalAula.moduloId}
            aula={modalAula.aula}
            onSalvo={(aula) => aoSalvarAula(modalAula.moduloId, aula)}
            onUploadConcluido={aoConcluirUpload}
            onCancelar={() => setModalAula(null)}
          />
        )}
      </Modal>
    </div>
  );
}
