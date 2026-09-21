import { useCallback, useEffect, useState } from "react";
import { Botao } from "../../components/Botao";
import { Card } from "../../components/Card";
import { EstadoVazio } from "../../components/EstadoVazio";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/useToast";
import { listarCertificados } from "../../features/aluno/api";
import type { Certificado } from "../../features/aluno/tipos";
import { ApiError } from "../../lib/api";

function mensagemErro(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function MeusCertificados() {
  const { notificar } = useToast();
  const [certificados, setCertificados] = useState<Certificado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const buscar = useCallback(() => {
    listarCertificados()
      .then((dados) => {
        setCertificados(dados);
        setErro(null);
      })
      .catch((error: unknown) =>
        setErro(mensagemErro(error, "Não foi possível carregar seus certificados."))
      );
  }, []);

  useEffect(() => {
    buscar();
  }, [buscar]);

  function tentarNovamente() {
    setErro(null);
    setCertificados(null);
    buscar();
  }

  function copiarCodigo(codigo: string) {
    navigator.clipboard.writeText(codigo);
    notificar("Código copiado!", "success");
  }

  return (
    <div className="flex flex-col gap-lg">
      <h1 className="text-heading-lg text-ink-deep">Meus certificados</h1>

      {erro && (
        <Card className="flex flex-col items-start gap-base">
          <p className="text-body-md text-critical-strong">{erro}</p>
          <Botao variante="accent" onClick={tentarNovamente}>
            Tentar novamente
          </Botao>
        </Card>
      )}

      {!erro && certificados === null && (
        <div className="flex justify-center py-xxl">
          <Spinner />
        </div>
      )}

      {!erro && certificados !== null && certificados.length === 0 && (
        <EstadoVazio
          titulo="Sem certificados ainda"
          descricao="Você ainda não concluiu nenhum curso. Quando terminar um curso, poderá gerar seu certificado de conclusão."
        />
      )}

      {!erro && certificados !== null && certificados.length > 0 && (
        <div className="flex flex-col gap-sm">
          {certificados.map((certificado) => {
            const dataEmissao = new Date(certificado.emitidoEm).toLocaleDateString("pt-BR");
            const linkValidacao = `/validar/${certificado.codigoValidacao}`;

            return (
              <Card key={certificado.id} className="flex flex-col gap-base">
                <div className="flex items-start justify-between gap-base">
                  <div className="flex flex-col gap-xs flex-1">
                    <h2 className="text-body-md-bold text-ink-deep">
                      {certificado.curso.titulo}
                    </h2>
                    <p className="text-body-sm text-steel">
                      Emitido em {dataEmissao}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-sm">
                  <div className="flex flex-col gap-xs">
                    <label className="text-caption-bold text-ink-deep">
                      Código de validação
                    </label>
                    <div className="flex gap-sm items-center">
                      <code className="flex-1 px-md py-sm bg-surface-soft rounded-lg text-body-sm-bold text-ink-deep font-mono">
                        {certificado.codigoValidacao}
                      </code>
                      <Botao
                        variante="secondary"
                        onClick={() => copiarCodigo(certificado.codigoValidacao)}
                      >
                        Copiar
                      </Botao>
                    </div>
                  </div>

                  <div className="flex gap-sm">
                    <a href={linkValidacao} target="_blank" rel="noopener noreferrer">
                      <Botao variante="accent">Validar público</Botao>
                    </a>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
