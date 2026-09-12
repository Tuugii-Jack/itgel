import type { Request, Response, Router } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  order: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
  findOrderByQpayInvoice: vi.fn(), rememberQpayInvoice: vi.fn(),
  checkQpayInvoice: vi.fn(), applyQpayPayment: vi.fn(),
  cancelQpayInvoice: vi.fn(), createQpayInvoice: vi.fn(),
}));
vi.mock('../src/prisma.js', () => ({ prisma: mocks }));
vi.mock('../src/lib/audit.js', () => ({ audit: vi.fn(async () => {}) }));
vi.mock('../src/middleware/auth.js', () => ({ requireCustomer: vi.fn(), actorOf: () => 'admin:test' }));
vi.mock('../src/services/settings.js', () => ({ currentLeasingPayGaps: async () => [] }));
vi.mock('../src/lib/leasing.js', () => ({
  leasingView: () => ({}), buildLeasingPayPlan: () => null,
  resolveInvoiceAmount: () => ({ amount: 100000, kind: 'FULL' }),
}));
vi.mock('../src/services/qpay.js', () => ({
  ...mocks,
  isQpayReady: () => true,
  qpayAccountForOrder: (leasing: boolean) => leasing ? 'leasing' : 'shop',
}));
import { publicQpayRouter } from '../src/routes/public/qpay.js';
import { adminQpayRouter } from '../src/routes/admin/qpay.js';

function invoke(router: Router, method: string, path: string, body = {}) {
  const route = (router as any).stack.find((layer: any) =>
    layer.route?.path === path && layer.route.methods[method]).route;
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    let status = 200;
    const res = {
      status(n: number) { status = n; return this; },
      send(value: unknown) { resolve({ status, body: value }); },
      json(value: unknown) { resolve({ status, body: value }); },
    } as Response;
    const req = { body, query: {}, params: { code: 'TEST', invoiceId: 'old' },
      auth: { sub: 'customer', role: 'ADMIN' } } as unknown as Request;
    route.stack.at(-1).handle(req, res, reject);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.$transaction.mockImplementation(async (work) => work(mocks));
  mocks.findOrderByQpayInvoice.mockResolvedValue({ id: 'o1', qpayAccount: 'shop',
    qpayInvoiceId: 'new', isLeasing: false, dueAmount: 0 });
  mocks.checkQpayInvoice.mockResolvedValue({ paid: true, paidAmount: 100000, paymentIds: ['p1'] });
  mocks.applyQpayPayment.mockResolvedValue(true);
  mocks.rememberQpayInvoice.mockResolvedValue(undefined);
  mocks.order.findFirst.mockResolvedValue({ id: 'o1', code: 'TEST', status: 'NEW', customerId: 'customer',
    isLeasing: false, dueAmount: 100000, qpayInvoiceId: 'old' });
  mocks.createQpayInvoice.mockResolvedValue({ invoiceId: 'new', amount: 100000, urls: [] });
  mocks.order.findUniqueOrThrow.mockResolvedValue({ paidAmount: 100000, dueAmount: 0 });
});

describe('QPay callback and invoice lifecycle', () => {
  it('records a delayed old-invoice callback even if the order is already paid', async () => {
    const response = await invoke(publicQpayRouter, 'post', '/qpay/callback', { invoice_id: 'old' });
    expect(response).toEqual({ status: 200, body: 'SUCCESS' });
    expect(mocks.findOrderByQpayInvoice).toHaveBeenCalledWith('old');
    expect(mocks.applyQpayPayment).toHaveBeenCalledWith('o1', 'old', 100000, 'p1', 'system:qpay');
  });

  it('uses the historical invoice account after a payment-method switch', async () => {
    mocks.findOrderByQpayInvoice.mockResolvedValue({ id: 'o1', qpayAccount: 'shop', isLeasing: true });
    await invoke(publicQpayRouter, 'post', '/qpay/callback', { invoice_id: 'old' });
    expect(mocks.checkQpayInvoice).toHaveBeenCalledWith('old', 'shop');
    expect(mocks.applyQpayPayment).toHaveBeenCalledTimes(1);
  });

  it('does not acknowledge an invoice before its ownership is persisted', async () => {
    mocks.findOrderByQpayInvoice.mockResolvedValue(null);
    expect(await invoke(publicQpayRouter, 'post', '/qpay/callback', { invoice_id: 'new' }))
      .toEqual({ status: 503, body: 'RETRY' });
    expect(mocks.applyQpayPayment).not.toHaveBeenCalled();
  });

  it('returns a retryable response after a failed ledger write', async () => {
    const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.applyQpayPayment.mockRejectedValueOnce(new Error('temporary database failure'));
    expect((await invoke(publicQpayRouter, 'post', '/qpay/callback', { invoice_id: 'old' })).status).toBe(503);
    warning.mockRestore();
  });

  it('preserves old ownership and commits new ownership with the current pointer', async () => {
    const events: string[] = [];
    mocks.rememberQpayInvoice.mockImplementation(async (_order, id) => { events.push(`remember:${id}`); });
    mocks.cancelQpayInvoice.mockImplementation(async () => { events.push('cancel:old'); });
    mocks.order.update.mockImplementation(async () => { events.push('update:pointer'); });
    const response = await invoke(publicQpayRouter, 'post', '/:code/qpay/invoice');
    expect(response.status).toBe(201);
    expect(events).toEqual(['remember:old', 'cancel:old', 'remember:new', 'update:pointer']);
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does not clear the active new invoice when an admin cancels an old one', async () => {
    await invoke(adminQpayRouter, 'delete', '/invoices/:invoiceId');
    expect(mocks.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', qpayInvoiceId: 'old' },
      data: { qpayInvoiceId: null, qpayInvoiceAt: null },
    });
  });

  it('manual verification still reconciles payments when balance is zero', async () => {
    mocks.order.findFirst.mockResolvedValue({ id: 'o1', isLeasing: false, dueAmount: 0, qpayInvoiceId: 'old' });
    const response = await invoke(publicQpayRouter, 'post', '/:code/qpay/verify');
    expect(mocks.checkQpayInvoice).toHaveBeenCalledTimes(1);
    expect(mocks.applyQpayPayment).toHaveBeenCalledTimes(1);
    expect(response.body.data.paid).toBe(true);
  });
});
