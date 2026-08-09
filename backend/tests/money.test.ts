import { describe, expect, it } from 'vitest';
import { marginPercent, profitOf, subtotalOf } from '../src/lib/money.js';

describe('Захиалгын дүн', () => {
  it('Σ(unitPrice × qty)', () => {
    expect(subtotalOf([{ qty: 2, unitPrice: 79_000 }, { qty: 1, unitPrice: 35_000 }])).toBe(193_000);
  });

  it('хоосон захиалга 0', () => {
    expect(subtotalOf([])).toBe(0);
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
