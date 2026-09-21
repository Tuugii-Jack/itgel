import { describe, expect, it } from 'vitest';
import { leasingReadyMoney, leasingReadyOwnItems } from '../src/services/leasingReadyFinance.js';

const item = (
  ownerAdminId: string,
  unitPrice: number,
): {
  cancelledAt: Date | null;
  qty: number;
  unitPrice: number;
  round: { ownerKind: string | null; ownerAdminId: string | null; closeAt: Date | null };
} => ({
  cancelledAt: null,
  qty: 1,
  unitPrice,
  round: { ownerKind: 'LEASING', ownerAdminId, closeAt: null },
});

describe('бэлэн борлуулалтын эзэн шүүлт', () => {
  const items = [item('lease-a', 10_000), item('lease-b', 20_000)];

  it('OWNER ownerAdminId=undefined үед items хоосрохгүй', () => {
    expect(leasingReadyOwnItems(items, undefined)).toHaveLength(2);
    expect(leasingReadyOwnItems(items, 'lease-a')).toHaveLength(1);
  });

  it('холимог төлбөрийг эзэн бүрээр хувааж, OWNER бүтнээр харна', () => {
    const a = leasingReadyMoney({
      ownerAdminId: 'lease-a',
      items,
      paidAmount: 30_000,
      refundedAmount: 0,
      dueAmount: 0,
    });
    const b = leasingReadyMoney({
      ownerAdminId: 'lease-b',
      items,
      paidAmount: 30_000,
      refundedAmount: 0,
      dueAmount: 0,
    });
    const owner = leasingReadyMoney({
      items,
      paidAmount: 30_000,
      refundedAmount: 0,
      dueAmount: 0,
    });
    expect(a.ownItems).toHaveLength(1);
    expect(a.received).toBe(10_000);
    expect(b.received).toBe(20_000);
    expect(owner.ownItems).toHaveLength(2);
    expect(owner.received).toBe(30_000);
    expect(a.received + b.received).toBe(30_000);
  });
});
