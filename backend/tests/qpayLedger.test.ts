import { beforeEach, describe, expect, it, vi } from 'vitest';

const { client } = vi.hoisted(() => ({ client: {} as Record<string, any> }));
vi.mock('../src/prisma.js', () => ({ prisma: client }));
vi.mock('../src/lib/audit.js', () => ({ audit: vi.fn(async () => {}) }));
vi.mock('../src/services/orders.js', () => ({ changeOrderStatus: vi.fn(async () => {}) }));
import { applyQpayPayment, findOrderByQpayInvoice, rememberQpayInvoice } from '../src/services/qpay.js';
import { recordPayment } from '../src/services/payments.js';

// In-memory database: transactions are concurrent until the actual service takes its row lock.
let order: Record<string, any>;
let payments: Record<string, any>[];
let invoices: Map<string, Record<string, any>>;
let tail: Promise<void>;

beforeEach(() => {
  order = { id: 'o1', code: 'TEST', status: 'NEW', isLeasing: false, subtotal: 100000,
    storageFee: 0, cargoFee: 0, leasingFee: 0, paidAmount: 0, refundedAmount: 0,
    dueAmount: 100000, deletedAt: null, qpayInvoiceId: 'i1' };
  payments = [];
  invoices = new Map();
  tail = Promise.resolve();
  const matches = (p: Record<string, any>, w: Record<string, any>) => Object.entries(w).every(([k,v]) =>
    v && typeof v === 'object' && 'in' in v ? v.in.includes(p[k]) : p[k] === v);
  Object.assign(client, {
    order: {
      findFirst: vi.fn(async ({ where }) => matches(order, where) ? { ...order } : null),
      findUnique: vi.fn(async () => ({ ...order })),
      update: vi.fn(async ({ data }) => Object.assign(order, data)),
    },
    orderItem: { findMany: vi.fn(async () => [{ qty: 1, unitPrice: order.subtotal }]) },
    payment: {
      create: vi.fn(async ({ data }) => {
        const payment = { id: String(payments.length + 1), createdAt: new Date(), ...data,
          qpayInvoiceId: data.qpayInvoiceId ?? null };
        payments.push(payment);
        return payment;
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        const found = payments.filter(p => matches(p, where));
        found.forEach(p => Object.assign(p, data));
        return { count: found.length };
      }),
      aggregate: vi.fn(async ({ where }) => ({ _sum: { amount: payments.filter(p => matches(p, where)).reduce((s,p) => s + p.amount, 0) } })),
      groupBy: vi.fn(async () => ['PAYMENT', 'REFUND'].map(kind => ({ kind,
        _sum: { amount: payments.filter(p => p.kind === kind).reduce((s,p) => s + p.amount, 0) } }))),
    },
    qpayInvoice: {
      upsert: vi.fn(async ({ where, create }) => {
        if (!invoices.has(where.id)) invoices.set(where.id, { ...create });
        return invoices.get(where.id);
      }),
      findUnique: vi.fn(async ({ where, include }) => {
        const invoice = invoices.get(where.id);
        return invoice ? { ...invoice, ...(include ? { order: { ...order } } : {}) } : null;
      }),
    },
    $transaction: async (work: (tx: any) => Promise<unknown>) => {
      let release: (() => void) | undefined;
      const tx = { ...client, $queryRaw: async () => {
        const previous = tail;
        tail = new Promise<void>(resolve => { release = resolve; });
        await previous;
        return [{ id: order.id }];
      } };
      try { return await work(tx); } finally { release?.(); }
    },
  });
});

describe('QPay ledger reconciliation', () => {
  it('records a simultaneous webhook and manual check only once', async () => {
    const results = await Promise.all([
      applyQpayPayment('o1', 'i1', 100000, 'p1'),
      applyQpayPayment('o1', 'i1', 100000, 'p1'),
    ]);
    expect(results.sort()).toEqual([false, true]);
    expect(payments).toHaveLength(1);
    expect(order.paidAmount).toBe(100000);
    expect(order.dueAmount).toBe(0);
  });

  it('records the actual payment in full when the balance has fallen', async () => {
    order.subtotal = 30000;
    order.dueAmount = 30000;
    await applyQpayPayment('o1', 'i1', 100000, 'p1');
    expect(order.paidAmount).toBe(100000);
    expect(order.dueAmount).toBe(-70000);
  });

  it('records an additional payment even when the balance is already zero', async () => {
    await recordPayment({ orderId: 'o1', kind: 'PAYMENT', amount: 100000, actor: 'admin' });
    await applyQpayPayment('o1', 'i1', 50000, 'p1');
    expect(order.paidAmount).toBe(150000);
    expect(order.dueAmount).toBe(-50000);
  });

  it('records only the increase of a cumulative check, regardless of first reference', async () => {
    await applyQpayPayment('o1', 'i1', 40000, 'p1');
    await applyQpayPayment('o1', 'i1', 100000, 'p1');
    await applyQpayPayment('o1', 'i1', 100000, 'p2');
    await applyQpayPayment('o1', 'i1', 100000);
    expect(payments.map(p => p.amount)).toEqual([40000, 60000]);
    expect(order.paidAmount).toBe(100000);
  });

  it('recognizes a legacy payment reference instead of charging it again', async () => {
    await recordPayment({ orderId: 'o1', kind: 'PAYMENT', amount: 100000,
      method: 'QPAY', reference: 'p1', actor: 'system:qpay' });
    expect(await applyQpayPayment('o1', 'i1', 100000, 'p1')).toBe(false);
    expect(payments).toHaveLength(1);
    expect(payments[0]!.qpayInvoiceId).toBe('i1');
  });

  it('does not restore a refunded payment when its old callback is retried', async () => {
    await applyQpayPayment('o1', 'i1', 100000, 'p1');
    await recordPayment({ orderId: 'o1', kind: 'REFUND', amount: 100000, actor: 'admin' });
    expect(await applyQpayPayment('o1', 'i1', 100000, 'p1')).toBe(false);
    expect(order.refundedAmount).toBe(100000);
    expect(order.dueAmount).toBe(100000);
  });

  it('retains historical invoice ownership after replacement and account changes', async () => {
    await rememberQpayInvoice('o1', 'i1', 'shop');
    await rememberQpayInvoice('o1', 'i2', 'leasing');
    order.qpayInvoiceId = 'i2';
    order.isLeasing = true;
    expect(await findOrderByQpayInvoice('i1')).toMatchObject({ id: 'o1', qpayAccount: 'shop' });
  });

  it('does not let another order take an existing invoice', async () => {
    await rememberQpayInvoice('o1', 'i1', 'shop');
    await expect(rememberQpayInvoice('other', 'i1', 'shop')).rejects.toMatchObject({ status: 409 });
    expect(invoices.get('i1')!.orderId).toBe('o1');
  });

  it('serializes different payment entries before recalculating the order', async () => {
    await Promise.all([40000, 60000].map(amount => recordPayment({
      orderId: 'o1', kind: 'PAYMENT', amount, actor: 'admin',
    })));
    expect(order.paidAmount).toBe(100000);
  });

  it('prevents concurrent refunds exceeding the received money', async () => {
    await recordPayment({ orderId: 'o1', kind: 'PAYMENT', amount: 100000, actor: 'admin' });
    const results = await Promise.allSettled([1, 2].map(() => recordPayment({
      orderId: 'o1', kind: 'REFUND', amount: 80000, actor: 'admin',
    })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(order.refundedAmount).toBe(80000);
  });
});
