import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BarraProgresso } from "../../components/BarraProgresso";
import { Botao } from "../../components/Botao";
import { Card } from "../../components/Card";
import { EstadoVazio } from "../../components/EstadoVazio";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/useToast";
import { listarMeusCursos } from "../../features/aluno/api";
import type { CursoMatriculado } from "../../features/aluno/tipos";
import { ApiError } from "../../lib/api";

function mensagemErro(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function MeusCursos() {
  const { notificar: _ } = useToast();
  const [cursos, setCursos] = useState<CursoMatriculado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const buscar = useCallback(() => {
    listarMeusCursos()
      .then((dados) => {
        setCursos(dados);
        setErro(null);
      })
      .catch((error: unknown) =>
        setErro(mensagemErro(error, "Não foi possível carregar seus cursos."))
      );
  }, []);

  useEffect(() => {
    buscar();
  }, [buscar]);

  function tentarNovamente() {
    setErro(null);
    setCursos(null);
    buscar();
  }

  return (
    <div className="flex flex-col gap-lg">
      <h1 className="text-heading-lg text-ink-deep">Meus cursos</h1>

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
          titulo="Sem cursos ainda"
          descricao="Você ainda não está matriculado em nenhum curso. Assim que a instituição matricular você, os cursos aparecem aqui."
        />
      )}

      {!erro && cursos !== null && cursos.length > 0 && (
        <div className="flex flex-col gap-sm">
          {cursos.map((curso) => {
            const percentual =
              curso.totalAulas > 0
                ? Math.round((curso.aulasConcluidas / curso.totalAulas) * 100)
                : 0;

            return (
              <Card key={curso.id} className="flex flex-col gap-base">
                <div className="flex items-start justify-between gap-base">
                  <div className="flex flex-col gap-xxs flex-1">
                    <h2 className="text-body-md-bold text-ink-deep">{curso.titulo}</h2>
                    {curso.descricao && (
                      <p className="text-body-sm text-steel">{curso.descricao}</p>
                    )}
                  </div>
                  <Link to={`/aluno/cursos/${curso.id}`}>
                    <Botao variante="accent">Ver curso</Botao>
                  </Link>
                </div>

                <div className="flex flex-col gap-xs">
                  <BarraProgresso percentual={percentual} />
                  <span className="text-caption text-steel">
                    {curso.aulasConcluidas} de {curso.totalAulas} aula
                    {curso.totalAulas !== 1 ? "s" : ""} concluída
                    {curso.aulasConcluidas !== 1 ? "s" : ""}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
