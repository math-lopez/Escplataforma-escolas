import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { buscarInstituicaoPublica, inscreverInstituicao } from "../../features/publico/api";
import type { Instituicao } from "../../features/publico/tipos";
import { Botao } from "../../components/Botao";
import { Campo } from "../../components/Campo";
import { Card } from "../../components/Card";
import { EstadoVazio } from "../../components/EstadoVazio";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/useToast";
import { corValida, corDeTextoIdeal } from "../../lib/contraste";
import { ApiError } from "../../lib/api";

type EstadoCarregamento = "carregando" | "sucesso" | "erro-instituicao-nao-encontrada" | "erro-generico";

function mensagemErro(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function PaginaInstituicao() {
  const { slug } = useParams<{ slug: string }>();
  const { notificar } = useToast();

  const [instituicao, setInstituicao] = useState<Instituicao | null>(null);
  const [estadoCarregamento, setEstadoCarregamento] = useState<EstadoCarregamento>("carregando");
  const [erroGenerico, setErroGenerico] = useState<string | null>(null);

  // Estados do formulário de cadastro
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [inscricaoCarregando, setInscricaoCarregando] = useState(false);
  const [inscricaoErro, setInscricaoErro] = useState<string | null>(null);
  const [inscricaoSucesso, setInscricaoSucesso] = useState(false);

  // Carrega dados da instituição ao montar o componente
  const buscar = useCallback(() => {
    if (!slug) return;

    buscarInstituicaoPublica(slug)
      .then((dados) => {
        setInstituicao(dados);
        setEstadoCarregamento("sucesso");
        setErroGenerico(null);
      })
      .catch((error: unknown) => {
        // Diferencia entre "instituição não encontrada" (404) e outro erro
        if (error instanceof ApiError && error.status === 404) {
          setEstadoCarregamento("erro-instituicao-nao-encontrada");
        } else {
          setEstadoCarregamento("erro-generico");
          setErroGenerico(mensagemErro(error, "Não foi possível carregar a instituição."));
        }
      });
  }, [slug]);

  useEffect(() => {
    buscar();
  }, [buscar]);

  function tentarNovamente() {
    setEstadoCarregamento("carregando");
    setErroGenerico(null);
    buscar();
  }

  async function handleSubmitInscricao(event: FormEvent) {
    event.preventDefault();
    if (!slug || !instituicao) return;

    setInscricaoErro(null);
    setInscricaoCarregando(true);

    try {
      const resposta = await inscreverInstituicao(slug, { nome, email, senha });
      setInscricaoSucesso(true);
      notificar(resposta.mensagem, "success");
      // Limpa o formulário
      setNome("");
      setEmail("");
      setSenha("");
    } catch (error) {
      const erro = mensagemErro(error, "Não foi possível processar a inscrição.");
      setInscricaoErro(erro);
      notificar(erro, "critical");
    } finally {
      setInscricaoCarregando(false);
    }
  }

  // Cor da instituição com validação
  const temaCor = instituicao?.corPrimaria && corValida(instituicao.corPrimaria)
    ? {
        "--color-primary": instituicao.corPrimaria,
        "--color-on-primary": corDeTextoIdeal(instituicao.corPrimaria),
      } as React.CSSProperties
    : {};

  // Estado: carregando
  if (estadoCarregamento === "carregando") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas">
        <Spinner />
      </main>
    );
  }

  // Estado: erro genérico
  if (estadoCarregamento === "erro-generico") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-base">
        <Card className="flex w-full max-w-[480px] flex-col items-start gap-base">
          <p className="text-body-md text-critical-strong">{erroGenerico}</p>
          <Botao variante="accent" onClick={tentarNovamente}>
            Tentar novamente
          </Botao>
        </Card>
      </main>
    );
  }

  // Estado: instituição não encontrada
  if (estadoCarregamento === "erro-instituicao-nao-encontrada") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-base">
        <EstadoVazio
          titulo="Instituição não encontrada"
          descricao="O link que você acessou não corresponde a nenhuma instituição registrada."
        />
      </main>
    );
  }

  // Estado: sucesso, instituição carregada
  if (!instituicao) return null;

  return (
    <main className="flex min-h-screen flex-col bg-canvas" style={temaCor}>
      {/* Cabeçalho */}
      <header className="border-b border-hairline-soft bg-primary text-on-primary py-lg px-base">
        <div className="mx-auto flex max-w-[1200px] items-center gap-lg">
          {instituicao.logoUrl && (
            <img
              src={instituicao.logoUrl}
              alt={`Logo de ${instituicao.nome}`}
              className="h-16 w-16 rounded-lg object-cover"
            />
          )}
          <div className="flex flex-col gap-xxs">
            <h1 className="text-heading-lg">{instituicao.nome}</h1>
          </div>
        </div>
      </header>

      {/* Conteúdo principal */}
      <div className="flex flex-1 flex-col gap-lg px-base py-lg">
        <div className="mx-auto w-full max-w-[1200px]">
          {/* Seção de cursos */}
          <section className="flex flex-col gap-base">
            <h2 className="text-heading-md text-ink-deep">Cursos disponíveis</h2>

            {instituicao.cursos.length === 0 ? (
              <EstadoVazio
                titulo="Nenhum curso publicado"
                descricao="Esta instituição ainda não possui cursos publicados. Por favor, volte mais tarde."
              />
            ) : (
              <div className="grid gap-base sm:grid-cols-2 lg:grid-cols-3">
                {instituicao.cursos.map((curso) => (
                  <Card key={curso.id} className="flex flex-col gap-base">
                    {curso.capaUrl && (
                      <img
                        src={curso.capaUrl}
                        alt={`Capa do curso ${curso.titulo}`}
                        className="h-40 w-full rounded-lg object-cover"
                      />
                    )}
                    <div className="flex flex-col gap-xs">
                      <h3 className="text-body-md-bold text-ink-deep">{curso.titulo}</h3>
                      {curso.descricao && (
                        <p className="text-body-sm text-steel">{curso.descricao}</p>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* Seção de inscrição (apenas se modoIngresso === 'auto_aprovacao') */}
          {instituicao.modoIngresso === "auto_aprovacao" && (
            <section className="mt-xl flex flex-col gap-base">
              <h2 className="text-heading-md text-ink-deep">Inscrever-se</h2>

              <Card className="flex w-full max-w-[480px] flex-col gap-lg">
                {inscricaoSucesso ? (
                  <div className="flex flex-col items-start gap-base">
                    <div className="flex flex-col gap-xs">
                      <h3 className="text-body-md-bold text-ink-deep">Inscrição recebida</h3>
                      <p className="text-body-sm text-steel">
                        Verifique seu e-mail para confirmar sua conta. Se já possui uma conta,
                        faça login.
                      </p>
                    </div>
                    <Botao variante="secondary" onClick={() => setInscricaoSucesso(false)}>
                      Fazer nova inscrição
                    </Botao>
                  </div>
                ) : (
                  <form onSubmit={handleSubmitInscricao} className="flex flex-col gap-base" noValidate>
                    <div className="flex flex-col gap-xxs text-center">
                      <h3 className="text-heading-sm text-ink-deep">Crie sua conta</h3>
                      <p className="text-body-sm text-steel">
                        Preencha os dados abaixo para começar.
                      </p>
                    </div>

                    <Campo
                      rotulo="Nome"
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      required
                      disabled={inscricaoCarregando}
                    />

                    <Campo
                      rotulo="E-mail"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                      disabled={inscricaoCarregando}
                    />

                    <Campo
                      rotulo="Senha"
                      type="password"
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      autoComplete="new-password"
                      minLength={8}
                      required
                      disabled={inscricaoCarregando}
                    />

                    {inscricaoErro && (
                      <p role="alert" className="text-body-sm text-critical-strong">
                        {inscricaoErro}
                      </p>
                    )}

                    <Botao
                      type="submit"
                      variante="primary"
                      disabled={inscricaoCarregando}
                      className="w-full"
                    >
                      {inscricaoCarregando ? "Inscrevendo..." : "Inscrever-se"}
                    </Botao>
                  </form>
                )}
              </Card>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
