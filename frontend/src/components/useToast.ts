import { useContext } from "react";
import { ToastContext } from "./Toast";

export function useToast() {
  const contexto = useContext(ToastContext);
  if (!contexto) {
    throw new Error("useToast precisa estar dentro de <ToastProvider>");
  }
  return contexto;
}
