import { describe, expect, it } from 'vitest';
import { skuKeyOf } from '../src/lib/skuStock.js';
import { lineCargoFee, unitCargoFee } from '../src/services/cargoFee.js';

describe('unitCargoFee', () => {
  const blackM = { Хэмжээ: 'M', Өнгө: 'Хар' };
  const whiteXl = { Хэмжээ: 'XL', Өнгө: 'Цагаан' };
  const fees = [
    { skuKey: skuKeyOf(blackM), cargoFee: 8000 },
    { skuKey: skuKeyOf(whiteXl), cargoFee: 12000 },
  ];
  const round = { cargoFee: 5000, cargoFees: fees };

  it('сонголтод таарсан үнийг авна', () => {
    expect(unitCargoFee(round, blackM)).toBe(8000);
    expect(unitCargoFee(round, { Өнгө: 'Цагаан', Хэмжээ: 'XL' })).toBe(12000);
  });

  it('таарахгүй бол тойргийн үндсэн үнэ', () => {
    expect(unitCargoFee(round, { Хэмжээ: 'S' })).toBe(5000);
    expect(unitCargoFee(round, {})).toBe(5000);
    expect(unitCargoFee({ cargoFee: 3000 }, { Хэмжээ: 'M' })).toBe(3000);
    expect(unitCargoFee(null, { Хэмжээ: 'M' })).toBe(0);
  });

  it('мөрийн нийт = ширхэг × нэгж', () => {
    expect(lineCargoFee(3, round, blackM)).toBe(24000);
  });
});
