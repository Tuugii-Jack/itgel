import type { InventoryOwnerKind } from "./types";

export interface CartLine {
  productId: string;
  name: string;
  price: number;
  image: string | null;
  type: "order" | "ready";
  selections: Record<string, string>;
  size: string | null;
  color: string | null;
  qty: number;
  arriveFrom: string;
  arriveTo: string;
  stock: number;
  ownerKind?: InventoryOwnerKind;
}

export const CART_STORAGE_KEY = "itgel.cart.v2";
export const CART_LEGACY_KEY = "itgel.cart.v1";

const sameSelections = (a: Record<string, string>, b: Record<string, string>) =>
  JSON.stringify(a) === JSON.stringify(b);

export const sameCartLine = (a: CartLine, b: CartLine) =>
  a.productId === b.productId && sameSelections(a.selections ?? {}, b.selections ?? {});

export function normalizeCartLine(
  raw: Partial<CartLine> & { productId?: string },
): CartLine | null {
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
    ownerKind: raw.ownerKind === "LEASING" ? "LEASING" : "SHOP",
  };
}

export function parseCartJson(raw: string | null): CartLine[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => normalizeCartLine(row as Partial<CartLine> & { productId?: string }))
      .filter((row): row is CartLine => row !== null);
  } catch {
    return [];
  }
}

export function mergeCartLine(prev: CartLine[], line: CartLine): CartLine[] {
  const index = prev.findIndex((row) => sameCartLine(row, line));
  if (index === -1) return [...prev, line];
  const next = [...prev];
  const merged = { ...next[index]!, qty: next[index]!.qty + line.qty };
  if (merged.type === "ready" && merged.stock > 0) {
    merged.qty = Math.min(merged.qty, merged.stock);
  }
  next[index] = merged;
  return next;
}
