import { useEffect, type ReactNode } from "react";
import { cn } from "../lib/cn";

interface ModalProps {
  aberto: boolean;
  aoFechar: () => void;
  titulo?: string;
  children: ReactNode;
  className?: string;
}

// O DESIGN.md não define modal (é um IDS extraído de páginas de e-commerce,
// sem esse padrão de interação — ver PLANO-MVP.md §6.4). Montado só com
// tokens existentes: o painel usa o chrome de `card-checkout-summary`
// (canvas, rounded-xl, elevação nível 2) e o overlay usa a mesma tinta
// escura translúcida que o DESIGN.md já usa para legibilidade sobre fotos.
export function Modal({ aberto, aoFechar, titulo, children, className }: ModalProps) {
  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") aoFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto, aoFechar]);

  if (!aberto) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(10,19,23,0.5)] p-base"
      onClick={aoFechar}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(evento) => evento.stopPropagation()}
        className={cn(
          "w-full max-w-[480px] rounded-xl border border-hairline-soft bg-canvas p-xl shadow-[rgba(20,22,26,0.3)_0px_1px_4px_0px]",
          className,
        )}
      >
        {titulo && <h2 className="mb-base text-heading-sm text-ink-deep">{titulo}</h2>}
        {children}
      </div>
    </div>
  );
}
