import type { Prisma } from '@prisma/client';
import { conflict } from './errors.js';
import { selectionsOf } from './options.js';

export type SkuStockRow = {
  selections: Record<string, string>;
  stock: number;
  reserved?: number;
  available?: number;
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
  rows: { selections: unknown; stock: number; reserved?: number; available?: number }[] | undefined,
  opts?: { availableAsStock?: boolean },
): SkuStockRow[] {
  return (rows ?? []).map((r) => {
    const available = r.available ?? Math.max(0, r.stock - (r.reserved ?? 0));
    if (opts?.availableAsStock) {
      return { selections: selectionsOf(r.selections), stock: available };
    }
    return {
      selections: selectionsOf(r.selections),
      stock: r.stock,
      reserved: r.reserved ?? 0,
      available,
    };
  });
}

export async function replaceRoundSkuStocks(
  tx: Prisma.TransactionClient,
  roundId: string,
  rows: SkuStockRow[] | undefined,
): Promise<void> {
  if (rows === undefined) return;
  const existing = await tx.roundSkuStock.findMany({
    where: { roundId },
    select: { skuKey: true, reserved: true },
  });
  const reservedByKey = new Map(existing.map((r) => [r.skuKey, r.reserved]));
  await tx.roundSkuStock.deleteMany({ where: { roundId } });
  const clean = rows.filter(
    (r) => Object.keys(r.selections).length > 0 && Number.isFinite(r.stock),
  );
  const created = clean.map((r) => {
    const stock = Math.max(0, Math.trunc(r.stock));
    const reserved = Math.max(0, reservedByKey.get(skuKeyOf(r.selections)) ?? 0);
    if (reserved > stock) {
      throw conflict(
        `${comboLabel(r.selections)}: нөөцлөгдсөн ${reserved} ширхэгээс бага үлдэгдэл тавих боломжгүй.`,
      );
    }
    return {
      roundId,
      skuKey: skuKeyOf(r.selections),
      selections: r.selections,
      stock,
      reserved,
      available: stock - reserved,
    };
  });
  if (created.length > 0) {
    await tx.roundSkuStock.createMany({ data: created });
    const stock = created.reduce((sum, r) => sum + r.stock, 0);
    const reserved = created.reduce((sum, r) => sum + r.reserved, 0);
    await tx.productRound.update({
      where: { id: roundId },
      data: {
        stock,
        reserved,
        available: Math.max(0, stock - reserved),
      },
    });
  }
}

export async function syncRoundAvailable(
  tx: Prisma.TransactionClient,
  roundId: string,
  nextStock?: number,
): Promise<void> {
  const round = await tx.productRound.findUniqueOrThrow({
    where: { id: roundId },
    include: { skuStocks: { select: { stock: true, reserved: true } } },
  });
  if (round.skuStocks.length > 0) {
    const stock = round.skuStocks.reduce((sum, r) => sum + r.stock, 0);
    const reserved = round.skuStocks.reduce((sum, r) => sum + r.reserved, 0);
    await tx.productRound.update({
      where: { id: roundId },
      data: { stock, reserved, available: Math.max(0, stock - reserved) },
    });
    return;
  }
  const stock = nextStock ?? round.stock;
  if (round.reserved > stock) {
    throw conflict(`Нөөцлөгдсөн ${round.reserved} ширхэгээс бага үлдэгдэл тавих боломжгүй.`);
  }
  await tx.productRound.update({
    where: { id: roundId },
    data: { stock, available: Math.max(0, stock - round.reserved) },
  });
}
