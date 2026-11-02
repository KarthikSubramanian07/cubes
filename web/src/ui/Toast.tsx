import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import "./overlay.css";

export interface ToastOptions {
  /** Render the message in handwriting instead of the UI face. */
  hand?: boolean;
  tone?: "default" | "accent";
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  message: ReactNode;
}

interface ToastApi {
  show: (message: ReactNode, opts?: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

/** Polite live region of short-lived notes, bottom centre. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const show = useCallback(
    (message: ReactNode, opts: ToastOptions = {}) => {
      const id = nextId.current++;
      setItems((xs) => [...xs.slice(-2), { id, message, ...opts }]);
      window.setTimeout(() => dismiss(id), opts.duration ?? 3600);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={["toast", t.hand && "toast--hand", t.tone === "accent" && "toast--accent"].filter(Boolean).join(" ")}>
            <span>{t.message}</span>
            <button type="button" className="toast__x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
