// Helper de contraste texto/fundo (WCAG 2.x).
//
// Por quê: a instituição escolhe livremente a `cor_primaria` (branding do
// tenant). Se ela cair num amarelo ou ciano claro, texto branco fixo em cima
// vira ilegível — e um botão ilegível é um bug de produto, não só de estilo.
// Em vez de decidir por um limiar simples de luminância (que erra perto do
// meio da escala), calculamos o contraste real contra as duas opções que o
// design system oferece (tinta clara e tinta escura) e escolhemos a que
// ganha — é o método recomendado pelo próprio WCAG para "pick black or
// white text". Ver PLANO-MVP.md §6.2.

const CLARO = "#ffffff"; // {colors.on-primary} / {colors.canvas}
const ESCURO = "#0a1317"; // {colors.ink-deep}

function normalizarHex(cor: string): string | null {
  let hex = cor.trim().replace(/^#/, "");
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return hex;
}

/**
 * `cor_primaria` vem do banco, escrita por um usuário da instituição, e é
 * injetada como CSS custom property (ver TemaProvider) — inclusive na
 * página pública `/i/{slug}`, vista por terceiros. `luminanciaRelativa`
 * abaixo já precisa de um fallback para hex inválido (por isso devolve 1,
 * "assume claro"), mas esse fallback só é seguro *dentro* deste módulo,
 * onde ele participa dos dois lados do cálculo de contraste. Fora daqui,
 * quem for aplicar a cor de fato (TemaProvider) precisa saber que ela é
 * inválida ANTES de decidir a cor do texto — senão a cor de fundo (rejeitada
 * pelo navegador, ficando no default) e a cor do texto (calculada como se o
 * fundo fosse válido) dessincronizam, produzindo uma combinação ilegível.
 * `corValida` existe para fechar essa porta: só aplicar as duas variáveis
 * juntas, ou nenhuma.
 */
export function corValida(cor: string): boolean {
  return normalizarHex(cor) !== null;
}

function paraRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return [r, g, b];
}

function canalLinear(canal8bit: number): number {
  const c = canal8bit / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminância relativa (0 a 1) de uma cor hex, fórmula WCAG. */
export function luminanciaRelativa(corHex: string): number {
  const hex = normalizarHex(corHex);
  if (!hex) return 1; // cor inválida: assume claro, texto escuro por segurança
  const [r, g, b] = paraRgb(hex);
  return 0.2126 * canalLinear(r) + 0.7152 * canalLinear(g) + 0.0722 * canalLinear(b);
}

/** Razão de contraste WCAG entre duas cores hex (1 a 21). */
export function razaoDeContraste(corA: string, corB: string): number {
  const lA = luminanciaRelativa(corA);
  const lB = luminanciaRelativa(corB);
  const [claro, escuro] = lA >= lB ? [lA, lB] : [lB, lA];
  return (claro + 0.05) / (escuro + 0.05);
}

/**
 * Dado um fundo arbitrário (a cor da instituição), devolve a cor de texto
 * com melhor contraste entre branco e o ink-deep do design system — nunca
 * uma combinação ilegível, qualquer que seja a cor escolhida pelo tenant.
 */
export function corDeTextoIdeal(corFundo: string): string {
  const contrasteComClaro = razaoDeContraste(corFundo, CLARO);
  const contrasteComEscuro = razaoDeContraste(corFundo, ESCURO);
  return contrasteComEscuro >= contrasteComClaro ? ESCURO : CLARO;
}
