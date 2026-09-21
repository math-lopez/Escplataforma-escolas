import { useState, type FormEvent } from "react";
import { Abas } from "../../components/Abas";
import { Badge } from "../../components/Badge";
import { BarraProgresso } from "../../components/BarraProgresso";
import { Botao } from "../../components/Botao";
import { Campo } from "../../components/Campo";
import { CampoTextarea } from "../../components/CampoTextarea";
import {
  atualizarAula,
  criarAula,
  solicitarUploadPdf,
  solicitarUploadVideo,
  enviarLinkYoutube,
} from "../../features/cursos/conteudoApi";
import type { Aula, DadosAula, TipoAula } from "../../features/cursos/tiposConteudo";
import { enviarPdf, enviarVideo } from "../../features/cursos/upload";
import { ApiError } from "../../lib/api";

const OPCOES_TIPO: { id: TipoAula; rotulo: string }[] = [
  { id: "video", rotulo: "Vídeo" },
  { id: "texto", rotulo: "Texto" },
  { id: "pdf", rotulo: "PDF" },
  { id: "ao_vivo", rotulo: "Ao vivo" },
];

function mensagemErro(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

// Erros de upload (tanto de pedir credenciais quanto do envio em si) já vêm
// com mensagem própria e legível (ver features/cursos/upload.ts, ex: a
// assinatura da Bunny expirada) — mostrar sempre `error.message` em vez de um
// fallback genérico, diferente de `mensagemErro` acima que só confia em
// ApiError.
function mensagemErroUpload(error: unknown): string {
  return error instanceof Error ? error.message : "Não foi possível enviar o arquivo.";
}

interface AulaFormularioProps {
  moduloId: string;
  aula: Aula | null;
  onSalvo: (aula: Aula) => void;
  onUploadConcluido: () => void;
  onCancelar: () => void;
}

// Formulário de criar/editar aula. PDF e vídeo exigem que a aula já tenha
// `id` no servidor (o upload vai para `/api/aulas/:id/...`) — para uma aula
// nova, a seção de upload só aparece depois que os metadados forem salvos
// pela primeira vez (o POST devolve a aula com id, guardada em `aulaSalva`,
// e o formulário continua aberto no modo "editar" a partir daí).
export function AulaFormulario({
  moduloId,
  aula,
  onSalvo,
  onUploadConcluido,
  onCancelar,
}: AulaFormularioProps) {
  const [aulaSalva, setAulaSalva] = useState<Aula | null>(aula);
  const [titulo, setTitulo] = useState(aula?.titulo ?? "");
  const [tipo, setTipo] = useState<TipoAula>(aula?.tipo ?? "video");
  const [conteudoTexto, setConteudoTexto] = useState(aula?.conteudoTexto ?? "");
  const [conteudoUrl, setConteudoUrl] = useState(aula?.tipo === "ao_vivo" ? (aula.conteudoUrl ?? "") : "");
  const [duracao, setDuracao] = useState(
    aula?.duracaoEstimadaMin != null ? String(aula.duracaoEstimadaMin) : "",
  );
  const [erroTitulo, setErroTitulo] = useState<string | null>(null);
  const [erroServidor, setErroServidor] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [erroUpload, setErroUpload] = useState<string | null>(null);

  const [urlYoutube, setUrlYoutube] = useState("");
  const [enviaVideoYoutube, setEnviaVideoYoutube] = useState(false);
  const [erroYoutube, setErroYoutube] = useState<string | null>(null);
  const [abaVideoAtiva, setAbaVideoAtiva] = useState<"arquivo" | "youtube">("arquivo");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErroServidor(null);

    const tituloLimpo = titulo.trim();
    if (!tituloLimpo) {
      setErroTitulo("Informe um título para a aula.");
      return;
    }
    setErroTitulo(null);

    // Só o campo do tipo escolhido carrega valor — os outros vão explicitamente
    // `null` (evita que sobre lixo do tipo anterior se alguém trocar o tipo).
    const dados: DadosAula = {
      titulo: tituloLimpo,
      tipo,
      conteudoTexto: tipo === "texto" ? conteudoTexto.trim() || null : null,
      conteudoUrl: tipo === "ao_vivo" ? conteudoUrl.trim() || null : null,
      duracaoEstimadaMin: duracao.trim() ? Number(duracao) : null,
    };

    setSalvando(true);
    try {
      const resultado = aulaSalva
        ? await atualizarAula(aulaSalva.id, dados)
        : await criarAula(moduloId, dados);
      setAulaSalva(resultado);
      onSalvo(resultado);
    } catch (error) {
      setErroServidor(mensagemErro(error, "Não foi possível salvar a aula."));
    } finally {
      setSalvando(false);
    }
  }

  async function handleUpload() {
    if (!arquivo || !aulaSalva) return;
    setErroUpload(null);
    setEnviando(true);
    setProgresso(0);
    try {
      // Caminhos explícitos, não uma função genérica com `if` por dentro —
      // vídeo (TUS) e PDF (PUT) são protocolos diferentes de ponta a ponta,
      // da credencial ao envio. Ver features/cursos/upload.ts.
      if (tipo === "video") {
        const credenciais = await solicitarUploadVideo(aulaSalva.id);
        await enviarVideo(credenciais, arquivo, setProgresso);
      } else {
        const credenciais = await solicitarUploadPdf(aulaSalva.id, arquivo.name);
        await enviarPdf(credenciais, arquivo, setProgresso);
      }
      setArquivo(null);
      onUploadConcluido();
    } catch (error) {
      setErroUpload(mensagemErroUpload(error));
    } finally {
      setEnviando(false);
    }
  }

  async function handleEnviarYoutube() {
    if (!urlYoutube.trim() || !aulaSalva) return;
    setErroYoutube(null);
    setEnviaVideoYoutube(true);
    try {
      const resultado = await enviarLinkYoutube(aulaSalva.id, urlYoutube.trim());
      setUrlYoutube("");
      setAulaSalva(resultado);
      onUploadConcluido();
    } catch (error) {
      setErroYoutube(mensagemErro(error, "Não foi possível adicionar o vídeo do YouTube."));
    } finally {
      setEnviaVideoYoutube(false);
    }
  }

  const statusVideo = aulaSalva?.tipo === "video" ? aulaSalva.videoStatus : null;

  return (
    <div className="flex flex-col gap-lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-base" noValidate>
        <Campo
          rotulo="Título"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          erro={erroTitulo ?? undefined}
          required
        />

        <div className="flex flex-col gap-xxs">
          <span className="text-body-sm-bold text-ink">Tipo</span>
          <Abas itens={OPCOES_TIPO} ativa={tipo} aoSelecionar={(valor) => setTipo(valor as TipoAula)} />
        </div>

        {/* O campo relevante muda com o tipo — mostrar todos sempre confunde. */}
        {tipo === "texto" && (
          <CampoTextarea
            rotulo="Conteúdo"
            value={conteudoTexto}
            onChange={(e) => setConteudoTexto(e.target.value)}
            rows={6}
          />
        )}

        {tipo === "ao_vivo" && (
          <Campo
            rotulo="Link da aula ao vivo"
            type="url"
            placeholder="https://..."
            value={conteudoUrl}
            onChange={(e) => setConteudoUrl(e.target.value)}
          />
        )}

        <Campo
          rotulo="Duração estimada (min)"
          type="number"
          min={0}
          value={duracao}
          onChange={(e) => setDuracao(e.target.value)}
        />

        {erroServidor && (
          <p role="alert" className="text-body-sm text-critical-strong">
            {erroServidor}
          </p>
        )}

        <div className="flex justify-end gap-sm">
          <Botao variante="ghost" type="button" onClick={onCancelar} disabled={salvando}>
            Cancelar
          </Botao>
          <Botao variante="accent" type="submit" disabled={salvando}>
            {salvando ? "Salvando..." : aulaSalva ? "Salvar" : "Criar aula"}
          </Botao>
        </div>
      </form>

      {tipo === "pdf" && (
        <div className="flex flex-col gap-sm border-t border-hairline-soft pt-base">
          <span className="text-body-sm-bold text-ink">Arquivo PDF</span>

          {!aulaSalva && (
            <p className="text-body-sm text-steel">
              Salve a aula acima para habilitar o envio do arquivo.
            </p>
          )}

          {aulaSalva && (
            <>
              {aulaSalva.conteudoUrl && (
                <a
                  href={aulaSalva.conteudoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-body-sm-bold text-primary"
                >
                  Ver arquivo atual
                </a>
              )}

              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                className="text-body-sm text-ink"
                disabled={enviando}
              />

              {enviando && (
                <div className="flex flex-col gap-xxs">
                  <BarraProgresso percentual={progresso} />
                  {/* Vídeo é arquivo grande — sem essa linha a barra parada por
                      minutos parece travamento, não upload em andamento. */}
                  <span className="text-caption text-steel">Enviando... {progresso}%</span>
                </div>
              )}

              {erroUpload && (
                <p role="alert" className="text-body-sm text-critical-strong">
                  {erroUpload}
                </p>
              )}

              <div>
                <Botao
                  variante="secondary"
                  type="button"
                  onClick={handleUpload}
                  disabled={!arquivo || enviando}
                >
                  {enviando ? "Enviando..." : "Enviar arquivo"}
                </Botao>
              </div>
            </>
          )}
        </div>
      )}

      {tipo === "video" && (
        <div className="flex flex-col gap-sm border-t border-hairline-soft pt-base">
          <div className="flex flex-col gap-base">
            <span className="text-body-sm-bold text-ink">Vídeo</span>

            {!aulaSalva && (
              <p className="text-body-sm text-steel">
                Salve a aula acima para habilitar o envio do vídeo.
              </p>
            )}

            {aulaSalva && (
              <>
                {statusVideo && (
                  <Badge
                    variante={
                      statusVideo === "pronto" ? "success" : statusVideo === "erro" ? "critical" : "attention"
                    }
                  >
                    {statusVideo === "pronto"
                      ? "Pronto"
                      : statusVideo === "erro"
                        ? "Erro no processamento"
                        : "Processando"}
                  </Badge>
                )}

                {aulaSalva.videoFonte && (
                  <p className="text-body-sm text-steel">
                    Vídeo atual: <span className="text-body-sm-bold text-ink">
                      {aulaSalva.videoFonte === "bunny" ? "Upload na plataforma" : "Link do YouTube"}
                    </span>
                  </p>
                )}

                <div className="flex flex-col gap-base">
                  <div className="flex flex-col gap-xxs">
                    <span className="text-body-sm-bold text-ink">Escolha uma opção</span>
                    <Abas
                      itens={[
                        { id: "arquivo", rotulo: "Enviar arquivo" },
                        { id: "youtube", rotulo: "Usar link do YouTube" },
                      ]}
                      ativa={abaVideoAtiva}
                      aoSelecionar={(valor) => setAbaVideoAtiva(valor as "arquivo" | "youtube")}
                    />
                  </div>

                  {abaVideoAtiva === "arquivo" && (
                    <>
                      <input
                        type="file"
                        accept="video/*"
                        onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                        className="text-body-sm text-ink"
                        disabled={enviando}
                      />

                      {enviando && (
                        <div className="flex flex-col gap-xxs">
                          <BarraProgresso percentual={progresso} />
                          <span className="text-caption text-steel">Enviando... {progresso}%</span>
                        </div>
                      )}

                      {erroUpload && (
                        <p role="alert" className="text-body-sm text-critical-strong">
                          {erroUpload}
                        </p>
                      )}

                      <div>
                        <Botao
                          variante="secondary"
                          type="button"
                          onClick={handleUpload}
                          disabled={!arquivo || enviando}
                        >
                          {enviando ? "Enviando..." : "Enviar arquivo"}
                        </Botao>
                      </div>
                    </>
                  )}

                  {abaVideoAtiva === "youtube" && (
                    <>
                      <Campo
                        rotulo="URL do YouTube"
                        type="url"
                        placeholder="https://youtube.com/watch?v=... ou https://youtu.be/..."
                        value={urlYoutube}
                        onChange={(e) => setUrlYoutube(e.target.value)}
                        disabled={enviaVideoYoutube}
                      />

                      {erroYoutube && (
                        <p role="alert" className="text-body-sm text-critical-strong">
                          {erroYoutube}
                        </p>
                      )}

                      <div>
                        <Botao
                          variante="secondary"
                          type="button"
                          onClick={handleEnviarYoutube}
                          disabled={!urlYoutube.trim() || enviaVideoYoutube}
                        >
                          {enviaVideoYoutube ? "Adicionando..." : "Adicionar link"}
                        </Botao>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
