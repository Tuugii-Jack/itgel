import { describe, expect, it } from 'vitest';
import { roundDeadlinePassed, shopRoundWhere } from '../src/lib/roundShop.js';

describe('дэлгүүрийн харагдах тойрог', () => {
  const now = new Date('2026-08-20T12:00:00.000Z');

  it('хаах цаг хүрсэн бол хаагдсан', () => {
    expect(roundDeadlinePassed(new Date('2026-08-20T11:59:59.000Z'), now)).toBe(true);
    expect(roundDeadlinePassed(new Date('2026-08-20T12:00:00.000Z'), now)).toBe(true);
    expect(roundDeadlinePassed(new Date('2026-08-20T12:00:01.000Z'), now)).toBe(false);
    expect(roundDeadlinePassed(null, now)).toBe(false);
  });

  it('дэлгүүрт зөвхөн хаагдаагүй ACTIVE/SOLD_OUT', () => {
    const where = shopRoundWhere(now);
    expect(where.status).toEqual({ in: ['ACTIVE', 'SOLD_OUT'] });
    expect(where.OR).toEqual([{ closeAt: null }, { closeAt: { gt: now } }]);
  });
});
