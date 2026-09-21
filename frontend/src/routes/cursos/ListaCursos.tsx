import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/Badge";
import { Botao } from "../../components/Botao";
import { Card } from "../../components/Card";
import { EstadoVazio } from "../../components/EstadoVazio";
import { Modal } from "../../components/Modal";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/useToast";
import { excluirCurso, listarCursos } from "../../features/cursos/api";
import type { Curso } from "../../features/cursos/tipos";
import { ApiError } from "../../lib/api";

function mensagemErro(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function ListaCursos() {
  const { notificar } = useToast();
  // `cursos === null` é "ainda carregando" — distinto de `[]` (lista vazia de
  // verdade), pra não piscar o estado vazio antes da primeira resposta.
  const [cursos, setCursos] = useState<Curso[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [cursoParaExcluir, setCursoParaExcluir] = useState<Curso | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  // Sem setState síncrono no corpo do efeito (só a promise resolve fora
  // dele) — reset de estado pra uma nova tentativa fica a cargo de quem
  // chama (o clique em "Tentar novamente"), não do próprio carregamento.
  const buscar = useCallback(() => {
    listarCursos()
      .then((dados) => {
        setCursos(dados);
        setErro(null);
      })
      .catch((error: unknown) => setErro(mensagemErro(error, "Não foi possível carregar os cursos.")));
  }, []);

  useEffect(() => {
    buscar();
  }, [buscar]);

  function tentarNovamente() {
    setErro(null);
    setCursos(null);
    buscar();
  }

  async function confirmarExclusao() {
    if (!cursoParaExcluir) return;
    setExcluindo(true);
    try {
      await excluirCurso(cursoParaExcluir.id);
      setCursos((atual) => atual?.filter((curso) => curso.id !== cursoParaExcluir.id) ?? null);
      notificar("Curso excluído.", "success");
      setCursoParaExcluir(null);
    } catch (error) {
      notificar(mensagemErro(error, "Não foi possível excluir o curso."), "critical");
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex items-center justify-between gap-base">
        <h1 className="text-heading-lg text-ink-deep">Cursos</h1>
        {cursos !== null && cursos.length > 0 && (
          <Link to="/cursos/novo">
            <Botao variante="accent">Novo curso</Botao>
          </Link>
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

      {!erro && cursos === null && (
        <div className="flex justify-center py-xxl">
          <Spinner />
        </div>
      )}

      {!erro && cursos !== null && cursos.length === 0 && (
        <EstadoVazio
          titulo="Nenhum curso ainda"
          descricao="Crie o primeiro curso da sua instituição para começar a montar módulos e aulas."
          acao={
            <Link to="/cursos/novo">
              <Botao variante="accent">Criar primeiro curso</Botao>
            </Link>
          }
        />
      )}

      {!erro && cursos !== null && cursos.length > 0 && (
        <div className="flex flex-col gap-sm">
          {cursos.map((curso) => (
            <Card key={curso.id} className="flex items-center justify-between gap-base">
              <div className="flex flex-col gap-xxs">
                <span className="text-body-md-bold text-ink-deep">{curso.titulo}</span>
                <Badge variante={curso.publicado ? "success" : "neutro"}>
                  {curso.publicado ? "Publicado" : "Rascunho"}
                </Badge>
              </div>
              <div className="flex items-center gap-sm">
                <Link to={`/cursos/${curso.id}/conteudo`}>
                  <Botao variante="accent">Conteúdo</Botao>
                </Link>
                <Link to={`/cursos/${curso.id}/editar`}>
                  <Botao variante="ghost">Editar</Botao>
                </Link>
                <Botao variante="ghost" onClick={() => setCursoParaExcluir(curso)}>
                  Excluir
                </Botao>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        aberto={cursoParaExcluir !== null}
        aoFechar={() => setCursoParaExcluir(null)}
        titulo="Excluir curso"
      >
        <div className="flex flex-col gap-lg">
          <p className="text-body-md text-ink">
            Tem certeza que deseja excluir <strong>{cursoParaExcluir?.titulo}</strong>? Essa ação
            não pode ser desfeita.
          </p>
          <div className="flex justify-end gap-sm">
            <Botao variante="ghost" onClick={() => setCursoParaExcluir(null)} disabled={excluindo}>
              Cancelar
            </Botao>
            <Botao variante="perigo" onClick={confirmarExclusao} disabled={excluindo}>
              {excluindo ? "Excluindo..." : "Excluir"}
            </Botao>
          </div>
        </div>
      </Modal>
    </div>
  );
}
