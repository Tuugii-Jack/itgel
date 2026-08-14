import type { Prisma } from '@prisma/client';
import { recalcOrderTotals } from './money.js';

type Tx = Prisma.TransactionClient;

const FROZEN = ['HANDED_OVER', 'CANCELLED'] as const;

/**
 * Захиалгын карго = идэвхтэй мөрүүдийн (qty × тойргийн нэгж карго).
 * Хүлээлгэн өгсөн / цуцлагдсан захиалгын дүнг хөлдөөнө.
 */
export async function syncOrderCargoFee(tx: Tx, orderId: string): Promise<number> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, cargoFee: true },
  });
  if (!order) return 0;
  if (FROZEN.includes(order.status as (typeof FROZEN)[number])) return order.cargoFee;

  const items = await tx.orderItem.findMany({
    where: { orderId, cancelledAt: null },
    select: { qty: true, round: { select: { cargoFee: true } } },
  });
  const cargoFee = items.reduce((sum, item) => sum + item.qty * item.round.cargoFee, 0);
  if (cargoFee === order.cargoFee) {
    await recalcOrderTotals(tx, orderId);
    return cargoFee;
  }

  await tx.order.update({ where: { id: orderId }, data: { cargoFee } });
  await recalcOrderTotals(tx, orderId);
  return cargoFee;
}

/** Тойргийн карго солигдсон үед холбоотой захиалгуудыг шинэчилнэ. */
export async function syncCargoFeesForRounds(tx: Tx, roundIds: string[]): Promise<number> {
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
