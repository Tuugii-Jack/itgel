"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  CART_LEGACY_KEY,
  CART_STORAGE_KEY,
  mergeCartLine,
  parseCartJson,
  type CartLine,
} from "./cartParse";

export type { CartLine };

/**
 * Сагс зөвхөн браузерт хадгалагдана — backend дээр сагсны төлөв байхгүй.
 * Захиалга үүсгэх үед л сервер рүү явна.
 */
interface CartContext {
  lines: CartLine[];
  ready: boolean;
  count: number;
  subtotal: number;
  add: (line: CartLine) => void;
  setQty: (index: number, qty: number) => void;
  remove: (index: number) => void;
  clear: () => void;
}

const Ctx = createContext<CartContext | null>(null);

type CartSnapshot = { lines: CartLine[]; ready: boolean };

const serverSnapshot: CartSnapshot = { lines: [], ready: false };
let snapshot: CartSnapshot = serverSnapshot;
const listeners = new Set<() => void>();

function emit(next: CartSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function persist(lines: CartLine[]) {
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(lines));
  } catch {
    /* quota / private mode */
  }
}

function readStoredLines(): CartLine[] {
  try {
    const raw =
      window.localStorage.getItem(CART_STORAGE_KEY) ??
      window.localStorage.getItem(CART_LEGACY_KEY);
    return parseCartJson(raw);
  } catch {
    return [];
  }
}

function hydrateCart() {
  if (snapshot.ready) return;
  const lines = readStoredLines();
  persist(lines);
  emit({ lines, ready: true });
}

function setCartLines(lines: CartLine[]) {
  persist(lines);
  emit({ lines, ready: true });
}

function subscribeCart(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getCartSnapshot() {
  return snapshot;
}

function getServerCartSnapshot() {
  return serverSnapshot;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { lines, ready } = useSyncExternalStore(
    subscribeCart,
    getCartSnapshot,
    getServerCartSnapshot,
  );

  useEffect(() => {
    hydrateCart();
  }, []);

  const add = useCallback((line: CartLine) => {
    setCartLines(mergeCartLine(snapshot.lines, line));
  }, []);

  const setQty = useCallback((index: number, qty: number) => {
    setCartLines(
      snapshot.lines.map((line, i) => (i === index ? { ...line, qty: Math.max(1, qty) } : line)),
    );
  }, []);

  const remove = useCallback((index: number) => {
    setCartLines(snapshot.lines.filter((_, i) => i !== index));
  }, []);

  const clear = useCallback(() => setCartLines([]), []);

  const value = useMemo<CartContext>(
    () => ({
      lines,
      ready,
      count: lines.reduce((sum, l) => sum + l.qty, 0),
      subtotal: lines.reduce((sum, l) => sum + l.price * l.qty, 0),
      add,
      setQty,
      remove,
      clear,
    }),
    [lines, ready, add, setQty, remove, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart(): CartContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCart нь CartProvider дотор байх ёстой.");
  return ctx;
}
