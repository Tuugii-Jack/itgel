import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { diffUbDays } from '../lib/date.js';
import { getSettings } from './settings.js';
import { recalcOrderTotals } from './money.js';

type Tx = Prisma.TransactionClient;

export type StorageItemInput = {
  arrivedAt: Date | null;
  handedOverAt: Date | null;
  cancelledAt: Date | null;
  qty: number;
};

export type StorageFeeBreakdown = {
  /** Бодох ёстой нийт хураамж ₮. */
  fee: number;
  /** Төлбөртэй мөрийн-хоног (qty-тай). */
  billableItemDays: number;
  /**
   * Идэвхтэй (аваагүй) ирсэн барааны үнэгүй үлдсэн хоногийн хамгийн бага.
   * Бараа байхгүй эсвэл унтраалттай бол null.
   */
  freeDaysLeft: number | null;
  /** Үнэгүй хадгалалтын хоног (тохиргоо). */
  freeDays: number;
  /** Хоног бүрийн хураамж ₮. */
  feePerDay: number;
};

/**
 * Ирснээс хойш `freeDays` үнэгүй; дараагийн хоног бүр `feePerDay × qty`.
 * Хэсэгчилэн авсан мөр (`handedOverAt`) тооцогдохгүй.
 */
export function computeStorageFee(
  items: StorageItemInput[],
  feePerDay: number,
  freeDays: number,
  now = new Date(),
): StorageFeeBreakdown {
  if (feePerDay <= 0) {
    return { fee: 0, billableItemDays: 0, freeDaysLeft: null, freeDays, feePerDay };
  }

  let fee = 0;
  let billableItemDays = 0;
  let freeDaysLeft: number | null = null;

  for (const item of items) {
    if (!item.arrivedAt || item.handedOverAt || item.cancelledAt) continue;
    const storedDays = Math.max(0, diffUbDays(now, item.arrivedAt));
    const freeLeft = Math.max(0, freeDays - storedDays);
    const billable = Math.max(0, storedDays - freeDays);
    if (freeDaysLeft === null || freeLeft < freeDaysLeft) freeDaysLeft = freeLeft;
    billableItemDays += billable * item.qty;
    fee += billable * feePerDay * item.qty;
  }

  return { fee, billableItemDays, freeDaysLeft, freeDays, feePerDay };
}

/** Захиалгын `storageFee`-г дахин бодож, өөрчлөгдсөн бол dueAmount шинэчилнэ. */
export async function syncOrderStorageFee(
  orderId: string,
  now = new Date(),
  client: Tx | typeof prisma = prisma,
): Promise<StorageFeeBreakdown> {
  const settings = await getSettings();
  const order = await client.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      storageFee: true,
      status: true,
      items: {
        select: { arrivedAt: true, handedOverAt: true, cancelledAt: true, qty: true },
      },
    },
  });
  if (!order) {
    return {
      fee: 0,
      billableItemDays: 0,
      freeDaysLeft: null,
      freeDays: settings.storageFreeDays,
      feePerDay: settings.storageFeePerDay,
    };
  }

  // Бүрэн авсан/цуцлагдсан захиалга дээр шинэ хураамж нэмэхгүй.
  // Хэсэгчилэн авсан ч өмнө бодогдсон хураамжийг бууруулахгүй (max).
  const breakdown = computeStorageFee(
    order.items,
    settings.storageFeePerDay,
    settings.storageFreeDays,
    now,
  );

  const targetFee =
    order.status === 'HANDED_OVER' || order.status === 'CANCELLED'
      ? order.storageFee
      : Math.max(order.storageFee, breakdown.fee);

  if (targetFee !== order.storageFee) {
    await client.order.update({
      where: { id: orderId },
      data: { storageFee: targetFee },
    });
    await recalcOrderTotals(client, orderId);
  }

  return { ...breakdown, fee: targetFee };
}

/** Идэвхтэй ARRIVED захиалгуудын хадгалалтын хураамжийг масс-шинэчилнэ. */
export async function syncAllStorageFees(now = new Date()): Promise<number> {
  const settings = await getSettings();
  if (settings.storageFeePerDay <= 0) return 0;

  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      status: { in: ['ARRIVED', 'IN_TRANSIT', 'IN_BATCH', 'CONFIRMED'] },
      items: { some: { arrivedAt: { not: null }, handedOverAt: null, cancelledAt: null } },
    },
    select: { id: true },
    take: 500,
  });

  let updated = 0;
  for (const order of orders) {
    const before = await prisma.order.findUnique({
      where: { id: order.id },
      select: { storageFee: true },
    });
    const after = await syncOrderStorageFee(order.id, now);
    if (before && before.storageFee !== after.fee) updated += 1;
  }
  return updated;
}
