import { describe, expect, it, vi } from 'vitest';
import { releaseExpiredReadyHoldsForRounds } from '../src/services/stockHold.js';
import { unpaidAutoDeleteWhere } from '../src/lib/unpaidCancel.js';

describe('checkout дээр дууссан нөөц', () => {
  it('цуцлалтын хугацаа унтарсан эсвэл тойроггүй бол юу ч өөрчлөхгүй', async () => {
    const tx = { $queryRaw: vi.fn(), orderItem: { findMany: vi.fn() } };
    expect(await releaseExpiredReadyHoldsForRounds(tx as never, ['r1'], null)).toBe(0);
    expect(await releaseExpiredReadyHoldsForRounds(tx as never, [], new Date())).toBe(0);
    expect(tx.orderItem.findMany).not.toHaveBeenCalled();
  });

  it('хэсэгчилсэн төлбөр болон шимтгэл төлсөн захиалгыг чөлөөлөхгүй', async () => {
    const cutoff = new Date('2026-09-18T00:00:00.000Z');
    let captured: { stockHold?: string; order?: unknown } | undefined;
    const tx = {
      $queryRaw: vi.fn(async () => []),
      orderItem: {
        findMany: vi.fn(async ({ where }: { where: { stockHold?: string; order?: unknown } }) => {
          captured = where;
          return [];
        }),
      },
    };
    expect(await releaseExpiredReadyHoldsForRounds(tx as never, ['r1'], cutoff)).toBe(0);
    expect(captured?.stockHold).toBe('RESERVED');
    expect(captured?.order).toEqual(unpaidAutoDeleteWhere(cutoff));
  });
});
