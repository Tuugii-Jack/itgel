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
  selections: Record<string, string>;
  /** Нийцүүлэлт. */
  size: string | null;
  color: string | null;
  qty: number;
  /** Бүлэглэхэд ашиглана — "9-р сарын 12-16-нд ирнэ". */
  arriveFrom: string;
  arriveTo: string;
  stock: number;
}

const KEY = "itgel.cart.v2";

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
  a.productId === b.productId &&
  JSON.stringify(a.selections ?? {}) === JSON.stringify(b.selections ?? {});

function normalizeLine(raw: Partial<CartLine> & { productId: string }): CartLine | null {
  if (!raw.productId || !raw.name || typeof raw.price !== "number") return null;
  const selections =
    raw.selections && typeof raw.selections === "object"
      ? raw.selections
      : {
          ...(raw.size ? { Хэмжээ: raw.size } : {}),
          ...(raw.color ? { Өнгө: raw.color } : {}),
        };
  return {
    productId: raw.productId,
    name: raw.name,
    price: raw.price,
    image: raw.image ?? null,
    type: raw.type === "ready" ? "ready" : "order",
    selections,
    size: raw.size ?? selections["Хэмжээ"] ?? null,
    color: raw.color ?? selections["Өнгө"] ?? null,
    qty: Math.max(1, raw.qty ?? 1),
    arriveFrom: raw.arriveFrom ?? "",
    arriveTo: raw.arriveTo ?? "",
    stock: raw.stock ?? 0,
  };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY) ?? window.localStorage.getItem("itgel.cart.v1");
      if (raw) {
        const parsed = JSON.parse(raw) as unknown[];
        if (Array.isArray(parsed)) {
          setLines(
            parsed
              .map((row) => normalizeLine(row as Partial<CartLine> & { productId: string }))
              .filter((row): row is CartLine => row !== null),
          );
        }
      }
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
