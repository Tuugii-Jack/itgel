import { describe, expect, it } from 'vitest';
import {
  addReadySalesTotals,
  leasingReadyMoney,
  leasingReadyOwnItems,
  READY_SALES_TOTALS_BATCH,
  reduceOrderPages,
} from '../src/services/leasingReadyFinance.js';
import { leasingPayeeSums } from '../src/lib/money.js';

const item = (
  ownerAdminId: string,
  unitPrice: number,
  extra?: { cancelledAt?: Date | null; closeAt?: Date | null },
): {
  cancelledAt: Date | null;
  qty: number;
  unitPrice: number;
  round: { ownerKind: string | null; ownerAdminId: string | null; closeAt: Date | null };
} => ({
  cancelledAt: extra?.cancelledAt ?? null,
  qty: 1,
  unitPrice,
  round: { ownerKind: 'LEASING', ownerAdminId, closeAt: extra?.closeAt ?? null },
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
    expect(a.received + b.received + a.unallocatedPaid).toBe(30_000);
  });

  it('1₮ / буцаалт / илүү төлөлт: эзэд + хуваарилаагүй = нийт, илүүг нуухгүй', () => {
    const a = leasingReadyMoney({
      ownerAdminId: 'lease-a',
      items,
      paidAmount: 1,
      refundedAmount: 0,
      dueAmount: 29_999,
    });
    const b = leasingReadyMoney({
      ownerAdminId: 'lease-b',
      items,
      paidAmount: 1,
      refundedAmount: 0,
      dueAmount: 29_999,
    });
    expect(a.received + b.received + a.unallocatedPaid).toBe(1);
    expect(a.attributed).toBe(true);

    const overA = leasingReadyMoney({
      ownerAdminId: 'lease-a',
      items,
      paidAmount: 31_001,
      refundedAmount: 0,
      dueAmount: -1_001,
    });
    expect(overA.due).toBeLessThan(0);

    const refundA = leasingReadyMoney({
      ownerAdminId: 'lease-a',
      items,
      paidAmount: 30_000,
      refundedAmount: 1,
      dueAmount: 1,
    });
    const refundB = leasingReadyMoney({
      ownerAdminId: 'lease-b',
      items,
      paidAmount: 30_000,
      refundedAmount: 1,
      dueAmount: 1,
    });
    expect(refundA.refunded + refundB.refunded + refundA.unallocatedRefunded).toBe(1);
  });

  it('цуцлагдсан мөр болон SHOP карго төлбөрийг орлогод оруулахгүй', () => {
    const withCancelled = [
      item('lease-a', 10_000),
      item('lease-b', 20_000, { cancelledAt: new Date('2026-01-01') }),
    ];
    const a = leasingReadyMoney({
      ownerAdminId: 'lease-a',
      items: withCancelled,
      paidAmount: 1,
      refundedAmount: 0,
      dueAmount: 9_999,
    });
    expect(a.mixed).toBe(false);
    expect(a.received).toBe(1);

    const sums = leasingPayeeSums([
      { kind: 'PAYMENT', payeeKind: 'LEASING', amount: 30_000 },
      { kind: 'PAYMENT', payeeKind: 'SHOP', amount: 5_000 },
    ]);
    expect(sums.paid).toBe(30_000);
  });
});

describe('борлуулалтын нийт дүн тасалдалгүй', () => {
  it('5,001 захиалгыг багцалж бүгдийг тооцно', async () => {
    const total = 5_001;
    let served = 0;
    const fetchPage = async (cursor?: string) => {
      const start = cursor ? Number(cursor) + 1 : 0;
      const n = Math.min(READY_SALES_TOTALS_BATCH, total - start);
      if (n <= 0) return [];
      return Array.from({ length: n }, (_, i) => {
        served += 1;
        return {
          id: String(start + i),
          dueAmount: 0,
          items: [item('lease-a', 1)],
          payments: [{ kind: 'PAYMENT' as const, payeeKind: 'LEASING' as const, amount: 1 }],
        };
      });
    };
    const acc = {
      received: 0,
      refunded: 0,
      receivable: 0,
      unallocatedPaid: 0,
      unallocatedRefunded: 0,
    };
    await reduceOrderPages(fetchPage, acc, (totals, row) => {
      const sums = leasingPayeeSums(row.payments);
      addReadySalesTotals(
        totals,
        leasingReadyMoney({
          ownerAdminId: 'lease-a',
          items: row.items,
          paidAmount: sums.paid,
          refundedAmount: sums.refunded,
          dueAmount: row.dueAmount,
        }),
      );
    });
    expect(served).toBe(5_001);
    expect(acc.received).toBe(5_001);
  });
});
