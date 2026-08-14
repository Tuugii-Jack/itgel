import { money } from "@/lib/format";
import type { OptionPrice, ProductOption } from "@/lib/types";

/** Сонголтуудыг «Хэмжээ: M · Өнгө: Хар» хэлбэрээр. */
export function formatSelections(
  selections?: Record<string, string> | null,
  size?: string | null,
  color?: string | null,
): string {
  if (selections && Object.keys(selections).length > 0) {
    return Object.entries(selections)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" · ");
  }
  return [size, color].filter(Boolean).join(" · ");
}

export function formatOptionsSummary(options: ProductOption[] | undefined): string {
  if (!options || options.length === 0) return "—";
  return options.map((o) => `${o.name}: ${o.values.join(", ")}`).join(" · ");
}

const PRICE_KIND_PRIORITY = ["Хэмжээ", "SIZE", "Багтаамж"];

export function pricedOptionName(options: { name: string }[] | undefined): string | null {
  if (!options?.length) return null;
  const preferred = options.find((o) => PRICE_KIND_PRIORITY.includes(o.name));
  return (preferred ?? options[0])!.name;
}

export function priceForSelections(
  basePrice: number,
  optionPrices: OptionPrice[] | undefined,
  selections: Record<string, string>,
): number {
  if (!optionPrices?.length) return basePrice;
  const hits = optionPrices.filter((row) => selections[row.kind] === row.value);
  if (hits.length === 0) return basePrice;
  const amount = (row: OptionPrice) => row.price ?? row.sellPrice ?? basePrice;
  for (const kind of PRICE_KIND_PRIORITY) {
    const hit = hits.find((h) => h.kind === kind);
    if (hit) return amount(hit);
  }
  return amount(hits[0]!);
}

export function optionValuePrice(
  optionPrices: OptionPrice[] | undefined,
  kind: string,
  value: string,
  fallback: number,
): number {
  const row = optionPrices?.find((p) => p.kind === kind && p.value === value);
  return row ? (row.price ?? row.sellPrice ?? fallback) : fallback;
}

export function hasPriceRange(price: number, priceMax?: number): boolean {
  return priceMax != null && priceMax > price;
}

export function priceLabel(price: number, priceMax?: number): string {
  return hasPriceRange(price, priceMax) ? `${money(price)}-с` : money(price);
}

export const OPTION_PRESETS = [
  "Хэмжээ",
  "Өнгө",
  "Багтаамж",
  "Материал",
  "Загвар",
  "Амт",
] as const;
