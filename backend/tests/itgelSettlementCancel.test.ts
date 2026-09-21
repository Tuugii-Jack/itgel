import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/lib/errors.js';

type PaymentRow = {
  id: string;
  status: string;
  qpayInvoiceId: string | null;
  amount: number;
  ownerAdminId: string;
};

const state = vi.hoisted(() => ({
  payment: {
    id: 'pay-1',
    status: 'PENDING',
    qpayInvoiceId: 'inv-1',
    amount: 10_000,
    ownerAdminId: 'lease-a',
  } as PaymentRow,
  settlements: [{ id: 's1', lockPaymentId: 'pay-1', status: 'INVOICED', remainingAmount: 10_000 }],
  cancelInvoice: vi.fn(async (..._args: unknown[]) => {}),
  audit: vi.fn(async (..._args: unknown[]) => {}),
}));

vi.mock('../src/prisma.js', () => {
  let tail = Promise.resolve();
  const client: {
    itgelSettlementPayment: Record<string, unknown>;
    itgelSettlement: Record<string, unknown>;
    moneyException: Record<string, unknown>;
    $transaction: (work: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
  } = {
    itgelSettlementPayment: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        state.payment.id === where.id ? { ...state.payment, lines: [{ settlementId: 's1', amount: 10_000 }] } : null,
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (state.payment.id !== where.id) throw new Error('not found');
        return { ...state.payment, lines: [{ settlementId: 's1', amount: 10_000 }] };
      }),
      findFirst: vi.fn(async ({ where }: { where: { qpayInvoiceId?: string; id?: string } }) => {
        if (where.qpayInvoiceId && where.qpayInvoiceId !== state.payment.qpayInvoiceId) return null;
        if (where.id && where.id !== state.payment.id) return null;
        return { ...state.payment, lines: [{ settlementId: 's1', amount: 10_000 }] };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status?: string | { in?: string[] } }; data: { status: string } }) => {
        if (where.id !== state.payment.id) return { count: 0 };
        const allowed =
          typeof where.status === 'string'
            ? state.payment.status === where.status
            : where.status && 'in' in where.status
              ? where.status.in?.includes(state.payment.status)
              : !where.status;
        if (!allowed) return { count: 0 };
        Object.assign(state.payment, data);
        return { count: 1 };
      }),
    },
    itgelSettlement: {
      updateMany: vi.fn(async ({ where, data }: { where: { lockPaymentId: string; status?: { in?: string[] } }; data: Record<string, unknown> }) => {
        let count = 0;
        for (const row of state.settlements) {
          if (row.lockPaymentId !== where.lockPaymentId) continue;
          if (where.status && 'in' in where.status && !where.status.in?.includes(row.status)) continue;
          Object.assign(row, data);
          if ('lockPaymentId' in data) row.lockPaymentId = data.lockPaymentId as string;
          count += 1;
        }
        return { count };
      }),
    },
    moneyException: { create: vi.fn(async () => ({ id: 'ex-1' })) },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      const previous = tail;
      let release: (() => void) | undefined;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await work(client);
      } finally {
        release?.();
      }
    },
  };
  return { prisma: client };
});
vi.mock('../src/lib/audit.js', () => ({
  audit: (payload: unknown, tx?: unknown) => state.audit(payload, tx),
}));
vi.mock('../src/services/qpay.js', () => ({
  cancelQpayInvoice: (invoiceId: string, opts?: unknown) => state.cancelInvoice(invoiceId, opts),
  checkQpayInvoice: vi.fn(),
  createQpayInvoice: vi.fn(),
  isQpayReady: () => true,
}));

import { applySettlementQpayPayment, cancelOpenSettlementInvoice } from '../src/services/itgelSettlement.js';

describe('cancelOpenSettlementInvoice vs callback', () => {
  beforeEach(() => {
    state.payment.status = 'PENDING';
    state.payment.qpayInvoiceId = 'inv-1';
    state.settlements[0] = { id: 's1', lockPaymentId: 'pay-1', status: 'INVOICED', remainingAmount: 10_000 };
    state.cancelInvoice.mockReset();
    state.cancelInvoice.mockResolvedValue(undefined);
    state.audit.mockClear();
  });

  it('callback түрүүлбэл CONFIRMED-ийг SUPERSEDED болгохгүй', async () => {
    state.cancelInvoice.mockImplementation(async () => {
      state.payment.status = 'CONFIRMED';
    });
    await expect(cancelOpenSettlementInvoice('pay-1', 'admin:lease-a')).rejects.toMatchObject({
      status: 409,
    } satisfies Partial<AppError>);
    expect(state.payment.status).toBe('CONFIRMED');
    expect(state.settlements[0]!.status).toBe('INVOICED');
  });

  it('цуцлалт түрүүлбэл callback CONFIRMED болгохгүй', async () => {
    await cancelOpenSettlementInvoice('pay-1', 'admin:lease-a');
    expect(state.payment.status).toBe('SUPERSEDED');
    const recorded = await applySettlementQpayPayment('inv-1', 10_000, 'system:qpay');
    expect(recorded).toBe(false);
    expect(state.payment.status).toBe('SUPERSEDED');
  });

  it('зэрэг цуцлалт болон callback-ийн аль нь түрүүлсэн ч нэг төлөв үлдээнэ', async () => {
    const [cancelResult, applyResult] = await Promise.allSettled([
      cancelOpenSettlementInvoice('pay-1', 'admin:lease-a'),
      applySettlementQpayPayment('inv-1', 10_000, 'system:qpay'),
    ]);
    expect(['CONFIRMED', 'SUPERSEDED']).toContain(state.payment.status);
    if (state.payment.status === 'CONFIRMED') {
      expect(cancelResult.status).toBe('rejected');
      expect(applyResult).toMatchObject({ status: 'fulfilled', value: true });
      expect(state.settlements[0]!.status).toBe('PAID');
      expect(state.settlements[0]!.remainingAmount).toBe(0);
    } else {
      expect(applyResult).toMatchObject({ status: 'fulfilled', value: false });
      expect(state.settlements[0]!.status).toBe('OPEN');
      expect(state.settlements[0]!.lockPaymentId).toBeNull();
    }
  });
});
