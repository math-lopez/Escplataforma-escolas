import { useId, type InputHTMLAttributes } from "react";
import { cn } from "../lib/cn";

interface CampoProps extends InputHTMLAttributes<HTMLInputElement> {
  rotulo: string;
  erro?: string;
}

// `{text-input}` do DESIGN.md: 44px de altura, rounded-lg, borda hairline;
// foco vira borda 2px fb-blue; erro vira borda 1px critical-strong com
// legenda embaixo. Sempre com label associado (acessibilidade), nunca só
// placeholder.
export function Campo({ rotulo, erro, id, className, ...props }: CampoProps) {
  const idGerado = useId();
  const inputId = id ?? idGerado;
  const erroId = `${inputId}-erro`;

  return (
    <div className="flex flex-col gap-xxs">
      <label htmlFor={inputId} className="text-body-sm-bold text-ink">
        {rotulo}
      </label>
      <input
        id={inputId}
        className={cn(
          "h-11 rounded-lg border bg-canvas px-md text-body-md text-ink outline-none",
          erro ? "border-critical-strong" : "border-hairline focus:border-2 focus:border-fb-blue",
          className,
        )}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? erroId : undefined}
        {...props}
      />
      {erro && (
        <p id={erroId} role="alert" className="text-body-sm text-critical-strong">
          {erro}
        </p>
      )}
    </div>
  );
}
