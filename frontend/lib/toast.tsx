"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/*
 * Хөнгөн toast мэдэгдэл — амжилт/алдааг товч харуулаад алга болно.
 * Инлайн ErrorNote-г орлохгүй: маягтын алдаа хэвээрээ инлайн, харин
 * «үйлдэл амжилттай боллоо» болон дэлгэцэд эзэнгүй алдаанд toast хэрэглэнэ.
 */

type ToastKind = "success" | "error";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DURATION_MS = { success: 3000, error: 5000 } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev.slice(-2), { id, kind, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, DURATION_MS[kind]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push("success", message),
      error: (message) => push("error", message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              role="status"
              className={`toast-in pointer-events-auto flex max-w-[420px] items-start gap-2.5 rounded-[10px] border px-4 py-3 text-[14px] leading-[1.5] shadow-[0_4px_16px_rgba(20,20,25,0.10)]
                ${
                  toast.kind === "success"
                    ? "border-line bg-ink text-white"
                    : "border-danger-bg bg-danger-bg text-danger"
                }`}
            >
              {toast.kind === "success" ? (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mt-[3px] shrink-0"
                  aria-hidden
                >
                  <path d="M3 8.4 L6.4 11.6 L13 4.8" />
                </svg>
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mt-[3px] shrink-0"
                  aria-hidden
                >
                  <circle cx="8" cy="8" r="6.6" />
                  <path d="M8 4.8v3.8M8 11.2h.01" />
                </svg>
              )}
              <span className="min-w-0">{toast.message}</span>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast нь ToastProvider дотор л ажиллана.");
  return api;
}
