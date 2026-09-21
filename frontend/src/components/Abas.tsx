import { cn } from "../lib/cn";

interface ItemAba {
  id: string;
  rotulo: string;
}

interface AbasProps {
  itens: ItemAba[];
  ativa: string;
  aoSelecionar: (id: string) => void;
  className?: string;
}

// `button-pill-tab` / `button-pill-tab-active` do DESIGN.md: inativa tem
// borda hairline sobre canvas; ativa vira preenchimento ink-deep sem borda
// (o fill escuro substitui a borda, como a spec descreve).
export function Abas({ itens, ativa, aoSelecionar, className }: AbasProps) {
  return (
    <div role="tablist" className={cn("flex flex-wrap gap-xs", className)}>
      {itens.map((item) => {
        const ativo = item.id === ativa;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={ativo}
            onClick={() => aoSelecionar(item.id)}
            className={cn(
              "rounded-full px-base py-xs text-body-sm-bold transition-colors",
              ativo
                ? "bg-ink-deep text-canvas"
                : "border border-hairline bg-canvas text-ink hover:bg-surface-soft",
            )}
          >
            {item.rotulo}
          </button>
        );
      })}
    </div>
  );
}
