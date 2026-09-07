import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../../lib/api";

export type Papel = "admin_instituicao" | "professor" | "aluno";

export interface Usuario {
  id: string;
  nome: string;
  papel: Papel;
  instituicaoId: string;
}

interface SessaoContextValue {
  usuario: Usuario | null;
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
  definirUsuario: (usuario: Usuario) => void;
}

export const SessaoContext = createContext<SessaoContextValue | null>(null);

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    // O cookie de sessão é httpOnly, então a única forma de saber se há sessão
    // é perguntando ao backend.
    api
      .get<Usuario>("/api/auth/me")
      .then(setUsuario)
      .catch(() => setUsuario(null))
      .finally(() => setCarregando(false));
  }, []);

  const entrar = useCallback(async (email: string, senha: string) => {
    const usuarioLogado = await api.post<Usuario>("/api/auth/login", { email, senha });
    setUsuario(usuarioLogado);
  }, []);

  const sair = useCallback(async () => {
    await api.post("/api/auth/logout");
    setUsuario(null);
  }, []);

  const value = useMemo(
    () => ({ usuario, carregando, entrar, sair, definirUsuario: setUsuario }),
    [usuario, carregando, entrar, sair],
  );

  return <SessaoContext.Provider value={value}>{children}</SessaoContext.Provider>;
}
