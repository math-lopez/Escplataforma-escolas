import type { ReactNode } from "react";
import { Card } from "./Card";

interface EstadoVazioProps {
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
}

// O DESIGN.md não tem um "estado vazio" (páginas de e-commerce sempre têm
// produto pra mostrar). Reaproveita o chrome do Card-base, centralizado e com
// respiro extra (`spacing.xxxl` vertical), pra não parecer uma tela quebrada
// na primeira coisa que uma conta nova vê — é uma chamada para ação, não um erro.
export function EstadoVazio({ titulo, descricao, acao }: EstadoVazioProps) {
  return (
    <Card className="flex flex-col items-center gap-base py-xxxl text-center">
      <h2 className="text-heading-sm text-ink-deep">{titulo}</h2>
      {descricao && <p className="max-w-[420px] text-body-md text-steel">{descricao}</p>}
      {acao}
    </Card>
  );
}
