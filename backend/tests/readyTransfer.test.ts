import { describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import {
  claimTransferQty,
  previewDebtClose,
  transferAvailability,
} from '../src/services/readyTransfer.js';

describe('Бэлэн бараанд шилжүүлэх боломж', () => {
  it('хүлээлгэн өгсөн барааг буцаалтгүйгээр шилжүүлэхгүй', () => {
    expect(
      transferAvailability({
        cancelledAt: null,
        handedOverAt: new Date(),
        transferredAt: null,
        qty: 1,
      }),
    ).toMatchObject({ ok: false, availableQty: 0 });
  });

  it('аль хэдийн шилжсэн эсвэл цуцлагдсаныг дахин шилжүүлэхгүй', () => {
    expect(
      transferAvailability({
        cancelledAt: new Date(),
        handedOverAt: null,
        transferredAt: null,
        qty: 2,
      }).ok,
    ).toBe(false);
    expect(
      transferAvailability({
        cancelledAt: null,
        handedOverAt: null,
        transferredAt: new Date(),
        qty: 2,
      }).ok,
    ).toBe(false);
  });

  it('хэсэгчилсэн үлдсэн бараа байвал өрийг бүхэлд нь хаахгүй', () => {
    expect(previewDebtClose({ remainingActiveQty: 1, dueAfterTransfer: 80_000 })).toEqual({
      closeDebt: false,
      writeOffAmount: 0,
    });
    expect(previewDebtClose({ remainingActiveQty: 0, dueAfterTransfer: 80_000 })).toEqual({
      closeDebt: true,
      writeOffAmount: 80_000,
    });
  });
});

describe('Давхар шилжүүлэлт', () => {
  it('updateMany хамгаалалт хоёр дахь оролдлогыг таслана', async () => {
    const stored = {
      id: 'item-1',
      cancelledAt: null as Date | null,
      handedOverAt: null as Date | null,
      transferredAt: null as Date | null,
      qty: 2,
    };
    const tx = {
      orderItem: {
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          if (where.id !== stored.id) return { count: 0 };
          if (where.cancelledAt !== stored.cancelledAt) return { count: 0 };
          if (where.handedOverAt !== stored.handedOverAt) return { count: 0 };
          if (where.transferredAt !== stored.transferredAt) return { count: 0 };
          if (where.qty !== stored.qty) return { count: 0 };
          Object.assign(stored, data);
          return { count: 1 };
        },
        create: async () => ({ id: 'sibling' }),
      },
    };
    const item = {
      id: 'item-1',
      orderId: 'o1',
      roundId: 'r1',
      productId: 'p1',
      nameSnapshot: 'Цамц',
      selections: {},
      size: null,
      color: null,
      qty: 2,
      unitPrice: 100_000,
      costPriceSnapshot: 0,
      arriveFrom: null,
      arriveTo: null,
      arrivedAt: null,
      arrivedQty: 0,
      fulfilment: 'PICKUP' as const,
      cancelledAt: null,
      handedOverAt: null,
      transferredAt: null,
    };
    const now = new Date();
    await claimTransferQty(tx as never, item, 2, now, 't1', 'Төлөхгүй');
    expect(stored.transferredAt).toBeInstanceOf(Date);
    await expect(claimTransferQty(tx as never, item, 2, now, 't2', 'Дахин')).rejects.toBeInstanceOf(AppError);
  });
});
