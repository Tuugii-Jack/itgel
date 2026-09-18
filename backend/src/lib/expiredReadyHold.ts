import type { Prisma } from '@prisma/client';
import { unpaidAutoDeleteWhere } from './unpaidCancel.js';
import { skuKeyOf } from './skuStock.js';
import { selectionsOf } from './options.js';

export type ExpiredReservedRow = {
  roundId: string;
  skuKey: string;
  qty: number;
};

export type ExpiredReservedIndex = {
  byRound: Map<string, number>;
  bySku: Map<string, number>;
};

export function unpaidHoldCutoff(hours: number, now = new Date()): Date | null {
  if (hours <= 0) return null;
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

export function skuKeyFromHoldItem(item: {
  selections: unknown;
  size?: string | null;
  color?: string | null;
}): string {
  const fromJson = selectionsOf(item.selections);
  if (Object.keys(fromJson).length > 0) return skuKeyOf(fromJson);
  const out: Record<string, string> = {};
  if (item.size) out['Хэмжээ'] = item.size;
  if (item.color) out['Өнгө'] = item.color;
  return skuKeyOf(out);
}

export function indexExpiredReserved(rows: ExpiredReservedRow[]): ExpiredReservedIndex {
  const byRound = new Map<string, number>();
  const bySku = new Map<string, number>();
  for (const row of rows) {
    byRound.set(row.roundId, (byRound.get(row.roundId) ?? 0) + row.qty);
    if (row.skuKey) {
      const key = `${row.roundId}\0${row.skuKey}`;
      bySku.set(key, (bySku.get(key) ?? 0) + row.qty);
    }
  }
  return { byRound, bySku };
}

export function sellableAvailable(storedAvailable: number, expiredReserved: number): number {
  return Math.max(0, storedAvailable) + Math.max(0, expiredReserved);
}

export function skuExpiredKey(roundId: string, skuKey: string): string {
  return `${roundId}\0${skuKey}`;
}

export async function loadExpiredReservedHolds(
  client: Pick<Prisma.TransactionClient, 'orderItem'>,
  cutoff: Date,
  roundIds?: string[],
): Promise<ExpiredReservedRow[]> {
  const items = await client.orderItem.findMany({
    where: {
      cancelledAt: null,
      stockHold: 'RESERVED',
      ...(roundIds && roundIds.length > 0 ? { roundId: { in: roundIds } } : {}),
      round: { closeAt: null },
      order: unpaidAutoDeleteWhere(cutoff),
    },
    select: {
      id: true,
      qty: true,
      roundId: true,
      selections: true,
      size: true,
      color: true,
      orderId: true,
      stockHold: true,
    },
  });
  return items.map((item) => ({
    roundId: item.roundId,
    skuKey: skuKeyFromHoldItem(item),
    qty: item.qty,
  }));
}

export function overlaySellableOnRound<
  T extends {
    id: string;
    closeAt: Date | null;
    available?: number | null;
    reserved?: number | null;
    status: string;
    skuStocks?: { skuKey?: string; selections?: unknown; stock: number; reserved?: number; available?: number }[];
  },
>(round: T, index: ExpiredReservedIndex): T {
  if (round.closeAt !== null) return round;
  const extra = index.byRound.get(round.id) ?? 0;
  if (extra <= 0 && !round.skuStocks?.length) return round;
  const available = sellableAvailable(round.available ?? 0, extra);
  const skuStocks = round.skuStocks?.map((sku) => {
    const skuKey = sku.skuKey || skuKeyOf(selectionsOf(sku.selections));
    const skuExtra = index.bySku.get(skuExpiredKey(round.id, skuKey)) ?? 0;
    return {
      ...sku,
      available: sellableAvailable(sku.available ?? Math.max(0, sku.stock - (sku.reserved ?? 0)), skuExtra),
    };
  });
  const status =
    round.status === 'SOLD_OUT' && available > 0 ? ('ACTIVE' as T['status']) : round.status;
  return { ...round, available, skuStocks, status };
}
