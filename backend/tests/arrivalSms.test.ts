import { describe, expect, it } from 'vitest';
import { arrivalSmsEligibility } from '../src/lib/arrivalSms.js';
import type { ArrivalSmsItem } from '../src/lib/arrivalSms.js';

const arrived: ArrivalSmsItem = {
  cancelledAt: null,
  arrivedAt: new Date(),
  arrivedQty: 1,
  qty: 1,
  handedOverAt: null,
};

function order(
  overrides: Partial<Parameters<typeof arrivalSmsEligibility>[0]> = {},
  items: ArrivalSmsItem[] = [arrived],
) {
  return arrivalSmsEligibility({
    deletedAt: null,
    status: 'ARRIVED',
    items,
    ...overrides,
  });
}

describe('бараа ирсэн SMS-ийн хүлээн авагч', () => {
  it('ирсэн, хүлээлгэж өгөөгүй бараатай захиалгыг зөвшөөрнө', () => {
    expect(order()).toEqual({ ok: true });
  });

  it('устгасан захиалгад илгээхгүй', () => {
    expect(order({ deletedAt: new Date() })).toMatchObject({ ok: false });
  });

  it('цуцлагдсан захиалгад илгээхгүй', () => {
    expect(order({ status: 'CANCELLED' })).toMatchObject({ ok: false, reason: 'Цуцлагдсан захиалга.' });
  });

  it('бүрэн хүлээлгэж өгсөн төлөвт илгээхгүй', () => {
    expect(order({ status: 'HANDED_OVER' })).toMatchObject({ ok: false });
  });

  it('бараа ирээгүй захиалгад илгээхгүй', () => {
    expect(
      order({}, [
        { cancelledAt: null, arrivedAt: null, arrivedQty: 0, qty: 2, handedOverAt: null },
      ]),
    ).toMatchObject({ ok: false, reason: 'Бараа ирээгүй.' });
  });

  it('цуцлагдсан мөрийг ирэлт гэж үзэхгүй', () => {
    expect(
      order({}, [
        { cancelledAt: new Date(), arrivedAt: new Date(), arrivedQty: 1, qty: 1, handedOverAt: null },
      ]),
    ).toMatchObject({ ok: false, reason: 'Идэвхтэй бараа алга.' });
  });

  it('бүх ирсэн барааг хүлээлгэсэн бол илгээхгүй', () => {
    expect(
      order({}, [
        { cancelledAt: null, arrivedAt: new Date(), arrivedQty: 1, qty: 1, handedOverAt: new Date() },
      ]),
    ).toMatchObject({ ok: false, reason: 'Барааг хүлээлгэн өгсөн.' });
  });

  it('хэсэгчлэн ирсэн, хүлээлгэж өгөөгүй үлдэгдэлтэй бол зөвшөөрнө', () => {
    expect(
      order({}, [
        { cancelledAt: null, arrivedAt: new Date(), arrivedQty: 1, qty: 2, handedOverAt: null },
        { cancelledAt: null, arrivedAt: null, arrivedQty: 0, qty: 1, handedOverAt: null },
      ]),
    ).toEqual({ ok: true });
  });

  it('хэсэг ирсэн ч тэр хэсгийг хүлээлгэсэн, нөгөө нь ирээгүй бол илгээхгүй', () => {
    expect(
      order({}, [
        { cancelledAt: null, arrivedAt: new Date(), arrivedQty: 1, qty: 1, handedOverAt: new Date() },
        { cancelledAt: null, arrivedAt: null, arrivedQty: 0, qty: 1, handedOverAt: null },
      ]),
    ).toMatchObject({ ok: false, reason: 'Барааг хүлээлгэн өгсөн.' });
  });
});
