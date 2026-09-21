import { useEffect, type ReactNode } from "react";
import { corDeTextoIdeal, corValida } from "../../lib/contraste";

interface TemaProviderProps {
  /** Cor da instituição (`cor_primaria`), ou `null`/`undefined` fora da área logada. */
  corPrimaria?: string | null;
  children: ReactNode;
}

/**
 * Aplica a `cor_primaria` da instituição sobrescrevendo, em runtime, as CSS
 * variables `--color-primary`/`--color-on-primary` declaradas em
 * src/index.css (que por padrão trazem o cobalto do DESIGN.md, usado nas
 * telas anônimas). Isso é o que permite branding por tenant sem recompilar
 * o CSS: `bg-primary`/`text-on-primary` continuam os mesmos utilitários
 * Tailwind, só o valor por trás muda.
 *
 * `--color-on-primary` não é fixo em branco: usamos o helper de contraste
 * (src/lib/contraste.ts) porque a instituição pode escolher qualquer cor,
 * incluindo tons claros onde texto branco ficaria ilegível.
 *
 * Só deve envolver a área autenticada — telas de marketing/login/cadastro
 * usam a identidade fixa do DESIGN.md e nunca passam por aqui.
 */
export function TemaProvider({ corPrimaria, children }: TemaProviderProps) {
  useEffect(() => {
    // `corPrimaria` é escrita pela instituição no banco e reaparece aqui (e
    // na página pública `/i/{slug}`, vista por terceiros) sem passar por
    // nenhum controle antes. Um hex inválido faria o navegador rejeitar
    // `--color-primary` (ficando no cobalto default) enquanto
    // `--color-on-primary` já teria sido calculado como se o fundo fosse
    // válido — as duas variáveis dessincronizam e produzem texto escuro
    // sobre o cobalto default, exatamente a combinação ilegível que esse
    // sistema existe para evitar. Por isso a validação vem antes de tudo:
    // ou as duas mudam juntas, ou a instituição fica com o default legível
    // do DESIGN.md.
    if (!corPrimaria || !corValida(corPrimaria)) return;

    const raiz = document.documentElement;
    raiz.style.setProperty("--color-primary", corPrimaria);
    raiz.style.setProperty("--color-on-primary", corDeTextoIdeal(corPrimaria));

    return () => {
      raiz.style.removeProperty("--color-primary");
      raiz.style.removeProperty("--color-on-primary");
    };
  }, [corPrimaria]);

  return <>{children}</>;
}
