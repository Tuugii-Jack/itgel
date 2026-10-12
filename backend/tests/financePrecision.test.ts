import { describe, expect, it } from 'vitest';
import { leasingFeeOf, leasingFeeSnapshot } from '../src/lib/leasing.js';
import { attributedShare, splitAttributedAmount } from '../src/lib/money.js';
import { assertRefundable, computeTotals, isProductPaid } from '../src/services/money.js';

describe('санхүүгийн тооцооны захын нөхцөл', () => {
  it('0.5₮-ийн шимтгэлийг дээш бүхэлчилнэ', () => {
    expect(leasingFeeOf(1_500, [{ minAmount: 0, ratePercent: 14.1 }])).toBe(212);
    expect(leasingFeeOf(8_500, [{ minAmount: 0, ratePercent: 11.7 }])).toBe(995);
  });

  it('бүх зөвшөөрөгдсөн хувьд бүхэл төгрөгийн лавлахтай таарна', () => {
    for (let tenths = 1; tenths <= 1_000; tenths++) {
      for (const subtotal of [125, 500, 1_500, 8_500, 2_147_483_647]) {
        const exact = Number((BigInt(subtotal) * BigInt(tenths) + 500n) / 1_000n);
        expect(leasingFeeOf(subtotal, [{ minAmount: 0, ratePercent: tenths / 10 }])).toBe(exact);
      }
    }
  });

  it('том дүнг эзэд рүү хуваахдаа 1₮ нэмж тооцохгүй', () => {
    const amount = 1_073_741_824;
    const own = 2_147_483_645;
    const total = 2_147_483_647;
    expect(attributedShare(amount, own, total)).toBe(1_073_741_822);
    const split = splitAttributedAmount(amount, [
      { ownerId: 'a', subtotal: own }, { ownerId: 'b', subtotal: 2 },
    ]);
    expect(split.byOwner.a).toBe(1_073_741_822);
    expect(split.byOwner.a! + split.byOwner.b! + split.unallocated).toBe(amount);
  });

  it('хадгалсан шимтгэлийг дахин бодоход дүн өөрчлөгдөхгүй', () => {
    for (const subtotal of [1, 125, 1_500, 100_000, 2_147_483_647]) {
      const fee = leasingFeeOf(subtotal);
      expect(leasingFeeSnapshot({ isLeasing: true, previousSubtotal: subtotal,
        previousFee: fee, nextSubtotal: subtotal, fallbackFee: fee })).toBe(fee);
    }
  });

  it('буцаалт NaN, Infinity, бутархай төгрөгийг зөвшөөрөхгүй', () => {
    const totals = computeTotals({ subtotal: 100_000, paidAmount: 100_000, refundedAmount: 0 });
    for (const amount of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => assertRefundable(totals, amount)).toThrow();
    }
  });

  it('шопын каргоны мөнгө лизингийн шимтгэлд тооцогдохгүй', () => {
    expect(isProductPaid({ subtotal: 100_000, leasingFee: 10_000,
      paidAmount: 30_000, refundedAmount: 10_000, shopPaidAmount: 20_000 })).toBe(false);
  });
});
