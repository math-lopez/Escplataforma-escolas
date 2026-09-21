import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../../lib/api";

export type Papel = "admin_instituicao" | "professor" | "aluno";

export interface Usuario {
  id: string;
  nome: string;
  papel: Papel;
  instituicaoId: string;
}

export interface Instituicao {
  id: string;
  nome: string;
  slug: string;
  logoUrl: string | null;
  corPrimaria: string | null;
}

// Forma da resposta de `/api/auth/me` (e de login/onboarding): o usuário
// autenticado com a instituição embutida — é o que permite ligar o
// TemaProvider e o branding do AppShell a dado real (PLANO-MVP.md, Fatia 0).
export interface RespostaSessao extends Usuario {
  instituicao?: Instituicao;
}

interface SessaoContextValue {
  usuario: Usuario | null;
  instituicao: Instituicao | null;
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<Usuario>;
  sair: () => Promise<void>;
  definirSessao: (dados: RespostaSessao) => void;
}

export const SessaoContext = createContext<SessaoContextValue | null>(null);

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [instituicao, setInstituicao] = useState<Instituicao | null>(null);
  const [carregando, setCarregando] = useState(true);

  const aplicarSessao = useCallback((dados: RespostaSessao) => {
    setUsuario(dados);
    setInstituicao(dados.instituicao ?? null);
  }, []);

  useEffect(() => {
    // O cookie de sessão é httpOnly, então a única forma de saber se há sessão
    // é perguntando ao backend.
    api
      .get<RespostaSessao>("/api/auth/me")
      .then(aplicarSessao)
      .catch(() => {
        setUsuario(null);
        setInstituicao(null);
      })
      .finally(() => setCarregando(false));
  }, [aplicarSessao]);

  const entrar = useCallback(
    async (email: string, senha: string) => {
      const dados = await api.post<RespostaSessao>("/api/auth/login", { email, senha });
      aplicarSessao(dados);
      return dados;
    },
    [aplicarSessao],
  );

  const sair = useCallback(async () => {
    await api.post("/api/auth/logout");
    setUsuario(null);
    setInstituicao(null);
  }, []);

  const value = useMemo(
    () => ({ usuario, instituicao, carregando, entrar, sair, definirSessao: aplicarSessao }),
    [usuario, instituicao, carregando, entrar, sair, aplicarSessao],
  );

  return <SessaoContext.Provider value={value}>{children}</SessaoContext.Provider>;
}
