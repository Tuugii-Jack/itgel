import { describe, expect, it } from 'vitest';
import {
  attributedShare,
  leasingPayeeSums,
  marginPercent,
  profitOf,
  splitAttributedAmount,
  subtotalOf,
} from '../src/lib/money.js';

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

const abShares = [
  { ownerId: 'lease-a', subtotal: 10_000 },
  { ownerId: 'lease-b', subtotal: 20_000 },
];

describe('Холимог эзэмшлийн хувь', () => {
  it('А=10,000 Б=20,000 төлсөн 30,000-г давхар тоолохгүй', () => {
    expect(attributedShare(30_000, 10_000, 30_000)).toBe(10_000);
    expect(attributedShare(30_000, 20_000, 30_000)).toBe(20_000);
    expect(attributedShare(30_000, 10_000, 30_000) + attributedShare(30_000, 20_000, 30_000)).toBe(
      30_000,
    );
  });

  it('шүүлтгүй/хоосон дүн 0', () => {
    expect(attributedShare(30_000, 0, 30_000)).toBe(0);
    expect(attributedShare(0, 10_000, 30_000)).toBe(0);
  });

  it('1₮ төлөлтийн floor үлдэгдэл ил тод, эздийн нийлбэртэй тэнцэнэ', () => {
    const split = splitAttributedAmount(1, abShares);
    expect(split.byOwner['lease-a']).toBe(0);
    expect(split.byOwner['lease-b']).toBe(0);
    expect(split.unallocated).toBe(1);
    expect(split.byOwner['lease-a']! + split.byOwner['lease-b']! + split.unallocated).toBe(1);
  });

  it('хэсэгчилсэн буцаалтын үлдэгдэл алдагдахгүй', () => {
    const split = splitAttributedAmount(1, abShares);
    expect(split.byOwner['lease-a']! + split.byOwner['lease-b']! + split.unallocated).toBe(1);
  });

  it('илүү төлөлтийг нуухгүй — 31,001₮-г бүрэн задална', () => {
    const split = splitAttributedAmount(31_001, abShares);
    expect(split.byOwner['lease-a']! + split.byOwner['lease-b']! + split.unallocated).toBe(31_001);
    expect(split.unallocated).toBeGreaterThanOrEqual(0);
  });

  it('SHOP карго төлбөрийг лизингийн дүнгээс хасна', () => {
    expect(
      leasingPayeeSums([
        { kind: 'PAYMENT', payeeKind: 'LEASING', amount: 1 },
        { kind: 'PAYMENT', payeeKind: 'SHOP', amount: 5_000 },
        { kind: 'REFUND', payeeKind: 'SHOP', amount: 500 },
      ]),
    ).toEqual({ paid: 1, refunded: 0 });
  });
});
