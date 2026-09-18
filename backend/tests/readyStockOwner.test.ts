import { describe, expect, it, vi } from 'vitest';
import { consumeReadyStock, restoreReadyStock } from '../src/services/readyStock.js';

describe('Бэлэн үлдэгдэл эзэмшигчид буцна', () => {
  it('цуцлалт тухайн тойргийн id дээр нэмнэ', async () => {
    const tx = {
      roundSkuStock: { update: vi.fn(async () => ({})) },
      productRound: {
        update: vi.fn(async () => ({})),
        findUniqueOrThrow: vi.fn(async () => ({
          id: 'leasing-round',
          skuStocks: [{ id: 'sku-1', available: 1 }],
          available: 1,
          status: 'ACTIVE',
          closeAt: null,
        })),
      },
    };
    await restoreReadyStock(
      tx as never,
      {
        id: 'leasing-round',
        closeAt: null,
        status: 'ACTIVE',
        skuStocks: [{ id: 'sku-1', skuKey: 'Өнгө=Хар', stock: 0 }],
        stock: 0,
      },
      1,
      { Өнгө: 'Хар' },
    );
    expect(tx.productRound.update).toHaveBeenCalledWith({
      where: { id: 'leasing-round' },
      data: { stock: { increment: 1 }, available: { increment: 1 } },
    });
    expect(tx.roundSkuStock.update).toHaveBeenCalledWith({
      where: { id: 'sku-1' },
      data: { stock: { increment: 1 }, available: { increment: 1 } },
    });
  });

  it('SKU үлдэгдэл дуусмагц хоёр дахь хасалтыг таслана', async () => {
    const sku = { id: 'sku-1', skuKey: 'Өнгө=Хар', stock: 1, available: 1, reserved: 0 };
    const tx = {
      roundSkuStock: {
        updateMany: vi.fn(async ({ where }: { where: { id: string; available?: { gte: number }; stock?: { gte: number } } }) => {
          const need = where.available?.gte ?? where.stock?.gte ?? 0;
          if (where.id !== sku.id || sku.available < need || sku.stock < need) return { count: 0 };
          sku.stock -= need;
          sku.available -= need;
          return { count: 1 };
        }),
      },
      productRound: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: vi.fn(async () => ({
          id: 'r1',
          skuStocks: [sku],
          available: sku.available,
          status: sku.available > 0 ? 'ACTIVE' : 'SOLD_OUT',
          closeAt: null,
        })),
        update: vi.fn(),
      },
    };
    const round = {
      id: 'r1',
      closeAt: null,
      status: 'ACTIVE' as const,
      stock: 1,
      product: { name: 'Цамц' },
      skuStocks: [sku],
    };
    await consumeReadyStock(tx as never, round, 1, { Өнгө: 'Хар' });
    await expect(consumeReadyStock(tx as never, round, 1, { Өнгө: 'Хар' })).rejects.toMatchObject({
      status: 409,
    });
    expect(sku.stock).toBe(0);
    expect(sku.available).toBe(0);
  });
});
