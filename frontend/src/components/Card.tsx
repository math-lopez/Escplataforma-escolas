import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

// O DESIGN.md não nomeia um "card genérico" — mas `card-product-feature` e
// `card-icon-feature` convergem no mesmo chrome (canvas + hairline-soft +
// padding generoso), só variando o rounded e o padding. Usamos esse padrão
// comum como o card-base do produto (rounded-xl / padding xl).
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border border-hairline-soft bg-canvas p-xl", className)}
      {...props}
    />
  );
}
