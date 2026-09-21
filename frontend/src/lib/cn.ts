// Concatenação simples de classes condicionais — evita puxar uma lib (clsx)
// só para isso num projeto em fase de validação.
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
