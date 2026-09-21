import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import type { Papel } from "../features/auth/SessaoContext";
import { useSessao } from "../features/auth/useSessao";

interface RotaProtegidaProps {
  children: ReactNode;
  /** Se informado, só libera para usuários com esse(s) papel(is); senão, qualquer sessão vale. */
  papel?: Papel | Papel[];
}

// Guarda de rota: exige sessão e, opcionalmente, um papel específico.
// Ainda não há página autenticada usando isso — o painel do professor entra
// na Fatia 1 do PLANO-MVP.md — mas o shell precisa existir antes das
// primeiras rotas protegidas, e o teste de carregando/redirecionamento não
// deve ser reinventado a cada página nova.
export function RotaProtegida({ children, papel }: RotaProtegidaProps) {
  const { usuario, carregando } = useSessao();

  if (carregando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <p className="text-body-md text-steel">Carregando...</p>
      </div>
    );
  }

  if (!usuario) {
    return <Navigate to="/login" replace />;
  }

  const papeisPermitidos = papel ? (Array.isArray(papel) ? papel : [papel]) : null;
  if (papeisPermitidos && !papeisPermitidos.includes(usuario.papel)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
