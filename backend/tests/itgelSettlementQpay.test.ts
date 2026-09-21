import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, qpayTimeout } from '../src/lib/errors.js';

const state = vi.hoisted(() => ({
  payment: {
    id: 'pay-1',
    status: 'PENDING',
    method: 'QPAY',
    qpayInvoiceId: null as string | null,
    invoicePayload: null as unknown,
    senderInvoiceNo: 'ITGEL-pay-1',
    invoiceAttemptAt: null as Date | null,
    amount: 12_000,
    ownerAdminId: 'lease-a',
    confirmedAt: null as Date | null,
    confirmedAtSource: null as string | null,
    confirmedBy: null as string | null,
  },
  settlements: [
    {
      id: 's1',
      lockPaymentId: 'pay-1' as string | null,
      status: 'INVOICED',
      remainingAmount: 12_000,
      paidAmount: 0,
    },
  ],
  exceptions: [] as Record<string, unknown>[],
  createInvoice: vi.fn(async (..._args: unknown[]) => ({
    invoiceId: 'inv-1',
    qrText: 'qr:inv-1',
    qrImage: null,
    shortUrl: null,
    urls: [],
    amount: 12_000,
  })),
  listInvoices: vi.fn(async (..._args: unknown[]) => [] as { invoiceId: string; senderInvoiceNo: string | null; amount: number; status: string | null }[]),
  getInvoice: vi.fn(async (..._args: unknown[]) => ({
    invoiceId: 'inv-1',
    qrText: 'qr:inv-1',
    qrImage: null,
    shortUrl: null,
    urls: [],
    amount: 12_000,
  })),
  checkInvoice: vi.fn(async (..._args: unknown[]) => ({
    paid: false,
    paidAmount: 0,
    paymentIds: [] as string[],
  })),
  remember: vi.fn(async (..._args: unknown[]) => {}),
  audit: vi.fn(async (..._args: unknown[]) => {}),
}));

function paymentRow() {
  return { ...state.payment, lines: [{ settlementId: 's1', amount: state.payment.amount }] };
}

vi.mock('../src/prisma.js', () => {
  const client = {
    itgelSettlementPayment: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string } }) =>
        where.id === state.payment.id ? paymentRow() : null,
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id !== state.payment.id) throw new Error('not found');
        return paymentRow();
      }),
      findFirst: vi.fn(async ({ where }: { where: { qpayInvoiceId?: string; id?: string } }) => {
        if (where.qpayInvoiceId && state.payment.qpayInvoiceId === where.qpayInvoiceId) return paymentRow();
        if (where.id === state.payment.id) return paymentRow();
        return null;
      }),
      findMany: vi.fn(async ({
        where,
      }: {
        where: { status?: string; method?: string; qpayInvoiceId?: null; invoiceAttemptAt?: { not: null } };
      }) => {
        if (where.status && state.payment.status !== where.status) return [];
        if (where.method && state.payment.method !== where.method) return [];
        if ('qpayInvoiceId' in where && where.qpayInvoiceId === null && state.payment.qpayInvoiceId) return [];
        if (where.invoiceAttemptAt?.not === null && !state.payment.invoiceAttemptAt) return [];
        return [paymentRow()];
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.payment, data);
        return { ...state.payment };
      }),
      updateMany: vi.fn(async ({
        where,
        data,
      }: {
        where: { id: string; qpayInvoiceId?: null | string; status?: string | { in: string[] }; OR?: unknown };
        data: Record<string, unknown>;
      }) => {
        if (where.id !== state.payment.id) return { count: 0 };
        if (typeof where.status === 'string' && state.payment.status !== where.status) return { count: 0 };
        if (where.status && typeof where.status === 'object' && 'in' in where.status && !where.status.in.includes(state.payment.status)) {
          return { count: 0 };
        }
        if ('qpayInvoiceId' in where && where.qpayInvoiceId === null && state.payment.qpayInvoiceId) {
          return { count: 0 };
        }
        Object.assign(state.payment, data);
        return { count: 1 };
      }),
    },
    itgelSettlement: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        state.settlements.find((row) => row.id === where.id) ?? null,
      ),
      updateMany: vi.fn(async ({
        where,
        data,
      }: {
        where: {
          id?: string;
          lockPaymentId?: string;
          status?: { in: string[] };
          remainingAmount?: number;
        };
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const row of state.settlements) {
          if (where.id && row.id !== where.id) continue;
          if (where.lockPaymentId && row.lockPaymentId !== where.lockPaymentId) continue;
          if (where.status?.in && !where.status.in.includes(row.status)) continue;
          if (where.remainingAmount !== undefined && row.remainingAmount !== where.remainingAmount) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      }),
    },
    moneyException: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.exceptions.push(data);
        return data;
      }),
    },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(client),
  };
  return { prisma: client };
});
vi.mock('../src/lib/audit.js', () => ({
  audit: (...args: unknown[]) => state.audit(args[0], args[1]),
}));
vi.mock('../src/integrations/qpay/ledger.js', () => ({
  rememberQpayInvoice: (...args: unknown[]) => state.remember(args[0], args[1], args[2], args[3], args[4]),
}));
vi.mock('../src/services/qpay.js', () => ({
  createQpayInvoice: (...args: unknown[]) => state.createInvoice(...args),
  listQpayInvoices: (...args: unknown[]) => state.listInvoices(...args),
  getQpayInvoice: (...args: unknown[]) => state.getInvoice(...args),
  cancelQpayInvoice: vi.fn(),
  checkQpayInvoice: (...args: unknown[]) => state.checkInvoice(...args),
  isQpayReady: () => true,
}));

import {
  applySettlementQpayPayment,
  attachQpayInvoice,
  reconcileUncertainSettlementInvoice,
  verifySettlementInvoice,
} from '../src/services/itgelSettlementPay.js';

describe('attachQpayInvoice', () => {
  beforeEach(() => {
    state.payment.status = 'PENDING';
    state.payment.amount = 12_000;
    state.payment.qpayInvoiceId = null;
    state.payment.invoicePayload = null;
    state.payment.invoiceAttemptAt = null;
    state.payment.confirmedAt = null;
    state.payment.confirmedAtSource = null;
    state.exceptions = [];
    state.settlements[0] = {
      id: 's1',
      lockPaymentId: 'pay-1',
      status: 'INVOICED',
      remainingAmount: 12_000,
      paidAmount: 0,
    };
    state.createInvoice.mockReset();
    state.listInvoices.mockReset();
    state.listInvoices.mockResolvedValue([]);
    state.getInvoice.mockReset();
    state.checkInvoice.mockReset();
    state.checkInvoice.mockResolvedValue({ paid: false, paidAmount: 0, paymentIds: [] });
    state.remember.mockReset();
    state.audit.mockReset();
  });

  it('timeout үед өрийг түгжээгүй, давхар invoice үүсгэхгүй', async () => {
    state.createInvoice.mockRejectedValueOnce(qpayTimeout('QPay хариу өгсөнгүй. Нэхэмжлэл үүссэн байж болно.'));
    const result = await attachQpayInvoice('pay-1', 'admin:lease-a');
    expect(result.invoicePending).toBe(true);
    expect(result.invoice).toBeNull();
    expect(state.payment.status).toBe('PENDING');
    expect(state.payment.qpayInvoiceId).toBeNull();
    expect(state.settlements[0]!.status).toBe('INVOICED');
    expect(state.settlements[0]!.lockPaymentId).toBe('pay-1');
  });

  it('4xx үед түгжээг тайлж дахин төлүүлэх боломжтой болгоно', async () => {
    state.createInvoice.mockRejectedValueOnce(
      new AppError(409, 'CONFLICT', 'QPay алдаа', { qpayStatus: 400 }),
    );
    await expect(attachQpayInvoice('pay-1', 'admin:lease-a')).rejects.toMatchObject({ status: 409 });
    expect(state.payment.status).toBe('SUPERSEDED');
    expect(state.settlements[0]!.status).toBe('OPEN');
    expect(state.settlements[0]!.lockPaymentId).toBeNull();
  });

  it('хадгалсан invoice-ийг дахин үүсгэхгүй', async () => {
    state.payment.qpayInvoiceId = 'inv-keep';
    state.payment.invoicePayload = {
      invoiceId: 'inv-keep',
      qrText: 'qr:keep',
      amount: 12_000,
      urls: [],
    };
    const result = await attachQpayInvoice('pay-1', 'admin:lease-a');
    expect(result.invoice?.invoiceId).toBe('inv-keep');
    expect(state.createInvoice).not.toHaveBeenCalled();
    expect(state.getInvoice).not.toHaveBeenCalled();
    expect(state.listInvoices).not.toHaveBeenCalled();
  });

  it('хуучин INVOICED, payload байхгүй бол GET-ээр QR сэргээнэ, create хийхгүй', async () => {
    state.payment.qpayInvoiceId = 'inv-legacy';
    state.payment.invoicePayload = null;
    state.getInvoice.mockResolvedValueOnce({
      invoiceId: 'inv-legacy',
      qrText: 'qr:legacy',
      qrImage: null,
      shortUrl: null,
      urls: [],
      amount: 12_000,
    });
    const result = await attachQpayInvoice('pay-1', 'admin:lease-a');
    expect(state.createInvoice).not.toHaveBeenCalled();
    expect(state.getInvoice).toHaveBeenCalledWith('inv-legacy', 'shop', 12_000);
    expect(result.invoice?.qrText).toBe('qr:legacy');
    expect(result.resumed).toBe(true);
    expect(state.payment.qpayInvoiceId).toBe('inv-legacy');
  });

  it('timeout-ийн дараа create дахин явуулахгүй, list-ээр сэргээнэ', async () => {
    state.createInvoice.mockRejectedValueOnce(qpayTimeout('QPay хариу өгсөнгүй. Нэхэмжлэл үүссэн байж болно.'));
    await attachQpayInvoice('pay-1', 'admin:lease-a');
    expect(state.createInvoice).toHaveBeenCalledTimes(1);
    state.listInvoices.mockResolvedValueOnce([
      { invoiceId: 'inv-found', senderInvoiceNo: 'ITGEL-pay-1', amount: 12_000, status: 'OPEN' },
    ]);
    state.getInvoice.mockResolvedValueOnce({
      invoiceId: 'inv-found',
      qrText: 'qr:found',
      qrImage: null,
      shortUrl: null,
      urls: [],
      amount: 12_000,
    });
    const resumed = await attachQpayInvoice('pay-1', 'admin:lease-a');
    expect(state.createInvoice).toHaveBeenCalledTimes(1);
    expect(state.listInvoices).toHaveBeenCalled();
    expect(resumed.invoice?.invoiceId).toBe('inv-found');
    expect(resumed.invoicePending).toBe(false);
  });

  it('callback ирээгүй ч verify нь list/GET + payment/check-ээр нэг удаа бүртгэнэ', async () => {
    state.payment.invoiceAttemptAt = new Date();
    state.listInvoices.mockResolvedValue([
      { invoiceId: 'inv-paid', senderInvoiceNo: 'ITGEL-pay-1', amount: 12_000, status: 'OPEN' },
    ]);
    state.getInvoice.mockResolvedValue({
      invoiceId: 'inv-paid',
      qrText: 'qr:paid',
      qrImage: null,
      shortUrl: null,
      urls: [],
      amount: 12_000,
    });
    state.checkInvoice.mockResolvedValue({ paid: true, paidAmount: 12_000, paymentIds: ['qp-1'] });
    const first = await verifySettlementInvoice('pay-1', 'admin:lease-a');
    expect(state.createInvoice).not.toHaveBeenCalled();
    expect(first.status).toBe('CONFIRMED');
    expect(state.settlements[0]!.status).toBe('PAID');
    expect(state.settlements[0]!.remainingAmount).toBe(0);
    expect(state.settlements[0]!.paidAmount).toBe(12_000);
    const second = await verifySettlementInvoice('pay-1', 'admin:lease-a');
    expect(second.status).toBe('CONFIRMED');
    expect(state.settlements[0]!.paidAmount).toBe(12_000);
    expect(state.exceptions).toHaveLength(0);
  });

  it('sender lookup хоосон бол create дахин явуулахгүй, төлбөрийг амжилттай/цуцлагдсан гэж таахгүй', async () => {
    state.payment.invoiceAttemptAt = new Date();
    state.listInvoices.mockResolvedValue([]);
    const result = await attachQpayInvoice('pay-1', 'admin:lease-a');
    expect(state.createInvoice).not.toHaveBeenCalled();
    expect(result.invoicePending).toBe(true);
    expect(result.invoice).toBeNull();
    expect(state.payment.status).toBe('PENDING');
    expect(state.payment.qpayInvoiceId).toBeNull();
    expect(state.settlements[0]!.status).toBe('INVOICED');
    await expect(verifySettlementInvoice('pay-1', 'admin:lease-a')).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { code: 'QPAY_INVOICE_PENDING' },
    });
    expect(state.createInvoice).not.toHaveBeenCalled();
    expect(state.payment.status).toBe('PENDING');
  });

  it('шинэ invoice үүсгээгүй ч callback/verify/recon хоцорсон төлбөрийг нэг удаа бүртгэнэ', async () => {
    state.payment.amount = 10_000;
    state.payment.invoiceAttemptAt = new Date();
    state.settlements[0]!.remainingAmount = 35_000;
    state.listInvoices.mockResolvedValue([
      { invoiceId: 'inv-late', senderInvoiceNo: 'ITGEL-pay-1', amount: 10_000, status: 'OPEN' },
    ]);
    state.getInvoice.mockResolvedValue({
      invoiceId: 'inv-late',
      qrText: 'qr:late',
      qrImage: null,
      shortUrl: null,
      urls: [],
      amount: 10_000,
    });
    const linked = await reconcileUncertainSettlementInvoice('inv-late');
    expect(linked).toBe(true);
    expect(state.createInvoice).not.toHaveBeenCalled();
    expect(state.payment.qpayInvoiceId).toBe('inv-late');
    state.checkInvoice.mockResolvedValue({ paid: true, paidAmount: 10_000, paymentIds: ['qp-late'] });
    await verifySettlementInvoice('pay-1', 'admin:lease-a');
    expect(state.payment.status).toBe('CONFIRMED');
    expect(state.settlements[0]!.status).toBe('OPEN');
    expect(state.settlements[0]!.remainingAmount).toBe(25_000);
    expect(state.settlements[0]!.paidAmount).toBe(10_000);
    const second = await applySettlementQpayPayment('inv-late', 10_000, 'callback', 'qp-late');
    expect(second).toBe(false);
    expect(state.settlements[0]!.paidAmount).toBe(10_000);
  });

  it('PENDING-ийг SUPERSEDED болгосон ч хоцорсон QPay-ийг дуугүй хаахгүй', async () => {
    state.payment.status = 'SUPERSEDED';
    state.payment.qpayInvoiceId = 'inv-old';
    state.settlements[0]!.status = 'OPEN';
    state.settlements[0]!.lockPaymentId = null;
    const applied = await applySettlementQpayPayment('inv-old', 12_000, 'callback', 'qp-late');
    expect(applied).toBe(false);
    expect(state.settlements[0]!.remainingAmount).toBe(12_000);
    expect(state.settlements[0]!.paidAmount).toBe(0);
    expect(state.exceptions.some((row) => row.kind === 'SETTLEMENT_MISMATCH')).toBe(true);
  });
});
