import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type VarianteBadge = "success" | "attention" | "warning" | "critical" | "neutro";

// Mapeamento direto para os badges do DESIGN.md: success/attention/critical
// usam os componentes de mesmo nome; "warning" usa o chrome de
// `badge-promo-yellow` (fundo warning, texto ink-deep) — é o único badge
// amarelo do sistema e cumpre o papel semântico de aviso pedido aqui.
// "neutro" não existe no DESIGN.md (extraído de e-commerce, sem estado de
// "rascunho"/pendente) — segue o mesmo precedente do Toast, que já tem uma
// variante "neutro" própria, usando só tokens de cinza já existentes
// (hairline-soft/steel), sem inventar cor nova.
const estilosPorVariante: Record<VarianteBadge, string> = {
  success: "bg-success text-canvas",
  attention: "bg-attention text-canvas",
  warning: "bg-warning text-ink-deep",
  critical: "bg-critical text-canvas",
  neutro: "bg-hairline-soft text-steel",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variante: VarianteBadge;
}

export function Badge({ variante, className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-[10px] py-[4px] text-caption-bold",
        estilosPorVariante[variante],
        className,
      )}
      {...props}
    />
  );
}
