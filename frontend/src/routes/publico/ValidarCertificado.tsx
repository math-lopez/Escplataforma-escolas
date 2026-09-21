import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { Badge } from "../../components/Badge";
import { Botao } from "../../components/Botao";
import { Campo } from "../../components/Campo";
import { Card } from "../../components/Card";
import { validarCertificado } from "../../features/publico/api";
import type { CertificadoValidacao } from "../../features/publico/tipos";
import { ApiError } from "../../lib/api";

type EstadoValidacao = "inicial" | "validando" | "valido" | "invalido" | "erro";

function mensagemErro(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function ValidarCertificado() {
  const { codigo: codigoUrl } = useParams<{ codigo: string }>();

  const [codigoInput, setCodigoInput] = useState("");
  const [estado, setEstado] = useState<EstadoValidacao>("inicial");
  const [certificado, setCertificado] = useState<CertificadoValidacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const jaValidouRef = useRef(false);

  const validar = useCallback(async (codigoParaValidar: string) => {
    if (!codigoParaValidar.trim()) return;

    setEstado("validando");
    setErro(null);
    setCertificado(null);

    try {
      const resultado = await validarCertificado(codigoParaValidar.trim());
      setCertificado(resultado);
      setEstado("valido");
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setEstado("invalido");
        setErro("Código de certificado não encontrado.");
      } else {
        setEstado("erro");
        setErro(mensagemErro(error, "Não foi possível validar o certificado."));
      }
    }
  }, []);

  // Se houver código na URL, valida automaticamente (apenas uma vez)
  useEffect(() => {
    if (codigoUrl && !jaValidouRef.current) {
      jaValidouRef.current = true;
      validar(codigoUrl);
    }
  }, [codigoUrl, validar]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await validar(codigoInput);
  }

  function tentarNovamente() {
    setEstado("inicial");
    setCodigoInput("");
    setCertificado(null);
    setErro(null);
  }

  const dataEmissao = certificado
    ? new Date(certificado.emitidoEm).toLocaleDateString("pt-BR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <main className="flex min-h-screen flex-col bg-canvas">
      {/* Cabeçalho */}
      <header className="border-b border-hairline-soft bg-primary text-on-primary py-lg px-base">
        <div className="mx-auto flex max-w-[1200px] items-center gap-lg">
          <div className="flex flex-col gap-xxs">
            <h1 className="text-heading-lg">Plataforma Escolas</h1>
            <p className="text-on-primary/80 text-body-sm">Validação de certificados</p>
          </div>
        </div>
      </header>

      {/* Conteúdo */}
      <div className="flex flex-1 flex-col gap-lg px-base py-lg">
        <div className="mx-auto w-full max-w-[480px] flex flex-col gap-lg">
          {/* Formulário de entrada */}
          {estado === "inicial" || estado === "validando" || estado === "erro" || estado === "invalido" ? (
            <Card className="flex flex-col gap-lg">
              <div className="flex flex-col gap-xs">
                <h2 className="text-heading-sm text-ink-deep">Validar certificado</h2>
                <p className="text-body-sm text-steel">
                  Digite o código de validação para confirmar a autenticidade do certificado.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-base" noValidate>
                <Campo
                  rotulo="Código de validação"
                  value={codigoInput}
                  onChange={(e) => setCodigoInput(e.target.value.toUpperCase())}
                  placeholder="Ex: A1B2C3D4E5F6G7H8"
                  disabled={estado === "validando"}
                  required
                />

                {erro && (
                  <p role="alert" className="text-body-sm text-critical-strong">
                    {erro}
                  </p>
                )}

                <Botao
                  type="submit"
                  variante="accent"
                  disabled={estado === "validando" || !codigoInput.trim()}
                  className="w-full"
                >
                  {estado === "validando" ? "Validando..." : "Validar"}
                </Botao>
              </form>

              {(estado === "invalido" || estado === "erro") && (
                <Botao variante="secondary" onClick={tentarNovamente} className="w-full">
                  Tentar outro código
                </Botao>
              )}
            </Card>
          ) : null}

          {/* Certificado válido */}
          {estado === "valido" && certificado ? (
            <Card className="flex flex-col gap-lg">
              <div className="flex items-start gap-base">
                <Badge variante="success">✓</Badge>
                <div className="flex flex-col gap-xs flex-1">
                  <h2 className="text-heading-sm text-ink-deep">Certificado válido</h2>
                  <p className="text-body-sm text-steel">
                    Este certificado é autêntico e foi verificado com sucesso.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-base border-t border-hairline-soft pt-lg">
                <div className="flex flex-col gap-sm">
                  <div className="flex flex-col gap-xs">
                    <label className="text-caption-bold text-steel">Aluno</label>
                    <p className="text-body-md-bold text-ink-deep">{certificado.aluno.nome}</p>
                  </div>

                  <div className="flex flex-col gap-xs">
                    <label className="text-caption-bold text-steel">Curso</label>
                    <p className="text-body-md-bold text-ink-deep">{certificado.curso.titulo}</p>
                  </div>

                  <div className="flex flex-col gap-xs">
                    <label className="text-caption-bold text-steel">Instituição</label>
                    <p className="text-body-md-bold text-ink-deep">{certificado.instituicao.nome}</p>
                  </div>

                  <div className="flex flex-col gap-xs">
                    <label className="text-caption-bold text-steel">Data de emissão</label>
                    <p className="text-body-md text-ink-deep">{dataEmissao}</p>
                  </div>
                </div>
              </div>

              <Botao variante="secondary" onClick={tentarNovamente} className="w-full">
                Validar outro certificado
              </Botao>
            </Card>
          ) : null}
        </div>
      </div>
    </main>
  );
}
