import { describe, expect, it } from 'vitest';
import {
  SHOP_SALES_ORDER_WHERE,
  checkoutFlagsForGroup,
  isLeasingResale,
  leasingOwnedProductWhere,
  shopOwnedProductWhere,
  splitCheckoutGroups,
  splitItemsByPayee,
} from '../src/lib/inventoryOwner.js';

describe('Эзэмшил ба төлбөр хүлээн авагч', () => {
  it('холимог сагсыг эзэмшигчээр салгана', () => {
    const rounds = new Map([
      ['shop-round', { ownerKind: 'SHOP' }],
      ['lease-round', { ownerKind: 'LEASING' }],
    ]);
    const split = splitItemsByPayee(
      [
        { roundId: 'shop-round', name: 'A' },
        { roundId: 'lease-round', name: 'B' },
        { roundId: 'missing', name: 'C' },
      ],
      rounds,
    );
    expect(split.shop.map((i) => i.name)).toEqual(['A', 'C']);
    expect(split.leasing.map((i) => i.name)).toEqual(['B']);
  });

  it('хоёр LEASING эзний бэлэн барааг тусдаа захиалга болгоно', () => {
    const rounds = new Map([
      ['a', { ownerKind: 'LEASING', ownerAdminId: 'lease-a' }],
      ['b', { ownerKind: 'LEASING', ownerAdminId: 'lease-b' }],
      ['shop', { ownerKind: 'SHOP', ownerAdminId: null }],
    ]);
    const groups = splitCheckoutGroups(
      [
        { roundId: 'a', name: 'A-10k' },
        { roundId: 'b', name: 'B-20k' },
        { roundId: 'shop', name: 'Shop' },
      ],
      rounds,
    );
    expect(groups.map((g) => [g.ownerKind, g.ownerAdminId, g.items.map((i) => i.name)])).toEqual([
      ['SHOP', null, ['Shop']],
      ['LEASING', 'lease-a', ['A-10k']],
      ['LEASING', 'lease-b', ['B-20k']],
    ]);
  });

  it('холимог сагсанд дэлгүүрийн барааг л хуваарьт лизинг болгоно', () => {
    expect(checkoutFlagsForGroup('SHOP', true)).toEqual({
      isLeasing: true,
      payeeKind: 'LEASING',
    });
    expect(checkoutFlagsForGroup('SHOP', false)).toEqual({
      isLeasing: false,
      payeeKind: 'SHOP',
    });
  });

  it('лизингийн админ зөвхөн өөрийн барааг шүүнэ', () => {
    expect(leasingOwnedProductWhere('admin-1')).toEqual({
      ownerKind: 'LEASING',
      ownerAdminId: 'admin-1',
      deletedAt: null,
    });
    expect(shopOwnedProductWhere()).toEqual({ ownerKind: 'SHOP' });
  });

  it('бэлэн борлуулалтыг дэлгүүрийн тайлангаас хасна', () => {
    expect(SHOP_SALES_ORDER_WHERE).toEqual({
      deletedAt: null,
      NOT: { payeeKind: 'LEASING', isLeasing: false },
    });
    expect(isLeasingResale({ payeeKind: 'LEASING', isLeasing: false })).toBe(true);
    expect(isLeasingResale({ payeeKind: 'LEASING', isLeasing: true })).toBe(false);
  });
});
