"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Сагс зөвхөн браузерт хадгалагдана — backend дээр сагсны төлөв байхгүй.
 * Захиалга үүсгэх үед л сервер рүү явна.
 */
export interface CartLine {
  productId: string;
  name: string;
  price: number;
  image: string | null;
  type: "order" | "ready";
  size: string | null;
  color: string | null;
  qty: number;
  /** Бүлэглэхэд ашиглана — "9-р сарын 12-16-нд ирнэ". */
  arriveFrom: string;
  arriveTo: string;
  stock: number;
}

const KEY = "itgel.cart.v1";

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

const sameLine = (a: CartLine, b: CartLine) =>
  a.productId === b.productId && a.size === b.size && a.color === b.color;

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) setLines(JSON.parse(raw) as CartLine[]);
    } catch {
      // Гэмтсэн өгөгдөл — хоосон сагснаас эхэлнэ.
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(KEY, JSON.stringify(lines));
  }, [lines, ready]);

  const add = useCallback((line: CartLine) => {
    setLines((prev) => {
      const index = prev.findIndex((l) => sameLine(l, line));
      if (index === -1) return [...prev, line];
      const next = [...prev];
      const merged = { ...next[index]!, qty: next[index]!.qty + line.qty };
      // Бэлэн барааны үлдэгдлээс хэтрүүлэхгүй.
      if (merged.type === "ready" && merged.stock > 0) {
        merged.qty = Math.min(merged.qty, merged.stock);
      }
      next[index] = merged;
      return next;
    });
  }, []);

  const setQty = useCallback((index: number, qty: number) => {
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, qty: Math.max(1, qty) } : line)),
    );
  }, []);

  const remove = useCallback((index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clear = useCallback(() => setLines([]), []);

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
