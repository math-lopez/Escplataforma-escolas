import { cn } from "../lib/cn";

interface BarraProgressoProps {
  percentual: number;
  className?: string;
}

// O DESIGN.md não tem barra de progresso (IDS de e-commerce sem upload).
// Trilha em `hairline-soft` e preenchimento em `primary` — a mesma variável
// que o TemaProvider sobrescreve com a cor da instituição, então a barra
// já nasce white-label sem precisar de um token novo.
export function BarraProgresso({ percentual, className }: BarraProgressoProps) {
  const valor = Math.min(100, Math.max(0, percentual));
  return (
    <div
      role="progressbar"
      aria-valuenow={valor}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-hairline-soft", className)}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-200"
        style={{ width: `${valor}%` }}
      />
    </div>
  );
}
