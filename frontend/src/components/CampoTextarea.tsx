import { useId, type TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn";

interface CampoTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  rotulo: string;
  erro?: string;
}

// Irmão do Campo (input) para texto longo — o DESIGN.md não distingue input
// de textarea, então herda a mesma borda/raio/cor de `{text-input}` e só
// solta a altura fixa de 44px (governada por `rows` em vez de height).
export function CampoTextarea({ rotulo, erro, id, className, ...props }: CampoTextareaProps) {
  const idGerado = useId();
  const inputId = id ?? idGerado;
  const erroId = `${inputId}-erro`;

  return (
    <div className="flex flex-col gap-xxs">
      <label htmlFor={inputId} className="text-body-sm-bold text-ink">
        {rotulo}
      </label>
      <textarea
        id={inputId}
        className={cn(
          "rounded-lg border bg-canvas px-md py-sm text-body-md text-ink outline-none",
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
