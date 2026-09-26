import { describe, expect, it } from 'vitest';
import {
  arrivedQtyOf,
  handedQtyOf,
  itemQtyStatusOf,
  pickableQtyOf,
  waitingQtyOf,
} from '../src/lib/itemQty.js';

describe('мөрийн ширхэг', () => {
  it('огноог тоо мэт ашиглахгүй', () => {
    const item = {
      qty: 10,
      arrivedQty: 4,
      arrivedAt: null,
      handedOverQty: 0,
      handedOverAt: null,
    };
    expect(arrivedQtyOf(item)).toBe(4);
    expect(handedQtyOf(item)).toBe(0);
    expect(pickableQtyOf(item)).toBe(4);
    expect(waitingQtyOf(item)).toBe(6);
    expect(itemQtyStatusOf(item)).toBe('arrived');
  });

  it('захиалсан 10, ирсэн 4, эхлээд 2 олговол үлдсэн тоо зөв', () => {
    const afterFirst = {
      qty: 10,
      arrivedQty: 4,
      arrivedAt: null,
      handedOverQty: 2,
      handedOverAt: new Date(),
    };
    expect(handedQtyOf(afterFirst)).toBe(2);
    expect(pickableQtyOf(afterFirst)).toBe(2);
    expect(waitingQtyOf(afterFirst)).toBe(6);

    const afterMoreArrival = { ...afterFirst, arrivedQty: 7 };
    expect(arrivedQtyOf(afterMoreArrival)).toBe(7);
    expect(handedQtyOf(afterMoreArrival)).toBe(2);
    expect(pickableQtyOf(afterMoreArrival)).toBe(5);
    expect(waitingQtyOf(afterMoreArrival)).toBe(3);
  });

  it('хуучин бүрэн олголтыг handedOverAt-аар хадгална, таамгаар нөхөхгүй', () => {
    expect(
      handedQtyOf({ qty: 3, arrivedQty: 3, handedOverQty: 0, handedOverAt: new Date() }),
    ).toBe(3);
    expect(
      handedQtyOf({ qty: 3, arrivedQty: 3, handedOverQty: 0, handedOverAt: null }),
    ).toBe(0);
  });
});
