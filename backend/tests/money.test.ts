import { describe, expect, it } from 'vitest';
import { marginPercent, profitOf, splitPayment, subtotalOf } from '../src/lib/money.js';

describe('Захиалгын дүн', () => {
  it('Σ(unitPrice × qty)', () => {
    expect(subtotalOf([{ qty: 2, unitPrice: 79_000 }, { qty: 1, unitPrice: 35_000 }])).toBe(193_000);
  });

  it('хоосон захиалга 0', () => {
    expect(subtotalOf([])).toBe(0);
  });
});

describe('Төлбөрийн хуваарилалт', () => {
  it('100% үед үлдэгдэл 0', () => {
    expect(splitPayment(199_000, 100)).toEqual({ paidAmount: 199_000, dueAmount: 0 });
  });

  it('50% урьдчилгаа', () => {
    expect(splitPayment(199_000, 50)).toEqual({ paidAmount: 99_500, dueAmount: 99_500 });
  });

  it('бутархай гарвал доош тойрч, нийлбэр нь дүнтэй тэнцэнэ', () => {
    const { paidAmount, dueAmount } = splitPayment(99_999, 30);
    expect(paidAmount).toBe(29_999); // 29999.7 → доош
    expect(paidAmount + dueAmount).toBe(99_999);
    expect(Number.isInteger(paidAmount)).toBe(true);
  });

  it('0% үед бүгд үлдэгдэл', () => {
    expect(splitPayment(50_000, 0)).toEqual({ paidAmount: 0, dueAmount: 50_000 });
  });

  it('хязгаараас гадуур хувийг таслана', () => {
    expect(splitPayment(50_000, 140)).toEqual({ paidAmount: 50_000, dueAmount: 0 });
    expect(splitPayment(50_000, -20)).toEqual({ paidAmount: 0, dueAmount: 50_000 });
  });
});

describe('Ашиг', () => {
  it('Σ((unitPrice − costPriceSnapshot) × qty)', () => {
    expect(
      profitOf([
        { qty: 2, unitPrice: 79_000, costPriceSnapshot: 42_000 },
        { qty: 1, unitPrice: 35_000, costPriceSnapshot: 18_000 },
      ]),
    ).toBe(91_000);
  });

  it('өртөг үнээс өндөр бол сөрөг ашиг', () => {
    expect(profitOf([{ qty: 1, unitPrice: 10_000, costPriceSnapshot: 12_000 }])).toBe(-2_000);
  });

  it('ашгийн хувь', () => {
    expect(marginPercent(100_000, 60_000)).toBe(40);
    expect(marginPercent(79_000, 42_000)).toBe(47);
    expect(marginPercent(0, 0)).toBe(0);
  });
});
