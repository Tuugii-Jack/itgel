import { describe, expect, it } from 'vitest';
import {
  assertRefundable,
  computeTotals,
  paymentState,
  fullyPaid,
  unpaidCargoFee,
  type OrderTotals,
} from '../src/services/money.js';
import { AppError } from '../src/lib/errors.js';

const totals = (input: Partial<Parameters<typeof computeTotals>[0]>): OrderTotals =>
  computeTotals({
    subtotal: 0,
    deliveryFee: 0,
    paidAmount: 0,
    refundedAmount: 0,
    ...input,
  });

describe('Захиалгын дүн', () => {
  it('хүргэлтийн хураамж нийт дүнд ордоггүй', () => {
    const t = totals({ subtotal: 199_000, deliveryFee: 6_000 });
    expect(t.total).toBe(199_000);
    expect(t.deliveryFee).toBe(0);
  });

  it('нийт дүн = бараа + агуулах + карго', () => {
    const t = totals({ subtotal: 100_000, deliveryFee: 5_000, storageFee: 3_000, cargoFee: 12_000 });
    expect(t.total).toBe(115_000);
    expect(t.dueAmount).toBe(115_000);
    expect(t.cargoFee).toBe(12_000);
    expect(t.deliveryFee).toBe(0);
  });

  it('карго нэмэгдэхэд үлдэгдэл өснө', () => {
    const before = totals({ subtotal: 199_000, paidAmount: 199_000 });
    expect(before.dueAmount).toBe(0);
    const after = totals({ subtotal: 199_000, cargoFee: 8_000, paidAmount: 199_000 });
    expect(after.dueAmount).toBe(8_000);
    expect(fullyPaid(after)).toBe(true);
  });

  it('цэвэр орлого = төлсөн − буцаасан', () => {
    const t = totals({ subtotal: 100_000, paidAmount: 100_000, refundedAmount: 30_000 });
    expect(t.netPaid).toBe(70_000);
    expect(t.dueAmount).toBe(30_000);
  });

  it('төлөгдөөгүй захиалгын үлдэгдэл нь бүтэн дүн', () => {
    const t = totals({ subtotal: 55_000 });
    expect(t.dueAmount).toBe(55_000);
    expect(t.netPaid).toBe(0);
  });

  it('илүү төлсөн бол үлдэгдэл сөрөг', () => {
    const t = totals({ subtotal: 50_000, paidAmount: 60_000 });
    expect(t.dueAmount).toBe(-10_000);
  });

  it('хүргэлтийн хураамж үлдэгдэлд нэмэгдэхгүй', () => {
    const before = totals({ subtotal: 199_000, paidAmount: 199_000 });
    expect(before.dueAmount).toBe(0);

    const after = totals({ subtotal: 199_000, deliveryFee: 6_000, paidAmount: 199_000 });
    expect(after.dueAmount).toBe(0);
  });

  it('мөр цуцлагдаж subtotal буурахад үлдэгдэл сөрөг болно', () => {
    // 2 бараа авсан, бүтнээр төлсөн, дараа нь нэгийг нь цуцалсан.
    const t = totals({ subtotal: 100_000, paidAmount: 199_000 });
    expect(t.dueAmount).toBe(-99_000); // буцаах ёстой дүн
  });
});

describe('Төлбөрийн байдал', () => {
  it('мөнгө ороогүй бол төлөгдөөгүй', () => {
    expect(paymentState(totals({ subtotal: 100_000 }))).toBe('UNPAID');
  });

  it('бүтнээр төлсөн', () => {
    expect(paymentState(totals({ subtotal: 100_000, paidAmount: 100_000 }))).toBe('PAID');
  });

  it('нэг ч төгрөг орсон бол хэсэгчилсэн', () => {
    expect(paymentState(totals({ subtotal: 100_000, paidAmount: 20_000 }))).toBe('PARTIAL');
    expect(paymentState(totals({ subtotal: 100_000, paidAmount: 99_999 }))).toBe('PARTIAL');
  });

  it('илүү төлсөн', () => {
    expect(paymentState(totals({ subtotal: 50_000, paidAmount: 60_000 }))).toBe('OVERPAID');
  });

  it('бүгдийг буцаасан бол REFUNDED', () => {
    const t = totals({ subtotal: 50_000, paidAmount: 50_000, refundedAmount: 50_000 });
    expect(paymentState(t)).toBe('REFUNDED');
  });

  it('баталгаажих болзол — бараа бүрэн төлөгдсөн байх', () => {
    expect(fullyPaid(totals({ subtotal: 100_000, paidAmount: 50_000 }))).toBe(false);
    expect(fullyPaid(totals({ subtotal: 100_000, paidAmount: 100_000 }))).toBe(true);
    const withCargo = totals({ subtotal: 100_000, cargoFee: 8_000, paidAmount: 100_000 });
    expect(fullyPaid(withCargo)).toBe(true);
  });
});

describe('Карго үлдэгдэл', () => {
  it('бараа төлөгдсөн ч карго үлдэнэ', () => {
    expect(
      unpaidCargoFee({ subtotal: 100_000, cargoFee: 8_000, paidAmount: 100_000, refundedAmount: 0 }),
    ).toBe(8_000);
  });

  it('карго бүрэн төлөгдсөн бол 0', () => {
    expect(
      unpaidCargoFee({ subtotal: 100_000, cargoFee: 8_000, paidAmount: 108_000, refundedAmount: 0 }),
    ).toBe(0);
  });

  it('карго байхгүй бол 0', () => {
    expect(
      unpaidCargoFee({ subtotal: 100_000, cargoFee: 0, paidAmount: 50_000, refundedAmount: 0 }),
    ).toBe(0);
  });
});

describe('Буцаалтын хязгаар', () => {
  it('цэвэр орлогын хэмжээгээр буцаана', () => {
    const t = totals({ subtotal: 100_000, paidAmount: 100_000 });
    expect(() => assertRefundable(t, 100_000)).not.toThrow();
  });

  it('цэвэр орлогоос хэтэрвэл 409', () => {
    const t = totals({ subtotal: 100_000, paidAmount: 100_000 });
    try {
      assertRefundable(t, 100_001);
      expect.unreachable('алдаа гарах ёстой');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(409);
    }
  });

  it('аль хэдийн буцаасан дүнг тооцно', () => {
    const t = totals({ subtotal: 100_000, paidAmount: 100_000, refundedAmount: 60_000 });
    expect(() => assertRefundable(t, 40_000)).not.toThrow();
    expect(() => assertRefundable(t, 40_001)).toThrow();
  });

  it('0 буюу сөрөг дүн зөвшөөрөхгүй', () => {
    const t = totals({ subtotal: 100_000, paidAmount: 100_000 });
    expect(() => assertRefundable(t, 0)).toThrow();
    expect(() => assertRefundable(t, -5_000)).toThrow();
  });

  it('төлөөгүй захиалгаас буцаах боломжгүй', () => {
    expect(() => assertRefundable(totals({ subtotal: 100_000 }), 1)).toThrow();
  });
});
