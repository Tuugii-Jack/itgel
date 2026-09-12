import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    batch: { findFirst: vi.fn() },
    order: { findMany: vi.fn(), update: vi.fn() },
    orderItem: { findMany: vi.fn(), update: vi.fn() },
  };
  return { tx, transaction: vi.fn(), notify: vi.fn(), promote: vi.fn() };
});

vi.mock('../src/prisma.js', () => ({ prisma: { $transaction: db.transaction } }));
vi.mock('../src/lib/audit.js', () => ({ audit: vi.fn() }));
vi.mock('../src/services/orders.js', () => ({
  notifyArrival: db.notify,
  promoteOrdersToArrived: db.promote,
}));

import { registerBatchArrivals, summarizeRoundArrivals } from '../src/services/batchArrival.js';
import type { Prisma } from '@prisma/client';

const arrivedAt = new Date('2026-08-10T00:00:00Z');

function item(id: string, arrivedQty: number, handedOver = false, qty = 1) {
  return {
    id,
    orderId: `order-${id}`,
    roundId: 'round',
    qty,
    arrivedQty,
    arrivedAt: arrivedQty >= qty ? arrivedAt : null,
    handedOverAt: handedOver ? arrivedAt : null,
    cancelledAt: null,
    selections: {},
    size: null,
    color: null,
    order: {
      id: `order-${id}`,
      customerId: `customer-${id}`,
      createdAt: new Date(`2026-08-0${id}T00:00:00Z`),
      status: handedOver ? 'HANDED_OVER' : 'ARRIVED',
      deletedAt: null,
      batchOmittedAt: null,
      subtotal: 100_000,
      paidAmount: 100_000,
      refundedAmount: 0,
      leasingFee: 0,
    },
  };
}

type Item = ReturnType<typeof item>;
let items: Item[];

beforeEach(() => {
  vi.clearAllMocks();
  items = [item('1', 1), item('2', 0), item('3', 0)];
  db.transaction.mockImplementation((callback) => callback(db.tx));
  db.tx.$queryRaw.mockResolvedValue([]);
  db.tx.batch.findFirst.mockResolvedValue({
    id: 'batch', name: 'Test batch', stage: 'IN_TRANSIT', rounds: [{ id: 'round' }],
  });
  db.tx.order.findMany.mockImplementation(async ({ where }) => (
    where.items ? items.map((row) => ({ id: row.orderId })) : []
  ));
  db.tx.orderItem.findMany.mockImplementation(async ({ where }) => items.filter((row) => {
    if (where.orderId && row.orderId !== where.orderId) return false;
    if (where.roundId && !where.roundId.in.includes(row.roundId)) return false;
    if (row.cancelledAt) return false;
    const status = where.order?.status;
    if (status?.notIn?.includes(row.order.status) || status?.not === row.order.status) return false;
    if (where.order && (row.order.deletedAt || row.order.batchOmittedAt)) return false;
    return true;
  }).map((row) => ({ ...row, order: { ...row.order } })));
  db.tx.orderItem.update.mockImplementation(async ({ where, data }) => {
    const row = items.find((candidate) => candidate.id === where.id)!;
    Object.assign(row, data);
    return row;
  });
  db.promote.mockResolvedValue([]);
});

describe('Cumulative batch arrival service', () => {
  it('keeps completed handovers in the summary shown on an already-open arrival page', async () => {
    const tx = db.tx as unknown as Prisma.TransactionClient;
    const before = (await summarizeRoundArrivals(tx, ['round'])).get('round')![0]!;
    items[0]!.handedOverAt = arrivedAt;
    items[0]!.order.status = 'HANDED_OVER';
    const after = (await summarizeRoundArrivals(tx, ['round'])).get('round')![0]!;

    expect(before).toMatchObject({ orderedQty: 3, arrivedQty: 1, remainingQty: 2 });
    expect(after).toMatchObject({
      orderedQty: 3, arrivedQty: 1, remainingQty: 2, handedOverQty: 1, waitingCustomers: 2,
    });
  });

  it('allocates only one new item when a handover happens before the cumulative total changes from 1 to 2', async () => {
    items[0]!.handedOverAt = arrivedAt;
    items[0]!.order.status = 'HANDED_OVER';
    const result = await registerBatchArrivals('batch', [
      { roundId: 'round', selections: {}, arrivedQty: 2 },
    ], 'test');

    expect(result).toMatchObject({ allocated: 1, released: 0, unused: 0 });
    expect(items.map((row) => row.arrivedQty)).toEqual([1, 1, 0]);
    expect(db.tx.orderItem.update).toHaveBeenCalledTimes(1);
    expect(db.tx.orderItem.update.mock.calls[0]![0].where.id).toBe('2');
    expect(db.notify).not.toHaveBeenCalled();
  });

  it('does not allocate again when the same cumulative total is saved twice', async () => {
    items[0]!.handedOverAt = arrivedAt;
    items[0]!.order.status = 'HANDED_OVER';
    const line = { roundId: 'round', selections: {}, arrivedQty: 2 };
    await registerBatchArrivals('batch', [line], 'test');
    const repeated = await registerBatchArrivals('batch', [line], 'test');
    expect(repeated.allocated).toBe(0);
    expect(items.map((row) => row.arrivedQty)).toEqual([1, 1, 0]);
  });

  it('rejects a cumulative quantity below the quantity already handed over', async () => {
    items = [item('1', 1, true), item('2', 1)];
    await expect(registerBatchArrivals('batch', [
      { roundId: 'round', selections: {}, arrivedQty: 0 },
    ], 'test')).rejects.toMatchObject({ status: 409 });
    expect(db.tx.orderItem.update).not.toHaveBeenCalled();
  });

  it('still corrects waiting allocations without changing handed-over goods', async () => {
    items = [item('1', 1, true), item('2', 1)];
    const result = await registerBatchArrivals('batch', [
      { roundId: 'round', selections: {}, arrivedQty: 1 },
    ], 'test');
    expect(result).toMatchObject({ allocated: 0, released: 1 });
    expect(items.map((row) => row.arrivedQty)).toEqual([1, 0]);
    expect(items[0]!.handedOverAt).toEqual(arrivedAt);
  });

  it('never allocates to a handed-over line even if old arrival or payment fields are inconsistent', async () => {
    items = [item('1', 0, true), item('2', 0)];
    items[0]!.order.refundedAmount = 100_000;
    const summary = (await summarizeRoundArrivals(
      db.tx as unknown as Prisma.TransactionClient, ['round'],
    )).get('round')![0]!;
    expect(summary).toMatchObject({ arrivedQty: 1, handedOverQty: 1, waitingCustomers: 1 });
    const result = await registerBatchArrivals('batch', [
      { roundId: 'round', selections: {}, arrivedQty: 2 },
    ], 'test');
    expect(result.allocated).toBe(1);
    expect(db.tx.orderItem.update).toHaveBeenCalledTimes(1);
    expect(db.tx.orderItem.update.mock.calls[0]![0].where.id).toBe('2');
  });
});
