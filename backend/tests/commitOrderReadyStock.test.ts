import { describe, expect, it, vi } from 'vitest';
import { conflict } from '../src/lib/errors.js';

const consumeReadyStockMock = vi.fn();
const commitReadyStockMock = vi.fn();

vi.mock('../src/lib/audit.js', () => ({ audit: vi.fn(async () => {}) }));
vi.mock('../src/services/readyStock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/readyStock.js')>();
  return {
    ...actual,
    consumeReadyStock: (...args: unknown[]) => consumeReadyStockMock(...args),
    commitReadyStock: (...args: unknown[]) => commitReadyStockMock(...args),
  };
});

import { commitOrderReadyStock } from '../src/services/stockHold.js';

function itemOf(hold: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    orderId: 'o1',
    qty: 1,
    unitPrice: 33_000,
    nameSnapshot: 'Цамц',
    stockHold: hold,
    cancelledAt: null,
    handedOverAt: null,
    stockShortfall: false,
    size: null,
    color: null,
    selections: {},
    round: {
      id: 'r1',
      closeAt: null,
      stock: 0,
      reserved: 0,
      available: 0,
      status: 'SOLD_OUT',
      skuStocks: [],
      product: { name: 'Цамц' },
    },
    ...extra,
  };
}

function txOf(item: ReturnType<typeof itemOf>) {
  const exceptions: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  return {
    exceptions,
    updates,
    tx: {
      orderItem: {
        findMany: vi.fn(async () => [item]),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          Object.assign(item, data);
          return item;
        }),
      },
      moneyException: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          exceptions.push(data);
          return data;
        }),
      },
    },
  };
}

describe('хоцорсон төлбөрийн нөөц', () => {
  it('CONSUMED мөрийг дахин зарлагадахгүй', async () => {
    consumeReadyStockMock.mockReset();
    commitReadyStockMock.mockReset();
    const item = itemOf('CONSUMED');
    const { tx, exceptions } = txOf(item);
    await commitOrderReadyStock(tx as never, { id: 'o1', status: 'NEW', deletedAt: null }, 'qpay');
    expect(consumeReadyStockMock).not.toHaveBeenCalled();
    expect(commitReadyStockMock).not.toHaveBeenCalled();
    expect(exceptions).toHaveLength(0);
    expect(item.stockHold).toBe('CONSUMED');
  });

  it('үлдэгдэлгүй хоцорсон төлбөрт мөнгөний exception үүсгэж, барааг CONSUMED/хүлээлгэн өгсөн болгохгүй', async () => {
    consumeReadyStockMock.mockReset();
    commitReadyStockMock.mockReset();
    consumeReadyStockMock.mockRejectedValue(conflict('Цамц: үлдэгдэл хүрэлцэхгүй.'));
    const item = itemOf('RELEASED', { cancelledAt: new Date('2026-09-18T00:00:00.000Z') });
    const { tx, exceptions, updates } = txOf(item);
    await commitOrderReadyStock(
      tx as never,
      { id: 'o1', status: 'CANCELLED', deletedAt: null },
      'qpay',
    );
    expect(consumeReadyStockMock).toHaveBeenCalledOnce();
    expect(commitReadyStockMock).not.toHaveBeenCalled();
    expect(exceptions).toEqual([
      expect.objectContaining({
        kind: 'LATE_AFTER_CANCEL',
        orderId: 'o1',
        amount: 33_000,
      }),
    ]);
    expect(item.stockHold).toBe('RELEASED');
    expect(item.stockShortfall).toBe(true);
    expect(item.handedOverAt).toBe(null);
    expect(updates.some((row) => row.stockHold === 'CONSUMED')).toBe(false);
  });

  it('цуцлаагүй ч үлдэгдэлгүй бол STOCK_SHORTFALL бүртгэнэ', async () => {
    consumeReadyStockMock.mockReset();
    commitReadyStockMock.mockReset();
    consumeReadyStockMock.mockRejectedValue(conflict('Цамц: үлдэгдэл хүрэлцэхгүй.'));
    const item = itemOf('RELEASED');
    const { tx, exceptions } = txOf(item);
    await commitOrderReadyStock(tx as never, { id: 'o1', status: 'NEW', deletedAt: null }, 'qpay');
    expect(exceptions).toEqual([
      expect.objectContaining({ kind: 'STOCK_SHORTFALL', orderId: 'o1', amount: 33_000 }),
    ]);
    expect(item.stockHold).toBe('RELEASED');
    expect(item.stockShortfall).toBe(true);
    expect(item.handedOverAt).toBe(null);
  });
});
