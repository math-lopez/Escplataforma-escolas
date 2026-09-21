import { cn } from "../lib/cn";

interface SpinnerProps {
  className?: string;
}

// O DESIGN.md não define spinner (IDS de e-commerce estático, sem estado de
// carregamento assíncrono). Anel simples via border + animate-spin do
// Tailwind; a cor de base usa `hairline` (trilha) e `ink-deep` (traço) —
// nunca `primary`, porque este componente também aparece antes do
// TemaProvider decidir a cor da instituição (ex: RotaProtegida).
export function Spinner({ className }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label="Carregando"
      className={cn(
        "h-8 w-8 animate-spin rounded-full border-2 border-hairline border-t-ink-deep",
        className,
      )}
    />
  );
}
