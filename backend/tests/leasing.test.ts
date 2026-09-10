import { describe, expect, it } from 'vitest';
import { leasingFeeOf, leasingFlagOf, leasingView, leasingFeeHold, leasingHoldsGoods, resolveInvoiceAmount, canWriteLeasingOrderMoney, leasingGoodsWhere, leasingRatePercent, parseLeasingFeeTiers, assertLeasingFeeTiers, leasingFeeSnapshot, SUGGESTED_LEASING_FEE_TIERS, splitEven, parseLeasingPayGaps, buildLeasingPayPlan, serializeLeasing } from '../src/lib/leasing.js';
import { AppError } from '../src/lib/errors.js';

describe('Лизингийн шимтгэл', () => {
  it('нийт үнийн 10%', () => {
    expect(leasingFeeOf(100_000)).toBe(10_000);
    expect(leasingFeeOf(199_000)).toBe(19_900);
  });

  it('эерэг биш дүн 0', () => {
    expect(leasingFeeOf(0)).toBe(0);
    expect(leasingFeeOf(-1)).toBe(0);
  });

  it('QPay ↔ лизинг шилжихэд шимтгэл зөв', () => {
    expect(leasingFlagOf(1_000, true)).toEqual({ isLeasing: true, leasingFee: 100 });
    expect(leasingFlagOf(1_000, false)).toEqual({ isLeasing: false, leasingFee: 0 });
  });

  it('үнийн шатлалаар хувь өснө', () => {
    const tiers = SUGGESTED_LEASING_FEE_TIERS;
    expect(leasingRatePercent(199_999, tiers)).toBe(15);
    expect(leasingRatePercent(200_000, tiers)).toBe(14);
    expect(leasingRatePercent(300_000, tiers)).toBe(13);
    expect(leasingRatePercent(400_000, tiers)).toBe(12);
    expect(leasingRatePercent(500_000, tiers)).toBe(11);
    expect(leasingFeeOf(200_000, tiers)).toBe(28_000);
    expect(leasingFeeOf(500_000, tiers)).toBe(55_000);
  });

  it('хоосон тохиргоо 10% руу буцна', () => {
    expect(parseLeasingFeeTiers([])).toEqual([{ minAmount: 0, ratePercent: 10 }]);
  });

  it('0₮-ийн шатлалгүйгээр хадгалахгүй', () => {
    expect(() =>
      assertLeasingFeeTiers([{ minAmount: 500_000, ratePercent: 11 }]),
    ).toThrow(AppError);
  });

  it('хуучин захиалгын шимтгэлийг шинэ шатлалаар солихгүй', () => {
    expect(
      leasingFeeSnapshot({
        isLeasing: true,
        previousSubtotal: 100_000,
        previousFee: 10_000,
        nextSubtotal: 50_000,
        fallbackFee: 7_500,
      }),
    ).toBe(5_000);
  });
});

describe('Лизингийн төлөлт', () => {
  it('эхлээд шимтгэлийг нэхэмжилнэ', () => {
    const view = leasingView({
      isLeasing: true,
      leasingFee: 10_000,
      subtotal: 100_000,
      paidAmount: 0,
      refundedAmount: 0,
    });
    expect(view.nextPayKind).toBe('FEE');
    expect(view.nextPayAmount).toBe(10_000);
    expect(view.feePaid).toBe(false);
    expect(view.principalDue).toBe(100_000);
    expect(
      leasingFeeHold({
        isLeasing: true,
        leasingFee: 10_000,
        subtotal: 100_000,
        paidAmount: 0,
        refundedAmount: 0,
      }),
    ).toBe(true);
  });

  it('шимтгэл төлөгдсөний дараа үндсэн 100% үлдэнэ', () => {
    const view = leasingView({
      isLeasing: true,
      leasingFee: 10_000,
      subtotal: 100_000,
      paidAmount: 10_000,
      refundedAmount: 0,
      dueAmount: 100_000,
    });
    expect(view.feePaid).toBe(true);
    expect(
      leasingFeeHold({
        isLeasing: true,
        leasingFee: 10_000,
        subtotal: 100_000,
        paidAmount: 10_000,
        refundedAmount: 0,
        dueAmount: 100_000,
      }),
    ).toBe(false);
    expect(view.nextPayKind).toBe('PRINCIPAL');
    expect(view.nextPayAmount).toBe(100_000);
    expect(view.principalPaid).toBe(0);
  });

  it('бүгдийг төлсөн бол дараагийн төлөлтгүй', () => {
    const view = leasingView({
      isLeasing: true,
      leasingFee: 10_000,
      subtotal: 100_000,
      paidAmount: 110_000,
      refundedAmount: 0,
      dueAmount: 0,
    });
    expect(view.nextPayKind).toBe('NONE');
    expect(view.nextPayAmount).toBe(0);
    expect(view.principalPaid).toBe(100_000);
  });
});

describe('QPay нэхэмжлэлийн дүн', () => {
  it('шимтгэл төлөгдөөгүй бол 10% — бүтэн дүнг хүссэн ч 10% л гарна', () => {
    const view = leasingView({
      isLeasing: true,
      leasingFee: 100,
      subtotal: 1_000,
      paidAmount: 0,
      refundedAmount: 0,
    });
    expect(resolveInvoiceAmount(view).amount).toBe(100);
    expect(resolveInvoiceAmount(view, 1_100).amount).toBe(100);
    expect(resolveInvoiceAmount(view).kind).toBe('FEE');
  });

  it('үндсэн төлбөрийг хувааж нэхэмжилнэ', () => {
    const view = leasingView({
      isLeasing: true,
      leasingFee: 100,
      subtotal: 1_000,
      paidAmount: 100,
      refundedAmount: 0,
      dueAmount: 1_000,
    });
    expect(resolveInvoiceAmount(view).amount).toBe(0);
    expect(resolveInvoiceAmount(view, 250).amount).toBe(250);
  });

  it('энгийн захиалга дүнгүйгээр үлдэгдлийг нэхэмжилнэ', () => {
    const view = leasingView({
      isLeasing: false,
      subtotal: 1_000,
      paidAmount: 0,
      refundedAmount: 0,
    });
    expect(view.nextPayKind).toBe('BALANCE');
    expect(resolveInvoiceAmount(view).amount).toBe(1_000);
  });

  it('карго/агуулахын үлдэгдлийг дүнгүйгээр нэхэмжилнэ', () => {
    const view = leasingView({
      isLeasing: true,
      leasingFee: 100,
      subtotal: 1_000,
      paidAmount: 1_100,
      refundedAmount: 0,
      cargoFee: 50,
      dueAmount: 50,
    });
    expect(view.nextPayKind).toBe('BALANCE');
    expect(resolveInvoiceAmount(view).amount).toBe(50);
  });
});

describe('Лизинг захиалгын мөнгө бичих эрх', () => {
  it('дэлгүүрийн админ лизинг дээр бүртгэж чадахгүй', () => {
    expect(canWriteLeasingOrderMoney(true, 'ADMIN')).toBe(false);
    expect(canWriteLeasingOrderMoney(true, 'STAFF')).toBe(false);
  });

  it('лизингийн админ л лизинг дээр бүртгэнэ', () => {
    expect(canWriteLeasingOrderMoney(true, 'LEASING')).toBe(true);
  });

  it('QPay захиалга дээр дэлгүүрийн админ бүртгэж болно', () => {
    expect(canWriteLeasingOrderMoney(false, 'ADMIN')).toBe(true);
    expect(canWriteLeasingOrderMoney(false, 'STAFF')).toBe(true);
  });
});

describe('Лизинг бараа ирсэн эсэх', () => {
  it('ирсэн төлөөгүйг ялгана', () => {
    expect(leasingGoodsWhere('arrived_unpaid')).toEqual({
      status: { in: ['ARRIVED', 'HANDED_OVER'] },
      dueAmount: { gt: 0 },
    });
  });

  it('ирээгүйг статус биш ирэлтээр шүүнэ', () => {
    expect(leasingGoodsWhere('not_arrived').status).toEqual({
      in: ['NEW', 'CONFIRMED', 'IN_BATCH', 'IN_TRANSIT'],
    });
  });
});

describe('Лизинг үлдэгдэлтэй бараа авах', () => {
  it('шимтгэл л төлсөн бол хориглоно', () => {
    expect(
      leasingHoldsGoods({
        isLeasing: true,
        leasingFee: 10_000,
        subtotal: 100_000,
        paidAmount: 10_000,
        refundedAmount: 0,
      }),
    ).toBe(true);
  });

  it('үндсэн төлөгдсөн бол карго үлдсэн ч хориглохгүй', () => {
    expect(
      leasingHoldsGoods({
        isLeasing: true,
        leasingFee: 10_000,
        subtotal: 100_000,
        paidAmount: 110_000,
        refundedAmount: 0,
        cargoFee: 8_000,
        dueAmount: 8_000,
      }),
    ).toBe(false);
  });

  it('QPay захиалгыг хориглохгүй', () => {
    expect(
      leasingHoldsGoods({
        isLeasing: false,
        subtotal: 100_000,
        paidAmount: 0,
        refundedAmount: 0,
      }),
    ).toBe(false);
  });
});

describe('Лизингийн хуваарь', () => {
  it('үлдэгдлийг сүүлийн төлөлт дээр нэмнэ', () => {
    expect(splitEven(100_000, 3)).toEqual([33_333, 33_333, 33_334]);
    expect(splitEven(100_000, 2)).toEqual([50_000, 50_000]);
  });

  it('хоногийн зай 2–3, бусад нь өгөгдмөл', () => {
    expect(parseLeasingPayGaps([5, 8, 8])).toEqual([5, 8, 8]);
    expect(parseLeasingPayGaps([10, 11])).toEqual([10, 11]);
    expect(parseLeasingPayGaps([1])).toEqual([5, 8, 8]);
  });

  it('5+8+8 = 21 хоног, сүүлийн төлөлт бараа ирэх үе', () => {
    const start = new Date('2026-09-01T04:00:00.000Z');
    const plan = buildLeasingPayPlan({
      isLeasing: true,
      createdAt: start,
      subtotal: 100_000,
      leasingFee: 10_000,
      paidAmount: 0,
      refundedAmount: 0,
      payGaps: [5, 8, 8],
      now: start,
    });
    expect(plan?.totalDays).toBe(21);
    expect(plan?.steps.map((s) => s.amount)).toEqual([10_000, 33_333, 33_333, 33_334]);
    expect(plan?.steps[0]?.status).toBe('due_today');
    expect(plan?.steps[0]?.kind).toBe('FEE');
    expect(plan?.steps[3]?.isLast).toBe(true);
    expect(plan?.steps[3]?.daysFromStart).toBe(21);
    expect(plan?.nextAmount).toBe(10_000);
  });

  it('шимтгэл төлөгдсөн өдөр дараагийн хуваарь өнөөдөр', () => {
    const created = new Date('2026-09-01T04:00:00.000Z');
    const now = new Date('2026-09-06T04:00:00.000Z');
    const plan = buildLeasingPayPlan({
      isLeasing: true,
      createdAt: created,
      subtotal: 100_000,
      leasingFee: 10_000,
      paidAmount: 10_000,
      refundedAmount: 0,
      payGaps: [5, 8, 8],
      now,
    });
    expect(plan?.dueToday).toBe(true);
    expect(plan?.overdue).toBe(false);
    expect(plan?.steps[1]?.status).toBe('due_today');
    expect(plan?.nextAmount).toBe(33_333);
  });

  it('хуваарьт өдрөөс хоцорвол overdue', () => {
    const created = new Date('2026-09-01T04:00:00.000Z');
    const now = new Date('2026-09-07T04:00:00.000Z');
    const plan = buildLeasingPayPlan({
      isLeasing: true,
      createdAt: created,
      subtotal: 100_000,
      leasingFee: 10_000,
      paidAmount: 10_000,
      refundedAmount: 0,
      payGaps: [5, 8, 8],
      now,
    });
    expect(plan?.overdue).toBe(true);
    expect(plan?.dueToday).toBe(false);
    expect(plan?.steps[1]?.status).toBe('overdue');
  });

  it('QPay үндсэн төлбөрийг хуваарьт дүнгээр нэхэмжилнэ', () => {
    const view = leasingView({
      isLeasing: true,
      leasingFee: 100,
      subtotal: 1_000,
      paidAmount: 100,
      refundedAmount: 0,
      dueAmount: 1_000,
    });
    expect(resolveInvoiceAmount(view).amount).toBe(0);
    expect(resolveInvoiceAmount(view, null, 334).amount).toBe(334);
    expect(resolveInvoiceAmount(view, 250).amount).toBe(250);
    expect(resolveInvoiceAmount(view, 1_000).amount).toBe(1_000);
  });

  it('serialize дараагийн хуваарьт дүнгээр хязгаарлана', () => {
    const order = {
      isLeasing: true,
      createdAt: new Date('2026-09-01T04:00:00.000Z'),
      subtotal: 100_000,
      leasingFee: 10_000,
      paidAmount: 10_000,
      refundedAmount: 0,
      dueAmount: 100_000,
    };
    const data = serializeLeasing(order, [5, 8, 8]);
    expect(data.nextPayKind).toBe('PRINCIPAL');
    expect(data.nextPayAmount).toBe(33_333);
    expect(data.payPlan?.nextAmount).toBe(33_333);
  });
});
