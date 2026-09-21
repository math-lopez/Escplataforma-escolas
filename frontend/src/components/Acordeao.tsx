import type { ReactNode } from "react";
import { cn } from "../lib/cn";

interface AcordeaoProps {
  titulo: ReactNode;
  acoes?: ReactNode;
  aberto: boolean;
  aoAlternar: () => void;
  children: ReactNode;
  className?: string;
}

// O DESIGN.md não tem lista reordenável nem um componente de módulo/aula,
// mas tem `faq-accordion-item` (canvas, rounded-xl, padding-xl, border
// hairline-soft, chevron à direita) — é o chrome mais próximo do que um
// editor de módulos precisa, então viramos ele de "pergunta/resposta" para
// "módulo/lista de aulas". O chevron vira toggle isolado (não o cabeçalho
// inteiro) porque o cabeçalho também precisa caber ações (renomear, mover,
// excluir) e um <input> de edição — nenhum dos dois pode viver dentro de um
// <button>.
export function Acordeao({ titulo, acoes, aberto, aoAlternar, children, className }: AcordeaoProps) {
  return (
    <div className={cn("rounded-xl border border-hairline-soft bg-canvas", className)}>
      <div className="flex items-center gap-base p-xl">
        <button
          type="button"
          onClick={aoAlternar}
          aria-expanded={aberto}
          aria-label={aberto ? "Recolher" : "Expandir"}
          className="shrink-0 text-steel"
        >
          <span
            className={cn("inline-block transition-transform", aberto && "rotate-180")}
            aria-hidden="true"
          >
            ▾
          </span>
        </button>
        <div className="min-w-0 flex-1">{titulo}</div>
        {acoes && <div className="flex shrink-0 items-center gap-xs">{acoes}</div>}
      </div>
      {aberto && <div className="border-t border-hairline-soft p-xl pt-base">{children}</div>}
    </div>
  );
}
