import type { Prisma } from '@prisma/client';
import { selectionsOf } from './options.js';
import { skuKeyOf } from './skuStock.js';

export type OptionPriceRow = {
  kind?: string;
  value?: string;
  selections?: unknown;
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

export function priceRowSelections(row: OptionPriceRow): Record<string, string> {
  const fromJson = selectionsOf(row.selections);
  if (Object.keys(fromJson).length > 0) return fromJson;
  const kind = row.kind?.trim();
  const value = row.value?.trim();
  if (kind && value) return { [kind]: value };
  return {};
}

function isSubsetOf(
  rowSel: Record<string, string>,
  selections: Record<string, string>,
): boolean {
  const keys = Object.keys(rowSel);
  if (keys.length === 0) return false;
  return keys.every((k) => selections[k] === rowSel[k]);
}

function kindRank(kind: string): number {
  const i = PRICE_KIND_PRIORITY.indexOf(kind);
  return i === -1 ? PRICE_KIND_PRIORITY.length : i;
}

/**
 * Хослолын үнэ: эхлээд яг таарсан SKU, дараа нь хамгийн олон талбартай дэд хослол
 * (хуучин «зөвхөн хэмжээ» мөрүүд ажиллана), эцэст нь үндсэн үнэ.
 */
export function resolveOptionPrice(
  base: { sellPrice: number; costPrice: number },
  optionPrices: OptionPriceRow[] | undefined,
  selections: Record<string, string>,
): { sellPrice: number; costPrice: number } {
  if (!optionPrices?.length) return base;
  const priced = optionPrices.filter((row) => row.sellPrice > 0);
  if (priced.length === 0) return base;

  const exactKey = skuKeyOf(selections);
  if (exactKey) {
    const exact = priced.find((row) => skuKeyOf(priceRowSelections(row)) === exactKey);
    if (exact) return { sellPrice: exact.sellPrice, costPrice: exact.costPrice };
  }

  const subsets = priced.filter((row) => isSubsetOf(priceRowSelections(row), selections));
  if (subsets.length === 0) return base;

  subsets.sort((a, b) => {
    const aSel = priceRowSelections(a);
    const bSel = priceRowSelections(b);
    const byKeys = Object.keys(bSel).length - Object.keys(aSel).length;
    if (byKeys !== 0) return byKeys;
    const aKind = Object.keys(aSel)[0] ?? '';
    const bKind = Object.keys(bSel)[0] ?? '';
    return kindRank(aKind) - kindRank(bKind);
  });
  const hit = subsets[0]!;
  return { sellPrice: hit.sellPrice, costPrice: hit.costPrice };
}

export function displayPriceRange(
  baseSell: number,
  optionPrices: OptionPriceRow[] | undefined,
): { price: number; priceMax: number } {
  const rows = (optionPrices ?? []).filter((r) => r.sellPrice > 0);
  if (rows.length === 0) return { price: baseSell, priceMax: baseSell };
  const prices = rows.map((r) => r.sellPrice);
  return { price: Math.min(...prices), priceMax: Math.max(...prices) };
}

export function publicOptionPrices(optionPrices: OptionPriceRow[] | undefined) {
  return (optionPrices ?? [])
    .filter((r) => r.sellPrice > 0)
    .map((r) => {
      const selections = priceRowSelections(r);
      const keys = Object.keys(selections);
      return {
        kind: keys.length === 1 ? keys[0]! : (r.kind ?? ''),
        value: keys.length === 1 ? selections[keys[0]!]! : (r.value ?? ''),
        selections,
        price: r.sellPrice,
      };
    });
}

export function adminOptionPrices(optionPrices: OptionPriceRow[] | undefined) {
  return (optionPrices ?? []).map((r) => {
    const selections = priceRowSelections(r);
    const keys = Object.keys(selections);
    return {
      kind: keys.length === 1 ? keys[0]! : (r.kind ?? ''),
      value: keys.length === 1 ? selections[keys[0]!]! : (r.value ?? ''),
      selections,
      price: r.sellPrice,
      sellPrice: r.sellPrice,
      costPrice: r.costPrice,
    };
  });
}

export async function replaceRoundOptionPrices(
  tx: Prisma.TransactionClient,
  roundId: string,
  rows: OptionPriceRow[] | undefined,
): Promise<void> {
  if (rows === undefined) return;
  await tx.roundOptionPrice.deleteMany({ where: { roundId } });

  const byKey = new Map<string, { selections: Record<string, string>; sellPrice: number; costPrice: number }>();
  for (const r of rows) {
    if (!(r.sellPrice > 0)) continue;
    const selections = priceRowSelections(r);
    const skuKey = skuKeyOf(selections);
    if (!skuKey) continue;
    byKey.set(skuKey, {
      selections,
      sellPrice: r.sellPrice,
      costPrice: Math.max(0, r.costPrice),
    });
  }
  if (byKey.size === 0) return;

  await tx.roundOptionPrice.createMany({
    data: [...byKey.entries()].map(([skuKey, r]) => {
      const keys = Object.keys(r.selections);
      return {
        roundId,
        skuKey,
        selections: r.selections,
        kind: keys.length === 1 ? keys[0]! : '',
        value: keys.length === 1 ? r.selections[keys[0]!]! : '',
        sellPrice: r.sellPrice,
        costPrice: r.costPrice,
      };
    }),
  });
}
