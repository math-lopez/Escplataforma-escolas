import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type VarianteBotao = "primary" | "secondary" | "ghost" | "accent" | "perigo";

interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBotao;
}

// Botões são SEMPRE pill (DESIGN.md: {rounded.full}) — o sistema não tem
// variante quadrada. `accent` é a única que usa `bg-primary`/`text-on-primary`,
// as CSS vars que o TemaProvider sobrescreve com a cor da instituição na área
// logada; `primary`/`secondary`/`ghost` são fixas (preto/outline) e servem
// as telas anônimas de marketing, como o DESIGN.md especifica. `perigo` não
// está no DESIGN.md (IDS de e-commerce sem ação destrutiva) — usa o token
// `critical` que a spec já reserva para "destructive feedback", só
// aplicado a botão em vez de badge/borda de input.
const layoutPorVariante: Record<VarianteBotao, string> = {
  primary: "px-[30px] py-[14px]",
  secondary: "px-[28px] py-[12px] border-2",
  ghost: "px-[22px] py-[10px] border-2",
  accent: "px-[30px] py-[14px]",
  perigo: "px-[30px] py-[14px]",
};

// Sem hover documentado no DESIGN.md (política explícita de não documentar
// hover) — os estados abaixo adicionam um hover discreto por usabilidade,
// mas o default e o pressed seguem a spec (`button-primary-pressed` vira
// charcoal; accent não tem um "-deep" fixo porque a cor é arbitrária por
// instituição, então usamos um filtro de brilho genérico).
const corPorVariante: Record<VarianteBotao, string> = {
  primary: "bg-ink-button text-on-ink-button hover:bg-charcoal active:bg-charcoal",
  secondary: "bg-transparent text-ink-deep border-ink-deep hover:bg-surface-soft",
  ghost: "bg-transparent text-ink-deep border-[rgba(10,19,23,0.12)] hover:bg-surface-soft",
  accent: "bg-primary text-on-primary hover:brightness-95 active:brightness-90",
  perigo: "bg-critical text-canvas hover:brightness-95 active:brightness-90",
};

const corDesabilitado = "bg-disabled-text text-canvas border-transparent";

export const Botao = forwardRef<HTMLButtonElement, BotaoProps>(function Botao(
  { variante = "primary", className, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center rounded-full text-button-md transition-colors disabled:cursor-not-allowed",
        layoutPorVariante[variante],
        disabled ? corDesabilitado : corPorVariante[variante],
        className,
      )}
      {...props}
    />
  );
});
