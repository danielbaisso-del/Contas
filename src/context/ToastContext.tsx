import { createContext, useContext, useState, type ReactNode } from "react";

interface ToastItem {
  id: number;
  message: string;
  tone: "ok" | "error";
}

const ToastContext = createContext<(message: string, tone?: "ok" | "error") => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  function push(message: string, tone: "ok" | "error" = "ok") {
    const id = Date.now() + Math.random();
    setItems((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 4200);
  }
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[70] flex flex-col gap-2 lg:bottom-4 lg:left-auto lg:right-4 lg:w-[min(92vw,360px)]">
        {items.map((item) => (
          <div key={item.id} className={`rounded-2xl border px-4 py-3 text-sm shadow-lg ${item.tone === "error" ? "border-expense/40 bg-surface text-expense" : "border-line bg-surface text-ink"}`}>
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
