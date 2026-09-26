import { describe, expect, it } from 'vitest';
import { customerNextActionOf, customerOrderProgress } from '../src/modules/orders/customerNextAction.js';
import type { OrderTotals } from '../src/services/money.js';

const paid: OrderTotals = {
  subtotal: 100_000,
  deliveryFee: 0,
  storageFee: 0,
  cargoFee: 0,
  leasingFee: 0,
  total: 100_000,
  paidAmount: 100_000,
  refundedAmount: 0,
  netPaid: 100_000,
  writtenOffAmount: 0,
  dueAmount: 0,
};

describe('хэрэглэгчийн захиалгын явц', () => {
  it('хэсэгчилсэн ирэлтийг бүтэн ирсэн мэт харуулахгүй', () => {
    const progress = customerOrderProgress({
      status: 'ARRIVED',
      items: [
        { qty: 1, arrivedAt: new Date(), arrivedQty: 1, handedOverAt: null },
        { qty: 1, arrivedAt: null, arrivedQty: 0, handedOverAt: null },
      ],
    });
    expect(progress.find((s) => s.current)?.key).toBe('arrived');
    expect(progress.find((s) => s.key === 'handed')?.reached).toBe(false);
  });

  it('цуцлагдсан захиалгад шат гэрэлтэхгүй', () => {
    const progress = customerOrderProgress({
      status: 'CANCELLED',
      items: [{ qty: 1, arrivedAt: new Date(), arrivedQty: 1, handedOverAt: null }],
    });
    expect(progress.every((s) => !s.reached && !s.current)).toBe(true);
  });

  it('бэлэн бараанд замд шатыг харуулахгүй', () => {
    const progress = customerOrderProgress({
      status: 'CONFIRMED',
      readyStock: true,
      items: [{ qty: 1, arrivedAt: null, arrivedQty: 0, handedOverAt: null }],
    });
    expect(progress.map((s) => s.key)).toEqual(['placed', 'confirmed', 'arrived', 'handed']);
  });

  it('олгох боломжтой үед л pickup QR өгнө', () => {
    const waiting = customerNextActionOf({
      code: 'PH-AAAAAA',
      status: 'IN_TRANSIT',
      items: [{ qty: 1, arrivedAt: null, arrivedQty: 0, handedOverAt: null }],
      totals: paid,
    });
    expect(waiting.pickupQr).toBeNull();
    expect(waiting.etaFrom).toBeNull();

    const ready = customerNextActionOf({
      code: 'PH-AAAAAA',
      status: 'ARRIVED',
      items: [{ qty: 1, arrivedAt: new Date(), arrivedQty: 1, handedOverAt: null }],
      totals: paid,
    });
    expect(ready.pickupQr).toBe('itgel:pickup:PH-AAAAAA');
    expect(ready.cta).toBe('pickup');
  });

  it('хэсэгчилсэн ирэлт/олголтын тоог хэрэглэгчид зөв харуулна', () => {
    const next = customerNextActionOf({
      code: 'PH-CCCCCC',
      status: 'ARRIVED',
      items: [
        {
          qty: 10,
          arrivedAt: null,
          arrivedQty: 4,
          handedOverAt: new Date(),
          handedOverQty: 2,
        },
      ],
      totals: paid,
    });
    expect(next.cta).toBe('pickup');
    expect(next.pickupQr).toBe('itgel:pickup:PH-CCCCCC');
    expect(next.detail).toContain('Ирсэн 4, олгосон 2, одоо авах 2, ирээгүй 6');
  });

  it('хэсэгчилсэн төлбөрийг барааны явцаас тусад нь заана', () => {
    const next = customerNextActionOf({
      code: 'PH-BBBBBB',
      status: 'ARRIVED',
      items: [{ qty: 1, arrivedAt: new Date(), arrivedQty: 1, handedOverAt: null }],
      totals: { ...paid, paidAmount: 40_000, netPaid: 40_000, dueAmount: 60_000 },
    });
    expect(next.cta).toBe('pay');
    expect(next.nextPayAmount).toBe(60_000);
    expect(next.pickupQr).toBe('itgel:pickup:PH-BBBBBB');
  });
});
