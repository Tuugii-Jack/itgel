import { describe, expect, it } from 'vitest';
import {
  allocateFifo,
  decodeTimeIdCursor,
  encodeTimeIdCursor,
  parseWholeTugrik,
  paymentConfirmedAt,
  planSettlementPayment,
  settlementDisplayLabel,
  settlementDisplayStatus,
} from '../src/lib/settlementMoney.js';

const A = { id: 'a', remainingAmount: 10_000, confirmedAt: new Date('2026-09-19T04:00:00.000Z') };
const B = { id: 'b', remainingAmount: 20_000, confirmedAt: new Date('2026-09-20T04:00:00.000Z') };
const C = { id: 'c', remainingAmount: 5_000, confirmedAt: new Date('2026-09-21T04:00:00.000Z') };

describe('settlementMoney', () => {
  it('FIFO-оор хамгийн эрт өрийг эхлээд хаана', () => {
    expect(allocateFifo([C, B, A], 15_000)).toEqual([
      { settlementId: 'a', amount: 10_000 },
      { settlementId: 'b', amount: 5_000 },
    ]);
  });

  it('сонгоогүй өрөнд хуваарилдаггүй', () => {
    const plan = planSettlementPayment([A, B], 15_000, [
      { settlementId: 'a', amount: 10_000 },
      { settlementId: 'c', amount: 5_000 },
    ]);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toMatch(/Сонгоогүй/);
  });

  it('0, сөрөг, бүхэл биш, илүү дүнг хориглоно', () => {
    expect(planSettlementPayment([A], 0).ok).toBe(false);
    expect(planSettlementPayment([A], -1).ok).toBe(false);
    expect(planSettlementPayment([A], 10_000.5).ok).toBe(false);
    expect(planSettlementPayment([A], 10_001).ok).toBe(false);
    expect(parseWholeTugrik('15000.5')).toBeNull();
    expect(parseWholeTugrik('15000')).toBe(15_000);
  });

  it('зөвшөөрсөн хуваарилалтыг хэвээр үлдээнэ', () => {
    const plan = planSettlementPayment([A, B], 12_000, [
      { settlementId: 'b', amount: 12_000 },
    ]);
    expect(plan).toEqual({
      ok: true,
      amount: 12_000,
      allocations: [{ settlementId: 'b', amount: 12_000 }],
    });
  });

  it('төлөвийн шошгыг хэрэглэгчийн төлбөрөөс тусад нь гаргана', () => {
    expect(settlementDisplayStatus({ status: 'OPEN', paidAmount: 0, remainingAmount: 10 })).toBe('UNPAID');
    expect(
      settlementDisplayStatus({ status: 'OPEN', paidAmount: 4_000, remainingAmount: 6_000 }),
    ).toBe('PARTIAL');
    expect(settlementDisplayLabel('QPAY_PENDING')).toBe('QPay хүлээгдэж байна');
    expect(settlementDisplayLabel('BANK_PENDING')).toBe('Дансны баталгаа хүлээж байна');
    expect(settlementDisplayLabel('PAID')).toBe('Төлсөн');
  });

  it('нотолгоогүй confirmedAt-ийг төлсөн өдөр гэж үзэхгүй', () => {
    expect(
      paymentConfirmedAt({
        status: 'CONFIRMED',
        confirmedAt: null,
        updatedAt: new Date('2026-09-21T10:00:00.000Z'),
      }),
    ).toBeNull();
  });

  it('cursor-ийг тогтвортой кодчилно', () => {
    const at = new Date('2026-09-21T04:00:00.000Z');
    const encoded = encodeTimeIdCursor({ at, id: 'abc' });
    expect(decodeTimeIdCursor(encoded)).toEqual({ at, id: 'abc' });
  });
});
