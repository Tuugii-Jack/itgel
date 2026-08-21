import { describe, expect, it } from 'vitest';
import { skuKeyOf } from '../src/lib/skuStock.js';
import {
  buildCargoVariantRows,
  cargoTotalForItems,
  unitCargoFee,
} from '../src/services/cargoFee.js';

describe('unitCargoFee', () => {
  it('override байхгүй бол тойргийн үндсэн үнийг авна', () => {
    expect(unitCargoFee({ cargoFee: 5000 }, { Хэмжээ: 'M' })).toBe(5000);
    expect(unitCargoFee(null, { Хэмжээ: 'M' })).toBe(0);
  });

  it('сонголтын хослолд таарсан үнийг авна', () => {
    const blackM = { Хэмжээ: 'M', Өнгө: 'Хар' };
    const blackL = { Хэмжээ: 'L', Өнгө: 'Хар' };
    const round = {
      cargoFee: 3000,
      cargoFees: [
        { skuKey: skuKeyOf(blackM), cargoFee: 8000 },
        { skuKey: skuKeyOf(blackL), cargoFee: 9000 },
      ],
    };
    expect(unitCargoFee(round, blackM)).toBe(8000);
    expect(unitCargoFee(round, { Өнгө: 'Хар', Хэмжээ: 'L' })).toBe(9000);
    expect(unitCargoFee(round, { Хэмжээ: 'S', Өнгө: 'Хар' })).toBe(3000);
  });
});

describe('cargoTotalForItems', () => {
  it('мөр бүрийн qty × сонголтын каргог нийлнэ', () => {
    const round = {
      cargoFee: 1000,
      cargoFees: [{ skuKey: skuKeyOf({ Хэмжээ: 'M' }), cargoFee: 4000 }],
    };
    expect(
      cargoTotalForItems([
        { qty: 2, selections: { Хэмжээ: 'M' }, round },
        { qty: 3, selections: { Хэмжээ: 'L' }, round },
        { qty: 1, cancelledAt: new Date(), selections: { Хэмжээ: 'M' }, round },
      ]),
    ).toBe(2 * 4000 + 3 * 1000);
  });
});

describe('buildCargoVariantRows', () => {
  it('барааны бүх хэмжээ/өнгө хослолыг мөр болгоно', () => {
    const rows = buildCargoVariantRows({
      defaultFee: 2000,
      overrides: [{ skuKey: skuKeyOf({ Хэмжээ: 'M', Өнгө: 'Хар' }), cargoFee: 7000 }],
      arrivals: [{ selections: { Хэмжээ: 'M', Өнгө: 'Хар' }, orderedQty: 3 }],
      productVariants: [
        { kind: 'Хэмжээ', value: 'M', sortOrder: 0 },
        { kind: 'Хэмжээ', value: 'L', sortOrder: 1 },
        { kind: 'Өнгө', value: 'Хар', sortOrder: 0 },
        { kind: 'Өнгө', value: 'Цагаан', sortOrder: 1 },
      ],
    });
    expect(rows).toHaveLength(4);
    const blackM = rows.find((r) => r.selections.Хэмжээ === 'M' && r.selections.Өнгө === 'Хар');
    expect(blackM).toMatchObject({ cargoFee: 7000, orderedQty: 3 });
    const whiteL = rows.find((r) => r.selections.Хэмжээ === 'L' && r.selections.Өнгө === 'Цагаан');
    expect(whiteL).toMatchObject({ cargoFee: 2000, orderedQty: 0 });
  });

  it('сонголтгүй бараанд нэг үндсэн мөр гаргана', () => {
    const rows = buildCargoVariantRows({
      defaultFee: 1500,
      overrides: [],
      arrivals: [{ selections: {}, orderedQty: 5 }],
      productVariants: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cargoFee: 1500, orderedQty: 5, label: '—' });
  });
});
