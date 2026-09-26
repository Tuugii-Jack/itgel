import { describe, expect, it } from 'vitest';
import { batchProgressLabel, batchProgressOf } from '../src/modules/batches/progress.js';

describe('batchProgressOf', () => {
  it('ирээгүй бол замд яваа', () => {
    expect(batchProgressOf({ stage: 'IN_TRANSIT', orderedQty: 10, arrivedQty: 0 })).toBe('in_transit');
  });

  it('хэсэг ирсэн бол partial', () => {
    expect(batchProgressOf({ stage: 'IN_TRANSIT', orderedQty: 10, arrivedQty: 4 })).toBe('partial');
  });

  it('бүрэн ирсэн бол complete', () => {
    expect(batchProgressOf({ stage: 'IN_TRANSIT', orderedQty: 10, arrivedQty: 10 })).toBe('complete');
    expect(batchProgressOf({ stage: 'AT_WAREHOUSE', orderedQty: 10, arrivedQty: 10 })).toBe('complete');
  });

  it('агуулахад орсон ч дутуу бол mismatch', () => {
    expect(batchProgressOf({ stage: 'AT_WAREHOUSE', orderedQty: 10, arrivedQty: 4 })).toBe('mismatch');
    expect(batchProgressOf({ stage: 'DONE', orderedQty: 10, arrivedQty: 0 })).toBe('mismatch');
  });

  it('захиалснаас илүү бол mismatch', () => {
    expect(batchProgressOf({ stage: 'IN_TRANSIT', orderedQty: 10, arrivedQty: 12 })).toBe('mismatch');
  });

  it('тойрог холбогдоогүй бол холбоос дутуу — бүрэн/0 мэт харагдахгүй', () => {
    expect(batchProgressOf({ stage: 'IN_TRANSIT', orderedQty: 0, arrivedQty: 0, unlinkedQty: 4 })).toBe('mismatch');
    expect(batchProgressOf({ stage: 'AT_WAREHOUSE', orderedQty: 0, arrivedQty: 0, unlinkedQty: 5 })).toBe('mismatch');
    expect(batchProgressOf({ stage: 'IN_TRANSIT', orderedQty: 4, arrivedQty: 4, unlinkedQty: 4 })).toBe('mismatch');
    expect(batchProgressLabel('mismatch', 4)).toBe('Холбоос дутуу');
    expect(batchProgressLabel('complete', 0)).toBe('Бүрэн ирсэн');
  });
});
