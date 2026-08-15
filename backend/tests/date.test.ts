import { describe, expect, it } from 'vitest';
import {
  addDays,
  computeArrival,
  diffUbDays,
  endOfUbDay,
  parseUbDay,
  payoutDateForReturn,
  payoutWindow,
  startOfUbDay,
  startOfUbMonth,
  ubDateString,
  ubMonthKey,
} from '../src/lib/date.js';

describe('UB цагийн бүс', () => {
  it('UTC 16:00 нь дараагийн UB өдөр', () => {
    // 2025-11-10T16:00Z = 2025-11-11 00:00 UB
    expect(ubDateString(new Date('2025-11-10T16:00:00Z'))).toBe('2025-11-11');
    expect(ubDateString(new Date('2025-11-10T15:59:59Z'))).toBe('2025-11-10');
  });

  it('startOfUbDay нь UTC 16:00 (өмнөх өдөр)', () => {
    expect(startOfUbDay(new Date('2025-11-10T09:30:00Z')).toISOString()).toBe(
      '2025-11-09T16:00:00.000Z',
    );
  });

  it('endOfUbDay нь өдрийн сүүлийн миллисекунд', () => {
    expect(endOfUbDay(new Date('2025-11-10T09:30:00Z')).toISOString()).toBe(
      '2025-11-10T15:59:59.999Z',
    );
  });

  it('parseUbDay нь мөрийг UB өдрийн эхлэл болгоно', () => {
    expect(parseUbDay('2025-11-10').toISOString()).toBe('2025-11-09T16:00:00.000Z');
    expect(ubDateString(parseUbDay('2025-11-10'))).toBe('2025-11-10');
  });

  it('diffUbDays нь календарийн хоногоор тоолно', () => {
    // UB цагаар 23:00 ба маргааш 01:00 — 1 хоногийн зөрүү
    const a = new Date('2025-11-10T15:00:00Z'); // 2025-11-10 23:00 UB
    const b = new Date('2025-11-10T17:00:00Z'); // 2025-11-11 01:00 UB
    expect(diffUbDays(b, a)).toBe(1);
  });

  it('сарын эхлэл ба түлхүүр', () => {
    expect(startOfUbMonth(new Date('2025-11-10T09:00:00Z')).toISOString()).toBe(
      '2025-10-31T16:00:00.000Z',
    );
    expect(ubMonthKey(new Date('2025-11-10T09:00:00Z'))).toBe('2025-11');
    // UB цагаар 12-р сарын 1, UTC-гаар 11-р сарын 30
    expect(ubMonthKey(new Date('2025-11-30T16:00:00Z'))).toBe('2025-12');
  });
});

describe('Гарт очих огноо', () => {
  const closeAt = new Date('2025-11-10T00:00:00Z');

  it('захиалгын бараа: closeAt + lead өдрүүд', () => {
    const { arriveFrom, arriveTo, isReady } = computeArrival(closeAt, 7, 14);
    expect(isReady).toBe(false);
    expect(arriveFrom.toISOString()).toBe('2025-11-17T00:00:00.000Z');
    expect(arriveTo.toISOString()).toBe('2025-11-24T00:00:00.000Z');
  });

  it('min ба max тэнцүү үед нэг өдөр', () => {
    const { arriveFrom, arriveTo } = computeArrival(closeAt, 10, 10);
    expect(arriveFrom.getTime()).toBe(arriveTo.getTime());
  });

  it('бэлэн бараа маргааш авна', () => {
    const now = new Date('2025-11-10T09:00:00Z');
    const { arriveFrom, arriveTo, isReady } = computeArrival(null, 7, 14, now);
    expect(isReady).toBe(true);
    expect(ubDateString(arriveFrom)).toBe('2025-11-11');
    expect(arriveFrom.getTime()).toBe(arriveTo.getTime());
  });

  it('бэлэн бараа: UB шөнө дунд өнгөрсний дараа ч маргаашийг заана', () => {
    const now = new Date('2025-11-10T16:30:00Z'); // 2025-11-11 00:30 UB
    const { arriveFrom } = computeArrival(null, 7, 14, now);
    expect(ubDateString(arriveFrom)).toBe('2025-11-12');
  });

  it('addDays нь цагийн хэсгийг хадгална', () => {
    expect(addDays(new Date('2025-11-10T09:15:00Z'), 3).toISOString()).toBe(
      '2025-11-13T09:15:00.000Z',
    );
  });
});

describe('Буцаалтын 10/20/30', () => {
  it('10-оос өмнө → тухайн сарын 10', () => {
    expect(payoutDateForReturn(parseUbDay('2026-08-09'))).toBe('2026-08-10');
    expect(payoutDateForReturn(parseUbDay('2026-08-01'))).toBe('2026-08-10');
  });

  it('20-оос өмнө (10-оос хойш) → 20', () => {
    expect(payoutDateForReturn(parseUbDay('2026-08-10'))).toBe('2026-08-20');
    expect(payoutDateForReturn(parseUbDay('2026-08-19'))).toBe('2026-08-20');
  });

  it('30-аас өмнө → 30', () => {
    expect(payoutDateForReturn(parseUbDay('2026-08-20'))).toBe('2026-08-30');
    expect(payoutDateForReturn(parseUbDay('2026-08-29'))).toBe('2026-08-30');
  });

  it('30, 31 → дараа сарын 10', () => {
    expect(payoutDateForReturn(parseUbDay('2026-08-30'))).toBe('2026-09-10');
    expect(payoutDateForReturn(parseUbDay('2026-08-31'))).toBe('2026-09-10');
    expect(payoutDateForReturn(parseUbDay('2026-12-30'))).toBe('2027-01-10');
  });

  it('хоёрдугаар сарын сүүл 30-ны цонх', () => {
    expect(payoutDateForReturn(parseUbDay('2026-02-20'))).toBe('2026-02-28');
    expect(payoutDateForReturn(parseUbDay('2026-02-28'))).toBe('2026-02-28');
  });

  it('10-ны цонх өмнөх сарын 30-аас 9 хүртэл', () => {
    const w = payoutWindow('2026-08-10');
    expect(ubDateString(w.gte)).toBe('2026-07-30');
    expect(ubDateString(w.lte)).toBe('2026-08-09');
  });

  it('20-ны цонх 10–19', () => {
    const w = payoutWindow('2026-08-20');
    expect(ubDateString(w.gte)).toBe('2026-08-10');
    expect(ubDateString(w.lte)).toBe('2026-08-19');
  });

  it('30-ны цонх 20–29', () => {
    const w = payoutWindow('2026-08-30');
    expect(ubDateString(w.gte)).toBe('2026-08-20');
    expect(ubDateString(w.lte)).toBe('2026-08-29');
  });
});
