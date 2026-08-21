import { describe, expect, it } from 'vitest';
import { tallyVariants } from '../src/lib/options.js';

describe('tallyVariants', () => {
  it('хэмжээ, өнгөөр тусад нь болон хослолоор нэгтгэнэ', () => {
    const { byKind, byVariant } = tallyVariants([
      { selections: { Хэмжээ: 'M', Өнгө: 'Хар' }, qty: 2 },
      { selections: { Хэмжээ: 'M', Өнгө: 'Цагаан' }, qty: 1 },
      { selections: { Хэмжээ: 'L', Өнгө: 'Хар' }, qty: 3 },
    ]);

    expect(byVariant).toHaveLength(3);
    expect(byVariant[0]).toMatchObject({ qty: 3, size: 'L', color: 'Хар' });

    const size = byKind.find((k) => k.kind === 'Хэмжээ')?.rows;
    const color = byKind.find((k) => k.kind === 'Өнгө')?.rows;
    expect(size).toEqual([
      { value: 'L', qty: 3 },
      { value: 'M', qty: 3 },
    ]);
    expect(color).toEqual([
      { value: 'Хар', qty: 5 },
      { value: 'Цагаан', qty: 1 },
    ]);
  });

  it('хэмжээ/өнгөнөөс бусад сонголтыг тусад нь хослол болон бүлгээр нэгтгэнэ', () => {
    const { byKind, byVariant } = tallyVariants([
      { selections: { Хэмжээ: 'M', Өнгө: 'Хар', Материал: 'Ноос' }, qty: 2 },
      { selections: { Хэмжээ: 'M', Өнгө: 'Хар', Материал: 'Хлопок' }, qty: 1 },
    ]);

    expect(byVariant).toHaveLength(2);
    const material = byKind.find((k) => k.kind === 'Материал')?.rows;
    expect(material).toEqual([
      { value: 'Ноос', qty: 2 },
      { value: 'Хлопок', qty: 1 },
    ]);
  });
});
