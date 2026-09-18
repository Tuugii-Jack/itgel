import { describe, expect, it } from 'vitest';
import {
  indexExpiredReserved,
  loadExpiredReservedHolds,
  overlaySellableOnRound,
  sellableAvailable,
  skuExpiredKey,
  unpaidHoldCutoff,
} from '../src/lib/expiredReadyHold.js';
import { unpaidAutoDeleteWhere } from '../src/lib/unpaidCancel.js';

describe('хугацаа дууссан бэлэн нөөц', () => {
  it('background цуцлалтаас sellable-ийг ялгана', () => {
    expect(sellableAvailable(0, 2)).toBe(2);
    expect(sellableAvailable(1, 1)).toBe(2);
    expect(unpaidHoldCutoff(0)).toBe(null);
    expect(unpaidHoldCutoff(12, new Date('2026-09-18T12:00:00.000Z'))?.toISOString()).toBe(
      '2026-09-18T00:00:00.000Z',
    );
  });

  it('каталогт дууссан reservation-ийг худалдан авах боломжтой гэж харуулна', () => {
    const index = indexExpiredReserved([
      { roundId: 'r1', skuKey: 'Өнгө=Хар', qty: 1 },
    ]);
    const overlaid = overlaySellableOnRound(
      {
        id: 'r1',
        closeAt: null,
        available: 0,
        reserved: 1,
        status: 'SOLD_OUT',
        skuStocks: [{ skuKey: 'Өнгө=Хар', stock: 1, reserved: 1, available: 0 }],
      },
      index,
    );
    expect(overlaid.available).toBe(1);
    expect(overlaid.status).toBe('ACTIVE');
    expect(overlaid.skuStocks?.[0]?.available).toBe(1);
    expect(index.bySku.get(skuExpiredKey('r1', 'Өнгө=Хар'))).toBe(1);
  });

  it('дуусаагүй reservation-ийг нэмэхгүй', () => {
    const overlaid = overlaySellableOnRound(
      {
        id: 'r1',
        closeAt: null,
        available: 0,
        reserved: 1,
        status: 'SOLD_OUT',
      },
      indexExpiredReserved([]),
    );
    expect(overlaid.available).toBe(0);
    expect(overlaid.status).toBe('SOLD_OUT');
  });

  it('ижил SKU-ийн хоёр дууссан нөөцийг нэг түвшинд нэг удаа нэмнэ, өөр SKU-д нөлөөлөхгүй', () => {
    const index = indexExpiredReserved([
      { roundId: 'r1', skuKey: 'Өнгө=Хар', qty: 1 },
      { roundId: 'r1', skuKey: 'Өнгө=Хар', qty: 1 },
    ]);
    expect(index.byRound.get('r1')).toBe(2);
    expect(index.bySku.get(skuExpiredKey('r1', 'Өнгө=Хар'))).toBe(2);
    const overlaid = overlaySellableOnRound(
      {
        id: 'r1',
        closeAt: null,
        available: 0,
        reserved: 2,
        status: 'SOLD_OUT',
        skuStocks: [
          { skuKey: 'Өнгө=Хар', stock: 2, reserved: 2, available: 0 },
          { skuKey: 'Өнгө=Цагаан', stock: 1, reserved: 0, available: 1 },
        ],
      },
      index,
    );
    expect(overlaid.available).toBe(2);
    expect(overlaid.skuStocks?.[0]?.available).toBe(2);
    expect(overlaid.skuStocks?.[1]?.available).toBe(1);
  });

  it('зөвхөн unpaidAutoDeleteWhere захиалгын RESERVED-ийг уншина', async () => {
    const cutoff = new Date('2026-09-18T00:00:00.000Z');
    let captured: { stockHold?: string; order?: unknown } | undefined;
    await loadExpiredReservedHolds(
      {
        orderItem: {
          findMany: async ({ where }: { where: { stockHold?: string; order?: unknown } }) => {
            captured = where;
            return [];
          },
        },
      } as never,
      cutoff,
      ['r1'],
    );
    expect(captured?.stockHold).toBe('RESERVED');
    expect(captured?.order).toEqual(unpaidAutoDeleteWhere(cutoff));
  });
});
