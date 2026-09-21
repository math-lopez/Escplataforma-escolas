import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { Usuario } from "../features/auth/SessaoContext";
import { cn } from "../lib/cn";

interface ItemNavegacao {
  rotulo: string;
  para: string;
}

interface AppShellProps {
  usuario: Usuario;
  aoSair: () => void;
  itensNavegacao?: ItemNavegacao[];
  nomeInstituicao?: string;
  logoUrl?: string | null;
  children: ReactNode;
}

// Nem sidebar nem topbar existem no DESIGN.md — ele foi extraído de páginas
// de e-commerce, não de um shell de aplicação/LMS (PLANO-MVP.md §6.4).
// Montado só com os tokens já declarados em index.css: canvas/hairline-soft
// para as superfícies, o mesmo tratamento de `button-pill-tab-active`
// (fundo ink-deep) para reforçar hierarquia sem inventar cor nova.
export function AppShell({
  usuario,
  aoSair,
  itensNavegacao = [],
  nomeInstituicao,
  logoUrl,
  children,
}: AppShellProps) {
  const { pathname } = useLocation();

  return (
    <div className="flex min-h-screen bg-surface-soft">
      <aside className="hidden w-[240px] shrink-0 flex-col gap-xl border-r border-hairline-soft bg-canvas p-lg md:flex">
        <div className="flex items-center gap-xs">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={nomeInstituicao ?? "Logo da instituição"}
              className="h-8 w-8 rounded-md object-cover"
            />
          ) : (
            <div className="h-8 w-8 rounded-md bg-primary" aria-hidden="true" />
          )}
          <span className="text-body-sm-bold text-ink-deep">
            {nomeInstituicao ?? "Plataforma Escolas"}
          </span>
        </div>

        <nav className="flex flex-col gap-xxs" aria-label="Navegação principal">
          {itensNavegacao.map((item) => {
            const ativo = pathname.startsWith(item.para);
            return (
              <Link
                key={item.para}
                to={item.para}
                aria-current={ativo ? "page" : undefined}
                className={cn(
                  "rounded-lg px-md py-sm text-body-sm-bold",
                  ativo ? "bg-surface-soft text-ink-deep" : "text-ink hover:bg-surface-soft",
                )}
              >
                {item.rotulo}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-hairline-soft bg-canvas px-lg">
          <span className="text-body-sm-bold text-ink-deep md:hidden">
            {nomeInstituicao ?? "Plataforma Escolas"}
          </span>
          <div className="ml-auto flex items-center gap-base">
            <span className="text-body-sm-bold text-ink">{usuario.nome}</span>
            <button
              type="button"
              onClick={aoSair}
              className="text-body-sm-bold text-steel hover:text-ink-deep"
            >
              Sair
            </button>
          </div>
        </header>

        <main className="flex-1 p-xl">{children}</main>
      </div>
    </div>
  );
}
