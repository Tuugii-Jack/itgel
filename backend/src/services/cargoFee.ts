import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { skuKeyOf, optionCombinations } from '../lib/skuStock.js';
import {
  formatSelectionsLabel,
  itemSelections,
  optionsFromVariants,
  selectionsOf,
} from '../lib/options.js';
import { recalcOrderTotals } from './money.js';

type Db = Prisma.TransactionClient | typeof prisma;

const FROZEN = ['HANDED_OVER', 'CANCELLED'] as const;

export type CargoOverride = { skuKey: string; cargoFee: number };

export type RoundCargoSource = {
  cargoFee: number;
  cargoFees?: CargoOverride[] | null;
} | null | undefined;

/** Сонголтын нэгж карго — override байхгүй бол тойргийн үндсэн үнэ. */
export function unitCargoFee(
  round: RoundCargoSource,
  selections: Record<string, string>,
): number {
  const fallback = round?.cargoFee ?? 0;
  const rows = round?.cargoFees;
  if (!rows?.length) return fallback;
  const key = skuKeyOf(selections);
  return rows.find((r) => r.skuKey === key)?.cargoFee ?? fallback;
}

export function itemCargoTotal(
  qty: number,
  round: RoundCargoSource,
  selections: Record<string, string>,
): number {
  return qty * unitCargoFee(round, selections);
}

export function cargoTotalForItems(
  items: {
    qty: number;
    cancelledAt?: Date | null;
    selections?: unknown;
    size?: string | null;
    color?: string | null;
    round?: RoundCargoSource;
  }[],
): number {
  return items.reduce((sum, item) => {
    if (item.cancelledAt) return sum;
    return sum + itemCargoTotal(item.qty, item.round, itemSelections(item));
  }, 0);
}

/**
 * Захиалгын карго = идэвхтэй мөр бүрийн (qty × сонголтын нэгж карго).
 * Ирж авах, хүргэлт — аль ч аргаар карго тооцогдоно.
 */
export async function syncOrderCargoFee(tx: Db, orderId: string): Promise<number> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, cargoFee: true },
  });
  if (!order) return 0;
  if (FROZEN.includes(order.status as (typeof FROZEN)[number])) return order.cargoFee;

  const items = await tx.orderItem.findMany({
    where: { orderId, cancelledAt: null },
    select: {
      qty: true,
      selections: true,
      size: true,
      color: true,
      round: { include: { cargoFees: { select: { skuKey: true, cargoFee: true } } } },
    },
  });
  const cargoFee = cargoTotalForItems(items);
  if (cargoFee === order.cargoFee) {
    await recalcOrderTotals(tx, orderId);
    return cargoFee;
  }

  await tx.order.update({ where: { id: orderId }, data: { cargoFee } });
  await recalcOrderTotals(tx, orderId);
  return cargoFee;
}

/** Олон захиалгын каргог нэг нэгээр шинэчилнэ. */
export async function syncOrdersCargoFees(orderIds: string[]): Promise<void> {
  const unique = [...new Set(orderIds)];
  for (const orderId of unique) {
    await syncOrderCargoFee(prisma, orderId);
  }
}

/** Тойргийн карго солигдсон үед холбоотой захиалгуудыг шинэчилнэ. */
export async function syncCargoFeesForRounds(tx: Db, roundIds: string[]): Promise<number> {
  if (roundIds.length === 0) return 0;
  const items = await tx.orderItem.findMany({
    where: {
      roundId: { in: roundIds },
      cancelledAt: null,
      order: { deletedAt: null, status: { notIn: [...FROZEN] } },
    },
    select: { orderId: true },
  });
  const orderIds = [...new Set(items.map((i) => i.orderId))];
  for (const orderId of orderIds) {
    await syncOrderCargoFee(tx, orderId);
  }
  return orderIds.length;
}

export type CargoVariantInput = {
  selections: Record<string, string>;
  cargoFee: number;
};

/** Тойргийн сонголт бүрийн каргог бүхэлд нь солино. */
export async function replaceRoundCargoFees(
  tx: Db,
  roundId: string,
  rows: CargoVariantInput[],
): Promise<void> {
  await tx.roundCargoFee.deleteMany({ where: { roundId } });
  const clean = rows.filter((r) => Number.isFinite(r.cargoFee));
  if (clean.length === 0) return;
  await tx.roundCargoFee.createMany({
    data: clean.map((r) => {
      const selections = selectionsOf(r.selections);
      return {
        roundId,
        skuKey: skuKeyOf(selections),
        selections,
        cargoFee: Math.max(0, Math.trunc(r.cargoFee)),
      };
    }),
  });
}

export type CargoVariantRow = {
  key: string;
  selections: Record<string, string>;
  label: string;
  orderedQty: number;
  cargoFee: number;
};

const MAX_CARGO_COMBOS = 80;

/**
 * Админд харуулах карго мөрүүд — барааны бүх сонголтын хослол,
 * захиалсан тоо байвал хавсаргана. Хэт олон бол зөвхөн захиалсан хослол.
 */
export function buildCargoVariantRows(input: {
  defaultFee: number;
  overrides: { skuKey: string; cargoFee: number; selections?: unknown }[];
  arrivals: { selections: Record<string, string>; orderedQty: number }[];
  productVariants: { kind: string; value: string; sortOrder: number }[];
}): CargoVariantRow[] {
  const feeByKey = new Map(input.overrides.map((r) => [r.skuKey, r.cargoFee]));
  const qtyByKey = new Map<string, number>();
  for (const a of input.arrivals) {
    const key = skuKeyOf(a.selections);
    qtyByKey.set(key, (qtyByKey.get(key) ?? 0) + a.orderedQty);
  }

  const combos = optionCombinations(optionsFromVariants(input.productVariants));
  const seeds: Record<string, string>[] =
    combos.length > MAX_CARGO_COMBOS
      ? input.arrivals.map((a) => a.selections)
      : combos.length > 0
        ? combos
        : input.arrivals.length > 0
          ? input.arrivals.map((a) => a.selections)
          : [{}];

  const seen = new Set<string>();
  const rows: CargoVariantRow[] = [];
  const push = (selections: Record<string, string>) => {
    const key = skuKeyOf(selections);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      key: key || '_',
      selections,
      label: formatSelectionsLabel(selections),
      orderedQty: qtyByKey.get(key) ?? 0,
      cargoFee: feeByKey.get(key) ?? input.defaultFee,
    });
  };

  for (const sel of seeds) push(sel);
  for (const a of input.arrivals) push(a.selections);
  for (const fee of input.overrides) {
    const selections = selectionsOf(fee.selections);
    if (Object.keys(selections).length > 0 || fee.skuKey === '') push(selections);
  }

  return rows.sort((a, b) => a.label.localeCompare(b.label, 'mn'));
}
