import type { Prisma, Setting } from '@prisma/client';
import { prisma } from '../prisma.js';
import { diffUbDays } from '../lib/date.js';
import { getSettingsCached } from './settings.js';
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

type OrderForStorage = {
  id: string;
  storageFee: number;
  status: string;
  items: StorageItemInput[];
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

function targetStorageFee(
  order: Pick<OrderForStorage, 'storageFee' | 'status'>,
  breakdown: StorageFeeBreakdown,
): number {
  if (order.status === 'HANDED_OVER' || order.status === 'CANCELLED') {
    return order.storageFee;
  }
  return Math.max(order.storageFee, breakdown.fee);
}

/** Аль хэдийн ачаалсан захиалгаас задаргаа — нэмэлт DB query байхгүй. */
export function peekStorageFee(
  order: OrderForStorage,
  settings: Pick<Setting, 'storageFeePerDay' | 'storageFreeDays'>,
  now = new Date(),
): StorageFeeBreakdown {
  const breakdown = computeStorageFee(
    order.items,
    settings.storageFeePerDay,
    settings.storageFreeDays,
    now,
  );
  return { ...breakdown, fee: targetStorageFee(order, breakdown) };
}

/**
 * Олон захиалгыг нэг Setting + нэг findMany-аар sync.
 * Жагсаалт дээр N×sync хийхгүй — зөвхөн handover/cron/нэг захиалга.
 */
export async function syncOrdersStorageFees(
  orderIds: string[],
  now = new Date(),
  client: Tx | typeof prisma = prisma,
): Promise<number> {
  const ids = [...new Set(orderIds.filter(Boolean))];
  if (ids.length === 0) return 0;

  const settings = await getSettingsCached();
  if (settings.storageFeePerDay <= 0) return 0;

  const orders = await client.order.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      storageFee: true,
      status: true,
      items: {
        select: { arrivedAt: true, handedOverAt: true, cancelledAt: true, qty: true },
      },
    },
  });

  let updated = 0;
  for (const order of orders) {
    const breakdown = computeStorageFee(
      order.items,
      settings.storageFeePerDay,
      settings.storageFreeDays,
      now,
    );
    const targetFee = targetStorageFee(order, breakdown);
    if (targetFee === order.storageFee) continue;

    await client.order.update({
      where: { id: order.id },
      data: { storageFee: targetFee },
    });
    await recalcOrderTotals(client, order.id);
    updated += 1;
  }
  return updated;
}

/** Нэг захиалга — batch-ийн нимгэн wrapper. */
export async function syncOrderStorageFee(
  orderId: string,
  now = new Date(),
  client: Tx | typeof prisma = prisma,
): Promise<StorageFeeBreakdown> {
  const settings = await getSettingsCached();
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

  const breakdown = peekStorageFee(order, settings, now);
  if (breakdown.fee !== order.storageFee) {
    await client.order.update({
      where: { id: orderId },
      data: { storageFee: breakdown.fee },
    });
    await recalcOrderTotals(client, orderId);
  }
  return breakdown;
}

/** Cron — нэг query-ээр авч, өөрчлөгдсөнүүдийг л шинэчилнэ. */
export async function syncAllStorageFees(now = new Date()): Promise<number> {
  const settings = await getSettingsCached();
  if (settings.storageFeePerDay <= 0) return 0;

  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      status: { in: ['ARRIVED', 'IN_TRANSIT', 'IN_BATCH', 'CONFIRMED'] },
      items: { some: { arrivedAt: { not: null }, handedOverAt: null, cancelledAt: null } },
    },
    select: {
      id: true,
      storageFee: true,
      status: true,
      items: {
        select: { arrivedAt: true, handedOverAt: true, cancelledAt: true, qty: true },
      },
    },
    take: 500,
  });

  let updated = 0;
  for (const order of orders) {
    const breakdown = computeStorageFee(
      order.items,
      settings.storageFeePerDay,
      settings.storageFreeDays,
      now,
    );
    const targetFee = targetStorageFee(order, breakdown);
    if (targetFee === order.storageFee) continue;
    await prisma.order.update({
      where: { id: order.id },
      data: { storageFee: targetFee },
    });
    await recalcOrderTotals(prisma, order.id);
    updated += 1;
  }
  return updated;
}
