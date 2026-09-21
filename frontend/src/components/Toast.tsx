import { createContext, useCallback, useMemo, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";

export type VarianteToast = "success" | "critical" | "neutro";

interface ItemToast {
  id: number;
  mensagem: string;
  variante: VarianteToast;
}

export interface ToastContextValue {
  notificar: (mensagem: string, variante?: VarianteToast) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

// Toast não existe no DESIGN.md (mesma lacuna do modal — IDS de e-commerce
// sem esse padrão). Segue a linguagem de `promo-banner` (fundo sólido, texto
// canvas, body-sm-bold), só que flutuante e com o rounded-lg dos cards.
const estilosPorVariante: Record<VarianteToast, string> = {
  success: "bg-success text-canvas",
  critical: "bg-critical text-canvas",
  neutro: "bg-ink-deep text-canvas",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [itens, setItens] = useState<ItemToast[]>([]);

  const notificar = useCallback((mensagem: string, variante: VarianteToast = "neutro") => {
    const id = Date.now() + Math.random();
    setItens((atual) => [...atual, { id, mensagem, variante }]);
    setTimeout(() => {
      setItens((atual) => atual.filter((item) => item.id !== id));
    }, 4000);
  }, []);

  const value = useMemo(() => ({ notificar }), [notificar]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-base left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-xs">
        {itens.map((item) => (
          <div
            key={item.id}
            role="status"
            className={cn(
              "pointer-events-auto rounded-lg px-base py-md text-body-sm-bold shadow-[rgba(20,22,26,0.3)_0px_1px_4px_0px]",
              estilosPorVariante[item.variante],
            )}
          >
            {item.mensagem}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
