import type { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { unpaidAutoDeleteWhere } from '../lib/unpaidCancel.js';
import { lockOrders, lockRounds } from '../lib/orderLock.js';
import {
  commitReadyStock,
  consumeReadyStock,
  releaseReadyStock,
  reserveReadyStock,
  restoreReadyStock,
  selectionsFromItem,
  type ReadyRound,
} from './readyStock.js';

function holdOf(value: string | null | undefined): string {
  return value || 'NONE';
}

type Tx = Prisma.TransactionClient;

type HoldItem = {
  id: string;
  qty: number;
  stockHold: string;
  cancelledAt: Date | null;
  round: ReadyRound | null;
  size: string | null;
  color: string | null;
  selections: unknown;
  nameSnapshot: string;
};

export async function loadReadyHoldItems(tx: Tx, orderId: string): Promise<HoldItem[]> {
  const items = await tx.orderItem.findMany({
    where: { orderId, cancelledAt: null },
    include: {
      round: { include: { skuStocks: true, product: { select: { name: true } } } },
    },
  });
  return items.map((item) => ({
    id: item.id,
    qty: item.qty,
    stockHold: item.stockHold,
    cancelledAt: item.cancelledAt,
    round: item.round.closeAt === null ? item.round : null,
    size: item.size,
    color: item.color,
    selections: item.selections,
    nameSnapshot: item.nameSnapshot,
  }));
}

export async function setItemHold(tx: Tx, itemId: string, stockHold: string, stockShortfall = false) {
  await tx.orderItem.update({
    where: { id: itemId },
    data: { stockHold, stockShortfall },
  });
}

/**
 * Хугацаа дууссан төлөөгүй нөөцийг худалдан авах боломжтой болгоно.
 * Захиалгыг цуцлахгүй — background cron цуцална. Хоцорсон төлбөр RELEASED замаар орно.
 */
export async function releaseExpiredReadyHoldsForRounds(
  tx: Tx,
  roundIds: string[],
  cutoff: Date | null,
  actor = 'system:checkout',
): Promise<number> {
  const ids = [...new Set(roundIds.filter(Boolean))];
  if (!cutoff || ids.length === 0) return 0;
  await lockRounds(tx, ids);
  const items = await tx.orderItem.findMany({
    where: {
      cancelledAt: null,
      stockHold: 'RESERVED',
      roundId: { in: ids },
      round: { closeAt: null },
      order: unpaidAutoDeleteWhere(cutoff),
    },
    include: {
      round: { include: { skuStocks: true, product: { select: { name: true } } } },
    },
  });
  if (items.length === 0) return 0;
  await lockOrders(tx, items.map((item) => item.orderId));
  let released = 0;
  for (const item of items) {
    if (holdOf(item.stockHold) !== 'RESERVED' || !item.round || item.round.closeAt !== null) continue;
    await releaseItemReadyStock(tx, item);
    released += 1;
    await audit(
      {
        actor,
        action: 'EXPIRED_HOLD_RELEASE',
        entity: 'OrderItem',
        entityId: item.id,
        after: { orderId: item.orderId, roundId: item.roundId, qty: item.qty },
      },
      tx,
    );
  }
  return released;
}

/** Захиалга үүсэхэд бэлэн мөрийг нөөцлөнө. */
export async function reserveOrderReadyStock(tx: Tx, orderId: string): Promise<void> {
  const items = await loadReadyHoldItems(tx, orderId);
  for (const item of items) {
    if (!item.round || item.stockHold !== 'NONE') continue;
    await reserveReadyStock(tx, item.round, item.qty, selectionsFromItem(item));
    await setItemHold(tx, item.id, 'RESERVED');
  }
}

/** Төлбөр ормогц нөөцийг нэг удаа зарлагадана. */
export async function commitOrderReadyStock(
  tx: Tx,
  order: { id: string; status: string; deletedAt: Date | null },
  actor: string,
): Promise<void> {
  const items = await tx.orderItem.findMany({
    where: { orderId: order.id },
    include: {
      round: { include: { skuStocks: true, product: { select: { name: true } } } },
    },
  });

  const cancelled = order.status === 'CANCELLED' || order.deletedAt != null;

  for (const item of items) {
    if (!item.round || item.round.closeAt !== null) continue;
    const round = item.round;
    const selections = selectionsFromItem(item);

    if (item.stockHold === 'CONSUMED') continue;

    if (holdOf(item.stockHold) === 'RESERVED' && !item.cancelledAt) {
      await commitReadyStock(tx, round, item.qty, selections);
      await setItemHold(tx, item.id, 'CONSUMED');
      continue;
    }

    if (item.stockHold === 'RELEASED' || item.cancelledAt || cancelled) {
      try {
        await consumeReadyStock(tx, round, item.qty, selections);
        await setItemHold(tx, item.id, 'CONSUMED', false);
        await audit(
          {
            actor,
            action: 'STOCK_CONSUME_LATE',
            entity: 'OrderItem',
            entityId: item.id,
            after: { orderId: order.id, qty: item.qty, late: true },
          },
          tx,
        );
      } catch (error) {
        await setItemHold(tx, item.id, item.stockHold || 'RELEASED', true);
        await tx.moneyException.create({
          data: {
            kind: cancelled ? 'LATE_AFTER_CANCEL' : 'STOCK_SHORTFALL',
            orderId: order.id,
            amount: item.unitPrice * item.qty,
            note: `${item.nameSnapshot}: үлдэгдэл хүрэлцэхгүй. Төлбөр бүртгэгдсэн.`,
            actor,
          },
        });
        if (!(error instanceof AppError) || error.status !== 409) throw error;
        await audit(
          {
            actor,
            action: 'STOCK_SHORTFALL',
            entity: 'OrderItem',
            entityId: item.id,
            after: { orderId: order.id, qty: item.qty },
          },
          tx,
        );
      }
      continue;
    }

    if (item.stockHold === 'NONE' && !item.cancelledAt) {
      await consumeReadyStock(tx, round, item.qty, selections);
      await setItemHold(tx, item.id, 'CONSUMED');
    }
  }
}

/** Цуцлалт: нөөц чөлөөлөх эсвэл борлуулсныг буцаах. */
export async function releaseOrderReadyStock(tx: Tx, orderId: string): Promise<void> {
  const items = await tx.orderItem.findMany({
    where: { orderId, cancelledAt: null, handedOverAt: null },
    include: {
      round: { include: { skuStocks: true, product: { select: { name: true } } } },
    },
  });
  for (const item of items) {
    if (!item.round || item.round.closeAt !== null) continue;
    const selections = selectionsFromItem(item);
    if (holdOf(item.stockHold) === 'RESERVED') {
      await releaseReadyStock(tx, item.round, item.qty, selections);
      await setItemHold(tx, item.id, 'RELEASED');
    } else if (holdOf(item.stockHold) === 'CONSUMED' || holdOf(item.stockHold) === 'NONE') {
      await restoreReadyStock(tx, item.round, item.qty, selections);
      await setItemHold(tx, item.id, 'RELEASED');
    }
  }
}

export async function releaseItemReadyStock(
  tx: Tx,
  item: {
    id: string;
    qty: number;
    stockHold: string;
    round: ReadyRound | null;
    selections: unknown;
    size: string | null;
    color: string | null;
  },
): Promise<void> {
  if (!item.round || item.round.closeAt !== null) return;
  const selections = selectionsFromItem(item);
  if (holdOf(item.stockHold) === 'RESERVED') {
    await releaseReadyStock(tx, item.round, item.qty, selections);
    await setItemHold(tx, item.id, 'RELEASED');
  } else if (holdOf(item.stockHold) === 'CONSUMED' || holdOf(item.stockHold) === 'NONE') {
    await restoreReadyStock(tx, item.round, item.qty, selections);
    await setItemHold(tx, item.id, 'RELEASED');
  }
}

/** Цуцлалтыг буцаахад нөөц/борлуулалтыг дахин авна. */
export async function reholdOrderReadyStock(tx: Tx, orderId: string): Promise<void> {
  const items = await tx.orderItem.findMany({
    where: { orderId, cancelledAt: null, handedOverAt: null },
    include: {
      round: { include: { skuStocks: true, product: { select: { name: true } } } },
    },
  });
  for (const item of items) {
    if (!item.round || item.round.closeAt !== null) continue;
    if (holdOf(item.stockHold) !== 'RELEASED' && holdOf(item.stockHold) !== 'NONE') continue;
    await reserveReadyStock(tx, item.round, item.qty, selectionsFromItem(item));
    await setItemHold(tx, item.id, 'RESERVED');
  }
}
