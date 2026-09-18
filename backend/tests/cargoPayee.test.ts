import { describe, expect, it } from 'vitest';
import { shopDueAmount, unpaidCargoFee } from '../src/services/money.js';

describe('лизингийн карго — Итгэл', () => {
  const base = {
    isLeasing: true,
    payeeKind: 'LEASING',
    subtotal: 100_000,
    leasingFee: 10_000,
    storageFee: 0,
    cargoFee: 8_000,
    paidAmount: 10_000,
    refundedAmount: 0,
    shopPaidAmount: 0,
  };

  it('шимтгэл төлөгдсөн ч карго SHOP үлдэнэ', () => {
    expect(shopDueAmount(base)).toBe(8_000);
    expect(unpaidCargoFee(base)).toBe(8_000);
  });

  it('карго төлөгдөхөд барааны үлдэгдэл хаагдахгүй', () => {
    const afterCargo = { ...base, paidAmount: 18_000, shopPaidAmount: 8_000 };
    expect(unpaidCargoFee(afterCargo)).toBe(0);
    expect(shopDueAmount(afterCargo)).toBe(0);
  });

  it('хэрэглэгчийн үндсэн төлөлт каргод тооцогдохгүй', () => {
    const principal = { ...base, paidAmount: 60_000, shopPaidAmount: 0 };
    expect(unpaidCargoFee(principal)).toBe(8_000);
    expect(shopDueAmount(principal)).toBe(8_000);
  });

  it('бэлэн дахин борлуулалтад SHOP карго 0', () => {
    expect(
      shopDueAmount({
        isLeasing: false,
        payeeKind: 'LEASING',
        subtotal: 80_000,
        cargoFee: 8_000,
        paidAmount: 0,
        refundedAmount: 0,
      }),
    ).toBe(0);
  });
});
