import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  transaction: vi.fn(),
  tx: {
    $queryRaw: vi.fn(),
    order: {
      findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(),
      update: vi.fn(), updateMany: vi.fn(),
    },
    orderItem: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    productRound: { update: vi.fn() },
    payment: { create: vi.fn(), groupBy: vi.fn() },
    auditLog: { findMany: vi.fn() },
  },
}));

vi.mock('../src/prisma.js', () => ({ prisma: { $transaction: db.transaction } }));
vi.mock('../src/lib/audit.js', () => ({ audit: vi.fn() }));
vi.mock('../src/services/cargoFee.js', () => ({ syncOrderCargoFee: vi.fn() }));
vi.mock('../src/services/mail.js', () => ({ sendMail: vi.fn(), mailTemplates: {} }));
vi.mock('../src/services/sms.js', () => ({ sms: vi.fn(), smsTemplates: {} }));

import { cancelOrderItem } from '../src/services/payments.js';
import { changeOrderStatus, handOverItems } from '../src/services/orders.js';

const arrival = new Date('2026-08-01T00:00:00Z');
function line(id: string, handedOver = false) {
  return {
    id, orderId: 'order', qty: 1, unitPrice: 100_000, nameSnapshot: `Item ${id}`,
    cancelledAt: null as Date | null,
    handedOverAt: handedOver ? arrival : null,
    arrivedAt: arrival, arrivedQty: 1,
    selections: {}, size: null, color: null,
    round: { id: `round-${id}`, closeAt: null, status: 'ACTIVE', skuStocks: [] },
  };
}

let items: ReturnType<typeof line>[];
let order: {
  id: string; code: string; status: string; deletedAt: null; subtotal: number;
  deliveryFee: number; storageFee: number; cargoFee: number; leasingFee: number;
  paidAmount: number; refundedAmount: number; isLeasing: boolean; fulfilment: null;
};
let payments: { kind: string; amount: number }[];

beforeEach(() => {
  vi.clearAllMocks();
  items = [line('delivered', true), line('waiting')];
  order = {
    id: 'order', code: 'TEST-1', status: 'ARRIVED', deletedAt: null, subtotal: 200_000,
    deliveryFee: 0, storageFee: 0, cargoFee: 0, leasingFee: 0,
    paidAmount: 200_000, refundedAmount: 0, isLeasing: false, fulfilment: null,
  };
  payments = [{ kind: 'PAYMENT', amount: 200_000 }];
  db.transaction.mockImplementation(async (callback) => {
    const initial = structuredClone({ items, order, payments });
    try {
      return await callback(db.tx);
    } catch (error) {
      ({ items, order, payments } = initial);
      throw error;
    }
  });
  db.tx.$queryRaw.mockResolvedValue([]);
  db.tx.order.findFirst.mockImplementation(async () => ({ ...order }));
  db.tx.order.findUnique.mockImplementation(async () => ({ ...order }));
  db.tx.order.findUniqueOrThrow.mockImplementation(async () => ({ ...order }));
  db.tx.order.update.mockImplementation(async ({ data }) => Object.assign(order, data));
  db.tx.order.updateMany.mockResolvedValue({ count: 1 });

  const matching = (where: Record<string, any>) => items.filter((row) => {
    if (typeof where.id === 'string' && row.id !== where.id) return false;
    if (where.id?.in && !where.id.in.includes(row.id)) return false;
    if ('cancelledAt' in where && row.cancelledAt !== where.cancelledAt) return false;
    if ('handedOverAt' in where) {
      if (where.handedOverAt === null && row.handedOverAt !== null) return false;
      if (where.handedOverAt?.not === null && row.handedOverAt === null) return false;
    }
    if (where.arrivedAt?.not === null && row.arrivedAt === null) return false;
    if (where.order?.status?.notIn?.includes(order.status)) return false;
    return true;
  });
  db.tx.orderItem.findFirst.mockImplementation(async ({ where }) => matching(where)[0] ?? null);
  db.tx.orderItem.findMany.mockImplementation(async ({ where }) => matching(where).map((row) => ({
    ...row, order: { ...order, delivery: null },
  })));
  db.tx.orderItem.count.mockImplementation(async ({ where }) => matching(where).length);
  db.tx.orderItem.updateMany.mockImplementation(async ({ where, data }) => {
    const rows = matching(where);
    rows.forEach((row) => Object.assign(row, data));
    return { count: rows.length };
  });
  db.tx.productRound.update.mockResolvedValue({});
  db.tx.payment.create.mockImplementation(async ({ data }) => {
    payments.push(data);
    return data;
  });
  db.tx.payment.groupBy.mockImplementation(async () => ['PAYMENT', 'REFUND'].map((kind) => ({
    kind,
    _sum: { amount: payments.filter((payment) => payment.kind === kind).reduce((sum, p) => sum + p.amount, 0) },
  })));
});

describe('Cancellation after partial handover', () => {
  it('rejects cancelling a delivered line before writing a refund or restoring stock', async () => {
    await expect(cancelOrderItem({
      orderId: 'order', itemId: 'delivered', actor: 'test', refund: true,
    })).rejects.toMatchObject({ status: 409 });
    expect(db.tx.orderItem.updateMany).not.toHaveBeenCalled();
    expect(db.tx.productRound.update).not.toHaveBeenCalled();
    expect(db.tx.payment.create).not.toHaveBeenCalled();
    expect(order.status).toBe('ARRIVED');
  });

  it('still cancels and refunds the remaining line while keeping delivered goods and their value', async () => {
    const result = await cancelOrderItem({
      orderId: 'order', itemId: 'waiting', actor: 'test', refund: true,
    });
    expect(result).toMatchObject({
      refunded: 100_000, orderCancelled: false,
      totals: { subtotal: 100_000, paidAmount: 200_000, refundedAmount: 100_000, dueAmount: 0 },
    });
    expect(items[0]!.cancelledAt).toBeNull();
    expect(items[0]!.handedOverAt).toEqual(arrival);
    expect(items[1]!.cancelledAt).toBeInstanceOf(Date);
    expect(db.tx.productRound.update).toHaveBeenCalledTimes(1);
    expect(db.tx.productRound.update).toHaveBeenCalledWith({
      where: { id: 'round-waiting' }, data: { stock: { increment: 1 } },
    });
  });

  it('still allows cancellation without an immediate refund', async () => {
    const result = await cancelOrderItem({
      orderId: 'order', itemId: 'waiting', actor: 'test', refund: false,
    });
    expect(result).toMatchObject({ refunded: 0, totals: { subtotal: 100_000, dueAmount: -100_000 } });
    expect(db.tx.payment.create).not.toHaveBeenCalled();
    expect(db.tx.productRound.update).toHaveBeenCalledTimes(1);
  });

  it('rejects cancelling the whole partially delivered order, preserving per-line cancellation', async () => {
    await expect(changeOrderStatus('order', 'CANCELLED', { actor: 'test' }))
      .rejects.toMatchObject({ status: 409 });
    expect(db.tx.order.update).not.toHaveBeenCalled();
    expect(db.tx.productRound.update).not.toHaveBeenCalled();
    expect(order.status).toBe('ARRIVED');
  });

  it('still cancels a whole order before handover and restores each uncancelled ready line once', async () => {
    items = [line('first'), line('second')];
    await changeOrderStatus('order', 'CANCELLED', { actor: 'test' });
    expect(order.status).toBe('CANCELLED');
    expect(db.tx.productRound.update).toHaveBeenCalledTimes(2);
  });

  it('does not restock twice when a line is subsequently cancelled/refunded from a cancelled order', async () => {
    items = [line('waiting')];
    order.status = 'CANCELLED';
    const result = await cancelOrderItem({
      orderId: 'order', itemId: 'waiting', actor: 'test', refund: true,
    });
    expect(result.refunded).toBe(100_000);
    expect(db.tx.productRound.update).not.toHaveBeenCalled();
  });

  it('still cancels the order when its final unfulfilled line is cancelled', async () => {
    items = [line('waiting')];
    const result = await cancelOrderItem({
      orderId: 'order', itemId: 'waiting', actor: 'test', refund: false,
    });
    expect(result.orderCancelled).toBe(true);
    expect(order.status).toBe('CANCELLED');
  });

  it('does not refund or restock if another request changed the line after it was read', async () => {
    db.tx.orderItem.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(cancelOrderItem({
      orderId: 'order', itemId: 'waiting', actor: 'test', refund: true,
    })).rejects.toMatchObject({ status: 409 });
    expect(db.tx.productRound.update).not.toHaveBeenCalled();
    expect(db.tx.payment.create).not.toHaveBeenCalled();
  });

  it('does not hand over a line whose guarded write detects a concurrent cancellation', async () => {
    db.tx.orderItem.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(handOverItems({ itemIds: ['waiting'], actor: 'test' }))
      .rejects.toMatchObject({ status: 409 });
    expect(items[1]!.handedOverAt).toBeNull();
    expect(db.tx.order.update).not.toHaveBeenCalled();
  });

  it('still completes a normal handover of the last remaining line', async () => {
    const result = await handOverItems({ itemIds: ['waiting'], actor: 'test' });
    expect(result).toMatchObject({ itemCount: 1, completedOrderIds: ['order'] });
    expect(order.status).toBe('HANDED_OVER');
    expect(items[1]!.handedOverAt).toBeInstanceOf(Date);
  });
});
