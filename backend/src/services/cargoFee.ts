import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { itemSelections } from '../lib/options.js';
import { skuKeyOf } from '../lib/skuStock.js';
import { recalcOrderTotals } from './money.js';

type Db = Prisma.TransactionClient | typeof prisma;

const FROZEN = ['HANDED_OVER', 'CANCELLED'] as const;

export type CargoFeeRow = { skuKey: string; cargoFee: number };

export type CargoRound = {
  cargoFee: number;
  cargoFees?: CargoFeeRow[] | null;
} | null | undefined;

/** Сонголтын нэгж карго — яг таарсан мөр байхгүй бол тойргийн үндсэн үнэ. */
export function unitCargoFee(
  round: CargoRound,
  selections: Record<string, string>,
): number {
  const base = round?.cargoFee ?? 0;
  const key = skuKeyOf(selections);
  if (!key || !round?.cargoFees?.length) return base;
  return round.cargoFees.find((row) => row.skuKey === key)?.cargoFee ?? base;
}

export function lineCargoFee(
  qty: number,
  round: CargoRound,
  selections: Record<string, string>,
): number {
  return Math.max(0, qty) * unitCargoFee(round, selections);
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
      round: {
        select: {
          cargoFee: true,
          cargoFees: { select: { skuKey: true, cargoFee: true } },
        },
      },
    },
  });
  const cargoFee = items.reduce(
    (sum, item) =>
      sum + lineCargoFee(item.qty, item.round, itemSelections(item)),
    0,
  );
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
