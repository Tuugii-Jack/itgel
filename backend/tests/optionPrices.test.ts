import { describe, expect, it } from 'vitest';
import { displayPriceRange, pricedOptionName, resolveOptionPrice } from '../src/lib/optionPrices.js';

const rows = [
  { kind: 'Хэмжээ', value: 'S', sellPrice: 10_000, costPrice: 4_000 },
  { kind: 'Хэмжээ', value: 'M', sellPrice: 20_000, costPrice: 8_000 },
  { kind: 'Өнгө', value: 'Хар', sellPrice: 12_000, costPrice: 5_000 },
];

describe('Сонголтын үнэ', () => {
  it('хэмжээг өнгөнөөс өмнө авна', () => {
    const p = resolveOptionPrice({ sellPrice: 9_000, costPrice: 3_000 }, rows, {
      Хэмжээ: 'S',
      Өнгө: 'Хар',
    });
    expect(p.sellPrice).toBe(10_000);
    expect(p.costPrice).toBe(4_000);
  });

  it('хэмжээ байхгүй бол өнгөний үнэ', () => {
    const p = resolveOptionPrice({ sellPrice: 9_000, costPrice: 3_000 }, rows, { Өнгө: 'Хар' });
    expect(p.sellPrice).toBe(12_000);
  });

  it('таарахгүй бол үндсэн үнэ', () => {
    const p = resolveOptionPrice({ sellPrice: 9_000, costPrice: 3_000 }, rows, { Хэмжээ: 'L' });
    expect(p.sellPrice).toBe(9_000);
  });

  it('жагсаалтад хэмжээний хамгийн бага–их (өнгөгүй)', () => {
    expect(displayPriceRange(9_000, rows)).toEqual({ price: 10_000, priceMax: 20_000 });
  });

  it('үнийн бүлэг — Хэмжээ давуу', () => {
    expect(pricedOptionName([{ name: 'Өнгө' }, { name: 'Хэмжээ' }])).toBe('Хэмжээ');
    expect(pricedOptionName([{ name: 'Өнгө' }])).toBe('Өнгө');
    expect(pricedOptionName([])).toBeNull();
  });
});
