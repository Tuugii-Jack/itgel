import type { Prisma } from '@prisma/client';

export type OptionPriceRow = {
  kind: string;
  value: string;
  sellPrice: number;
  costPrice: number;
};

/** Үнэ ялгаатай байж болох бүлгийн дараалал — хэмжээ/багтаамж өнгөнөөс өмнө. */
const PRICE_KIND_PRIORITY = ['Хэмжээ', 'SIZE', 'Багтаамж'];

export function pricedOptionName(options: { name: string }[]): string | null {
  if (options.length === 0) return null;
  const preferred = options.find((o) => PRICE_KIND_PRIORITY.includes(o.name));
  return (preferred ?? options[0])!.name;
}

export function resolveOptionPrice(
  base: { sellPrice: number; costPrice: number },
  optionPrices: OptionPriceRow[] | undefined,
  selections: Record<string, string>,
): { sellPrice: number; costPrice: number } {
  if (!optionPrices?.length) return base;
  const hits = optionPrices.filter((row) => selections[row.kind] === row.value && row.sellPrice > 0);
  if (hits.length === 0) return base;
  for (const kind of PRICE_KIND_PRIORITY) {
    const hit = hits.find((h) => h.kind === kind);
    if (hit) return { sellPrice: hit.sellPrice, costPrice: hit.costPrice };
  }
  return { sellPrice: hits[0]!.sellPrice, costPrice: hits[0]!.costPrice };
}

export function displayPriceRange(
  baseSell: number,
  optionPrices: OptionPriceRow[] | undefined,
): { price: number; priceMax: number } {
  const rows = (optionPrices ?? []).filter((r) => r.sellPrice > 0);
  if (rows.length === 0) return { price: baseSell, priceMax: baseSell };
  const kinds = [...new Set(rows.map((r) => r.kind))];
  const kind = PRICE_KIND_PRIORITY.find((k) => kinds.includes(k)) ?? kinds[0]!;
  const prices = rows.filter((r) => r.kind === kind).map((r) => r.sellPrice);
  return { price: Math.min(...prices), priceMax: Math.max(...prices) };
}

export function publicOptionPrices(optionPrices: OptionPriceRow[] | undefined) {
  return (optionPrices ?? [])
    .filter((r) => r.sellPrice > 0)
    .map((r) => ({ kind: r.kind, value: r.value, price: r.sellPrice }));
}

export function adminOptionPrices(optionPrices: OptionPriceRow[] | undefined) {
  return (optionPrices ?? []).map((r) => ({
    kind: r.kind,
    value: r.value,
    price: r.sellPrice,
    sellPrice: r.sellPrice,
    costPrice: r.costPrice,
  }));
}

export async function replaceRoundOptionPrices(
  tx: Prisma.TransactionClient,
  roundId: string,
  rows: OptionPriceRow[] | undefined,
): Promise<void> {
  if (rows === undefined) return;
  await tx.roundOptionPrice.deleteMany({ where: { roundId } });
  const clean = rows.filter((r) => r.sellPrice > 0 && r.kind.trim() && r.value.trim());
  if (clean.length === 0) return;
  await tx.roundOptionPrice.createMany({
    data: clean.map((r) => ({
      roundId,
      kind: r.kind.trim(),
      value: r.value.trim(),
      sellPrice: r.sellPrice,
      costPrice: Math.max(0, r.costPrice),
    })),
  });
}
