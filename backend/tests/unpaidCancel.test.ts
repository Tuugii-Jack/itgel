import { describe, expect, it } from 'vitest';
import { unpaidAutoDeleteWhere } from '../src/lib/unpaidCancel.js';

describe('төлбөргүй захиалга 12 цагийн дараа', () => {
  const cutoff = new Date('2026-09-12T00:00:00.000Z');

  it('зөвхөн мөнгө ороогүй NEW захиалгыг шүүнэ', () => {
    expect(unpaidAutoDeleteWhere(cutoff)).toEqual({
      deletedAt: null,
      status: 'NEW',
      paidAmount: 0,
      createdAt: { lte: cutoff },
      payments: { none: { kind: 'PAYMENT' } },
    });
  });

  it('шилжүүлсэн гэж мэдэгдсэн эсэхийг харгалзахгүй', () => {
    expect(unpaidAutoDeleteWhere(cutoff)).not.toHaveProperty('paymentClaimedAt');
  });
});
