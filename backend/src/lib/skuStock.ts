import type { Prisma } from '@prisma/client';
import { selectionsOf } from './options.js';

export type SkuStockRow = {
  selections: Record<string, string>;
  stock: number;
};

/** Сонголтын хослолыг тогтвортой түлхүүр болгоно. */
export function skuKeyOf(selections: Record<string, string>): string {
  return Object.keys(selections)
    .sort((a, b) => a.localeCompare(b, 'mn'))
    .map((k) => `${k}=${selections[k]}`)
    .join('|');
}

export function comboLabel(selections: Record<string, string>): string {
  return Object.values(selections).filter(Boolean).join(' · ');
}

export function optionCombinations(
  options: { name: string; values: string[] }[] | undefined,
): Record<string, string>[] {
  const groups = (options ?? []).filter((o) => o.name.trim() && o.values.length > 0);
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

export function skuStockSum(rows: { stock: number }[] | undefined): number | undefined {
  if (!rows?.length) return undefined;
  return rows.reduce((sum, r) => sum + r.stock, 0);
}

export function findSku<T extends { skuKey: string }>(
  rows: T[] | undefined,
  selections: Record<string, string>,
): T | null {
  if (!rows?.length) return null;
  const key = skuKeyOf(selections);
  return rows.find((r) => r.skuKey === key) ?? null;
}

export function publicSkuStocks(
  rows: { selections: unknown; stock: number }[] | undefined,
): SkuStockRow[] {
  return (rows ?? []).map((r) => ({
    selections: selectionsOf(r.selections),
    stock: r.stock,
  }));
}

export async function replaceRoundSkuStocks(
  tx: Prisma.TransactionClient,
  roundId: string,
  rows: SkuStockRow[] | undefined,
): Promise<void> {
  if (rows === undefined) return;
  await tx.roundSkuStock.deleteMany({ where: { roundId } });
  const clean = rows.filter(
    (r) => Object.keys(r.selections).length > 0 && Number.isFinite(r.stock),
  );
  if (clean.length === 0) return;
  await tx.roundSkuStock.createMany({
    data: clean.map((r) => ({
      roundId,
      skuKey: skuKeyOf(r.selections),
      selections: r.selections,
      stock: Math.max(0, Math.trunc(r.stock)),
    })),
  });
}
