import { describe, expect, it, vi } from 'vitest';
import {
  commitReadyStock,
  consumeReadyStock,
  releaseReadyStock,
  reserveReadyStock,
} from '../src/services/readyStock.js';

function txMock(sku: { id: string; skuKey: string; stock: number; reserved: number; available: number }) {
  return {
    roundSkuStock: {
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const availNeed = (where.available as { gte?: number } | undefined)?.gte;
        const reservedNeed = (where.reserved as { gte?: number } | undefined)?.gte;
        const stockNeed = (where.stock as { gte?: number } | undefined)?.gte;
        if (where.id !== sku.id) return { count: 0 };
        if (availNeed != null && sku.available < availNeed) return { count: 0 };
        if (reservedNeed != null && sku.reserved < reservedNeed) return { count: 0 };
        if (stockNeed != null && sku.stock < stockNeed) return { count: 0 };
        const reservedInc = (data.reserved as { increment?: number; decrement?: number } | undefined);
        const availInc = (data.available as { increment?: number; decrement?: number } | undefined);
        const stockInc = (data.stock as { increment?: number; decrement?: number } | undefined);
        if (reservedInc?.increment) sku.reserved += reservedInc.increment;
        if (reservedInc?.decrement) sku.reserved -= reservedInc.decrement;
        if (availInc?.increment) sku.available += availInc.increment;
        if (availInc?.decrement) sku.available -= availInc.decrement;
        if (stockInc?.increment) sku.stock += stockInc.increment;
        if (stockInc?.decrement) sku.stock -= stockInc.decrement;
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const reservedInc = data.reserved as { increment?: number; decrement?: number } | undefined;
        const availInc = data.available as { increment?: number; decrement?: number } | undefined;
        if (reservedInc?.decrement) sku.reserved -= reservedInc.decrement;
        if (availInc?.increment) sku.available += availInc.increment;
        return {};
      }),
    },
    productRound: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => ({})),
      findUniqueOrThrow: vi.fn(async () => ({
        id: 'r1',
        skuStocks: [sku],
        available: sku.available,
        status: 'ACTIVE',
        closeAt: null,
      })),
    },
  };
}

const roundOf = (sku: { id: string; skuKey: string; stock: number; reserved: number; available: number }) => ({
  id: 'r1',
  closeAt: null,
  status: 'ACTIVE' as const,
  stock: sku.stock,
  reserved: sku.reserved,
  available: sku.available,
  product: { name: 'Цамц' },
  skuStocks: [sku],
});

describe('бэлэн барааны нөөц', () => {
  it('сагс биш, нөөцлөлт available-ийг бууруулна, stock хэвээр', async () => {
    const sku = { id: 'sku-1', skuKey: 'Өнгө=Хар', stock: 2, reserved: 0, available: 2 };
    const tx = txMock(sku);
    await reserveReadyStock(tx as never, roundOf(sku), 1, { Өнгө: 'Хар' });
    expect(sku.stock).toBe(2);
    expect(sku.reserved).toBe(1);
    expect(sku.available).toBe(1);
  });

  it('төлбөр батлахад нөөцөөс зарлагадана, available дахин буурахгүй', async () => {
    const sku = { id: 'sku-1', skuKey: 'Өнгө=Хар', stock: 2, reserved: 1, available: 1 };
    const tx = txMock(sku);
    await commitReadyStock(tx as never, roundOf(sku), 1, { Өнгө: 'Хар' });
    expect(sku.stock).toBe(1);
    expect(sku.reserved).toBe(0);
    expect(sku.available).toBe(1);
  });

  it('цуцлалт нөөцийг чөлөөлнө', async () => {
    const sku = { id: 'sku-1', skuKey: 'Өнгө=Хар', stock: 2, reserved: 1, available: 1 };
    const tx = txMock(sku);
    await releaseReadyStock(tx as never, roundOf(sku), 1, { Өнгө: 'Хар' });
    expect(sku.stock).toBe(2);
    expect(sku.reserved).toBe(0);
    expect(sku.available).toBe(2);
  });

  it('сүүлийн нэгжийг хоёр дахь нөөцлөлтөөр таслана', async () => {
    const sku = { id: 'sku-1', skuKey: 'Өнгө=Хар', stock: 1, reserved: 0, available: 1 };
    const tx = txMock(sku);
    await reserveReadyStock(tx as never, roundOf(sku), 1, { Өнгө: 'Хар' });
    await expect(reserveReadyStock(tx as never, roundOf(sku), 1, { Өнгө: 'Хар' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('хоцорсон төлбөр шууд consume хийнэ', async () => {
    const sku = { id: 'sku-1', skuKey: 'Өнгө=Хар', stock: 1, reserved: 0, available: 1 };
    const tx = txMock(sku);
    await consumeReadyStock(tx as never, roundOf(sku), 1, { Өнгө: 'Хар' });
    expect(sku.stock).toBe(0);
    expect(sku.available).toBe(0);
  });
});
