import { money } from "@/lib/format";
import type { OptionPrice, ProductOption, SkuStock } from "@/lib/types";

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

export function skuKeyOf(selections: Record<string, string>): string {
  return Object.keys(selections)
    .sort((a, b) => a.localeCompare(b, "mn"))
    .map((k) => `${k}=${selections[k]}`)
    .join("|");
}

export function optionCombinations(
  options: ProductOption[] | undefined,
): Record<string, string>[] {
  const groups = (options ?? []).filter((o) => o.values.length > 0);
  if (groups.length === 0) return [];
  return groups.reduce<Record<string, string>[]>((acc, opt) => {
    const base = acc.length > 0 ? acc : [{}];
    const next: Record<string, string>[] = [];
    for (const prev of base) {
      for (const value of opt.values) {
        next.push({ ...prev, [opt.name]: value });
      }
    }
    return next;
  }, []);
}

function skuMatches(sku: SkuStock, partial: Record<string, string>): boolean {
  return Object.entries(partial).every(
    ([kind, value]) => !value || sku.selections[kind] === value,
  );
}

/** Сонгосон хослолын үлдэгдэл. Бүх сонголт хийгдээгүй эсвэл SKU байхгүй бол null. */
export function selectedSkuStock(
  skuStocks: SkuStock[] | undefined,
  selections: Record<string, string>,
  options: ProductOption[] | undefined,
): number | null {
  if (!skuStocks?.length) return null;
  if ((options ?? []).some((o) => !selections[o.name])) return null;
  const key = skuKeyOf(selections);
  const hit = skuStocks.find((s) => skuKeyOf(s.selections) === key);
  return hit ? hit.stock : 0;
}

/** Энэ утгыг сонговол нийцэх бүх хослол 0 эсэх. */
export function optionValueSoldOut(
  skuStocks: SkuStock[] | undefined,
  selections: Record<string, string>,
  kind: string,
  value: string,
): boolean {
  if (!skuStocks?.length) return false;
  const matching = skuStocks.filter((s) =>
    skuMatches(s, { ...selections, [kind]: value }),
  );
  return matching.length > 0 && matching.every((s) => s.stock <= 0);
}

export function skuStockSum(skuStocks: SkuStock[] | undefined): number | undefined {
  if (!skuStocks?.length) return undefined;
  return skuStocks.reduce((sum, s) => sum + s.stock, 0);
}

export function productSoldOut(product: {
  type?: string;
  status?: string;
  stock: number;
  skuStocks?: SkuStock[];
}): boolean {
  if (product.status === "SOLD_OUT") return true;
  if (product.type === "order") return false;
  if (product.skuStocks && product.skuStocks.length > 0) {
    return product.skuStocks.every((s) => s.stock <= 0);
  }
  return product.stock <= 0;
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
