import { describe, expect, it } from 'vitest';
import { parsePickupLookup, pickupQrValue } from '../src/lib/pickupQr.js';

describe('олголтын QR лавлагаа', () => {
  it('код, prefix, жижиг үсгийг лавлагаа болгоно', () => {
    expect(pickupQrValue('ph-ab12cd')).toBe('itgel:pickup:PH-AB12CD');
    expect(parsePickupLookup('itgel:pickup:PH-AB12CD')).toBe('PH-AB12CD');
    expect(parsePickupLookup('PH-AB12CD')).toBe('PH-AB12CD');
    expect(parsePickupLookup('code=itgel:pickup:ph-ab12cd')).toBe('PH-AB12CD');
  });

  it('нэр, утас, JWT агуулаагүй', () => {
    const value = pickupQrValue('PH-AB12CD');
    expect(value).not.toMatch(/9911/);
    expect(value).not.toMatch(/eyJ/);
    expect(value).not.toMatch(/jwt/i);
  });

  it('буруу лавлагааг null буцаана', () => {
    expect(parsePickupLookup('')).toBeNull();
    expect(parsePickupLookup('QPAY-INVOICE')).toBeNull();
    expect(parsePickupLookup('itgel:pay:PH-AB12CD')).toBe('PH-AB12CD');
  });
});
