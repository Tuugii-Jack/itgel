import { describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import {
  assertCanWriteScopedLeasingMoney,
  leasingCatalogProductWhere,
  leasingResaleMoneyShare,
  leasingVisibleOrderWhere,
  resolveLeasingCatalogOwnerId,
  scopedLeasingListMoney,
  settlementOwnerFilter,
} from '../src/lib/leasingAccess.js';

const mixedItems = [
  {
    cancelledAt: null,
    qty: 1,
    unitPrice: 10_000,
    costPriceSnapshot: 4_000,
    round: { ownerKind: 'LEASING' as const, ownerAdminId: 'lease-a' },
  },
  {
    cancelledAt: null,
    qty: 1,
    unitPrice: 20_000,
    costPriceSnapshot: 8_000,
    round: { ownerKind: 'LEASING' as const, ownerAdminId: 'lease-b' },
  },
];

describe('лизингийн админы тусгаарлалт', () => {
  it('LEASING зөвхөн өөрийн оператор/тойрог', () => {
    const where = leasingVisibleOrderWhere({ sub: 'lease-a', role: 'LEASING' });
    expect(JSON.stringify(where)).toContain('lease-a');
    expect(JSON.stringify(where)).not.toContain('lease-b');
  });

  it('хуучин холимог захиалгыг some-оор харна — every биш', () => {
    const json = JSON.stringify(leasingVisibleOrderWhere({ sub: 'lease-a', role: 'LEASING' }));
    expect(json).toContain('"some"');
    expect(json).not.toContain('"every"');
  });

  it('OWNER бүх лизингийн захиалга харж болно', () => {
    const where = leasingVisibleOrderWhere({ sub: 'owner-1', role: 'OWNER' });
    expect(where).toMatchObject({ OR: expect.any(Array) });
    expect(JSON.stringify(where)).not.toContain('owner-1');
  });

  it('OWNER барааны эзэмшигчээр шүүхгүй', () => {
    expect(leasingCatalogProductWhere({ sub: 'owner-1', role: 'OWNER' })).toEqual({
      ownerKind: 'LEASING',
      deletedAt: null,
    });
    expect(leasingCatalogProductWhere({ sub: 'lease-a', role: 'LEASING' })).toEqual({
      ownerKind: 'LEASING',
      ownerAdminId: 'lease-a',
      deletedAt: null,
    });
  });

  it('OWNER тооцоог бүгдийг харж, LEASING өөрийнхийг харж', () => {
    expect(settlementOwnerFilter({ sub: 'owner-1', role: 'OWNER' })).toBeUndefined();
    expect(settlementOwnerFilter({ sub: 'lease-a', role: 'LEASING' })).toBe('lease-a');
  });
});

describe('хуучин холимог эзэмшлийн мөнгө', () => {
  const order = { isLeasing: false, payeeKind: 'LEASING' as const };

  it('LEASING холимог захиалгын төлбөр/буцаалт бичихгүй', () => {
    expect(() =>
      assertCanWriteScopedLeasingMoney(order, mixedItems, { sub: 'lease-a', role: 'LEASING' }),
    ).toThrow(AppError);
    try {
      assertCanWriteScopedLeasingMoney(order, mixedItems, { sub: 'lease-a', role: 'LEASING' });
    } catch (error) {
      expect(error).toMatchObject({ status: 409 });
    }
  });

  it('OWNER холимог захиалгын мөнгийг бичиж болно', () => {
    expect(() =>
      assertCanWriteScopedLeasingMoney(order, mixedItems, { sub: 'owner-1', role: 'OWNER' }),
    ).not.toThrow();
  });

  it('А/Б тайланд 30,000₮-г хоёуланд нь бүтнээр өгөхгүй', () => {
    const a = leasingResaleMoneyShare({
      ownerAdminId: 'lease-a',
      items: mixedItems,
      paidAmount: 30_000,
      refundedAmount: 0,
      dueAmount: 0,
    });
    const b = leasingResaleMoneyShare({
      ownerAdminId: 'lease-b',
      items: mixedItems,
      paidAmount: 30_000,
      refundedAmount: 0,
      dueAmount: 0,
    });
    const owner = leasingResaleMoneyShare({
      items: mixedItems,
      paidAmount: 30_000,
      refundedAmount: 0,
      dueAmount: 0,
    });
    expect(a.paidAmount).toBe(10_000);
    expect(b.paidAmount).toBe(20_000);
    expect(owner.paidAmount).toBe(30_000);
    expect(a.paidAmount + b.paidAmount).toBe(30_000);
  });

  it('LEASING жагсаалтад зөвхөн өөрийн мөр/дүнг харуулна, DB дүнг солихгүй', () => {
    const scoped = scopedLeasingListMoney(
      { sub: 'lease-a', role: 'LEASING' },
      order,
      mixedItems,
      {
        subtotal: 30_000,
        paidAmount: 30_000,
        refundedAmount: 0,
        dueAmount: 0,
        itemCount: 2,
        profit: 18_000,
      },
    );
    expect(scoped.mixedOwnership).toBe(true);
    expect(scoped.subtotal).toBe(10_000);
    expect(scoped.paidAmount).toBe(10_000);
    expect(scoped.itemCount).toBe(1);
    expect(scoped.profit).toBe(6_000);
  });
});

describe('барааны эзэн сонголт', () => {
  it('OWNER эзэн сонгоогүй бол 400', () => {
    try {
      resolveLeasingCatalogOwnerId({ sub: 'owner-1', role: 'OWNER' }, undefined, null);
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toMatchObject({ status: 400 });
    }
  });

  it('OWNER идэвхтэй LEASING-ийг эзэн болгоно', () => {
    expect(
      resolveLeasingCatalogOwnerId(
        { sub: 'owner-1', role: 'OWNER' },
        'lease-a',
        { role: 'LEASING', isActive: true },
      ),
    ).toBe('lease-a');
  });

  it('OWNER идэвхгүй/өөр дүрд 400', () => {
    try {
      resolveLeasingCatalogOwnerId(
        { sub: 'owner-1', role: 'OWNER' },
        'lease-a',
        { role: 'LEASING', isActive: false },
      );
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toMatchObject({ status: 400 });
    }
  });

  it('LEASING өөр эзэнд үүсгэхгүй', () => {
    try {
      resolveLeasingCatalogOwnerId(
        { sub: 'lease-a', role: 'LEASING' },
        'lease-b',
        { role: 'LEASING', isActive: true },
      );
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toMatchObject({ status: 403 });
    }
  });

  it('LEASING өөртөө үүсгэнэ', () => {
    expect(
      resolveLeasingCatalogOwnerId({ sub: 'lease-a', role: 'LEASING' }, undefined, null),
    ).toBe('lease-a');
  });
});
