import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/prisma.js';
import { signCustomerToken } from '../src/lib/jwt.js';
import { getSettings, invalidateSettingsCache } from '../src/services/settings.js';
import { seedAdmin, seedCatalog } from './helpers/seedAdmin.js';
import { startApp } from './helpers/httpApp.js';

// Only the bank transport is simulated; orders, balances, stock and permissions use real HTTP + Postgres.
const bank = vi.hoisted(() => ({ invoices: new Map<string, { amount: number; kind: string; paid: boolean }>() }));
vi.mock('../src/services/qpay.js', async (original) => {
  const actual = await original<typeof import('../src/services/qpay.js')>();
  return { ...actual,
    isQpayReady: () => true,
    createQpayInvoice: async (input: { amount: number }, kind = 'shop') => {
      const invoiceId = `flow-${randomUUID()}`;
      bank.invoices.set(invoiceId, { amount: input.amount, kind, paid: false });
      return { invoiceId, amount: input.amount, qrText: `test:${invoiceId}`, qrImage: null, shortUrl: 'https://example.test/pay',
        urls: [{ name: 'test-bank', description: 'Туршилтын банк', logo: null, link: 'testbank://pay' }] };
    },
    checkQpayInvoice: async (invoiceId: string, kind = 'shop') => {
      const invoice = bank.invoices.get(invoiceId);
      if (!invoice || invoice.kind !== kind) throw new Error('Wrong QPay account');
      return { paid: invoice.paid, paidAmount: invoice.paid ? invoice.amount : 0, paymentIds: invoice.paid ? [`payment-${invoiceId}`] : [] };
    },
    cancelQpayInvoice: async () => undefined,
  };
});

let server: Awaited<ReturnType<typeof startApp>>;
let priorOwner: string | null;
beforeAll(async () => { priorOwner = (await getSettings()).leasingSettlementAdminId; server = await startApp(); });
afterAll(async () => {
  await prisma.setting.update({ where: { id: 1 }, data: { leasingSettlementAdminId: priorOwner } });
  invalidateSettingsCache(); await server?.close();
});

type Session = { headers: Record<string, string> };
async function request<T = Record<string, unknown>>(session: Session, path: string, method = 'GET', body?: unknown, expected = 200): Promise<T> {
  const response = await fetch(server.url + '/api' + path, { method, headers: session.headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json() as { data: T; error?: unknown };
  expect(response.status, JSON.stringify(result)).toBe(expected);
  return result.data;
}
async function fixture(leasing: boolean, ready = false) {
  const catalog = await seedCatalog();
  const admin = await seedAdmin('ADMIN'); const operator = await seedAdmin('LEASING'); const other = await seedAdmin('LEASING');
  await prisma.setting.update({ where: { id: 1 }, data: { leasingSettlementAdminId: operator.admin.id } }); invalidateSettingsCache();
  await prisma.productRound.update({ where: { id: catalog.round.id }, data: { closeAt: ready ? null : new Date(Date.now() + 86_400_000), stock: ready ? 4 : 0, available: ready ? 4 : 0 } });
  const customer = { headers: { Authorization: 'Bearer ' + signCustomerToken({ sub: catalog.customer.id, email: catalog.customer.email, phone: catalog.customer.phone }), 'Content-Type': 'application/json' } };
  const created = await request<{ code: string }>(customer, '/orders', 'POST', { leasing, items: [{ productId: catalog.round.id, qty: 2 }] }, 201);
  const order = await prisma.order.findUniqueOrThrow({ where: { code: created.code }, include: { items: true } });
  return { ...catalog, admin, operator, other, customer, order };
}
async function customerPay(seed: Awaited<ReturnType<typeof fixture>>, body: unknown = {}) {
  const invoice = await request<{ invoiceId: string; amount: number }>(seed.customer, `/orders/${seed.order.code}/qpay/invoice`, 'POST', body, 201);
  bank.invoices.get(invoice.invoiceId)!.paid = true;
  await request(seed.customer, `/orders/${seed.order.code}/qpay/verify`, 'POST', {});
  return invoice;
}
async function arrival(seed: Awaited<ReturnType<typeof fixture>>, cargoFee = 0) {
  await prisma.productRound.update({ where: { id: seed.round.id }, data: { closeAt: new Date(Date.now() - 1000) } });
  await request(seed.admin, `/admin/rounds/${seed.round.id}`, 'PATCH', { status: 'CLOSED' });
  const batch = await request<{ id: string }>(seed.admin, '/admin/batches', 'POST', { name: `Flow ${seed.t}`, orderIds: [seed.order.id] }, 201);
  await request(seed.admin, `/admin/batches/${batch.id}/products`, 'POST', { roundId: seed.round.id }, 201);
  await request(seed.admin, `/admin/batches/${batch.id}/cargo-fees`, 'POST', { items: [{ roundId: seed.round.id, cargoFee }] });
  await request(seed.admin, `/admin/batches/${batch.id}/arrivals/preview`, 'POST', { lines: [{ roundId: seed.round.id, selections: {}, addQty: 2 }] });
  await request(seed.admin, `/admin/batches/${batch.id}/arrivals`, 'POST', { lines: [{ roundId: seed.round.id, selections: {}, arrivedQty: 2 }] });
  await request(seed.admin, `/admin/batches/${batch.id}/advance`, 'POST', {});
  return batch;
}

describe('худалдан авагч → дэлгүүр → лизинг → бараа авах бүтэн урсгал', () => {
  it('дансаар орсон бэлэн барааны төлбөрийг ADMIN бүртгээд бараа олгоход дэвтэр, нөөц давхардахгүй', async () => {
    const seed = await fixture(false, true);
    const before = await prisma.productRound.findUniqueOrThrow({ where: { id: seed.round.id } });
    const body = { amount: 40_000, method: 'BANK_TRANSFER', reference: `BANK-FLOW-${randomUUID()}`, payeeKind: 'SHOP' };
    await request(seed.admin, `/admin/orders/${seed.order.id}/payments`, 'POST', body, 201);
    await request(seed.admin, `/admin/orders/${seed.order.id}/payments`, 'POST', body, 200);
    await request(seed.admin, `/admin/orders/${seed.order.id}/status`, 'PATCH', { status: 'CONFIRMED' });
    await request(seed.customer, `/orders/${seed.order.code}/fulfilment`, 'POST', { type: 'PICKUP', itemIds: seed.order.items.map((item) => item.id) });
    const payload = { items: [{ itemId: seed.order.items[0]!.id, qty: 2, expectedHandedQty: 0 }], idempotencyKey: randomUUID() };
    await request(seed.admin, '/admin/handover/partial', 'POST', payload);
    await request(seed.admin, '/admin/handover/partial', 'POST', payload);
    await request(seed.admin, `/admin/orders/${seed.order.id}/payments`, 'POST', body, 200);
    const final = await request<{ status: string; paidAmount: number; dueAmount: number }>(seed.customer, `/orders/${seed.order.code}`);
    expect(final).toMatchObject({ status: 'HANDED_OVER', paidAmount: 40_000, dueAmount: 0 });
    expect(await prisma.payment.count({ where: { orderId: seed.order.id } })).toBe(1);
    const after = await prisma.productRound.findUniqueOrThrow({ where: { id: seed.round.id } });
    expect(after.stock).toBe(before.stock - 2); expect(after.reserved).toBe(0);
  });
  it('лизингийн QPay, Итгэлд хэсэгчилсэн QPay + дансны баталгаа, карго, хэсэгчилсэн олголт', async () => {
    const seed = await fixture(true);
    const options = await request<{ qpayReady: boolean; manualBankAllowed: boolean }>(seed.operator, '/leasing/finance/itgel/payment-options');
    expect(options.qpayReady).toBe(true); expect(options.manualBankAllowed).toBe(false);
    const owner = await seedAdmin('OWNER');
    const ownerOptions = await request<{ manualBankAllowed: boolean }>(owner, '/leasing/finance/itgel/payment-options');
    expect(ownerOptions.manualBankAllowed).toBe(false);
    await request(owner, '/leasing/finance/itgel/pay', 'POST', { method: 'BANK_TRANSFER', settlementIds: ['test-not-created'], bankRef: 'test', bankDate: '2026-10-12' }, 403);
    await request(seed.customer, `/orders/${seed.order.code}/payment-claim`, 'POST', {}, 409);
    await request(seed.operator, '/admin/orders', 'GET', undefined, 403);
    await request(seed.admin, '/leasing/orders', 'GET', undefined, 403);
    await customerPay(seed); // Fee confirms the order and creates the Itgel debt.
    let settlement = await prisma.itgelSettlement.findUniqueOrThrow({ where: { sourceOrderItemId: seed.order.items[0]!.id } });
    expect(settlement.amount).toBe(40_000); expect(settlement.ownerAdminId).toBe(seed.operator.admin.id);
    await request(seed.other, `/leasing/orders/${seed.order.id}`, 'GET', undefined, 404);
    await request(seed.admin, `/admin/orders/${seed.order.id}/payments`, 'POST', { amount: 100, method: 'CASH' }, 403);
    await request(seed.other, '/leasing/finance/itgel/pay', 'POST', { method: 'QPAY', settlementIds: [settlement.id] }, 409);
    const partial = await request<{ payment: { id: string }; invoice: { invoiceId: string; urls: unknown[] } }>(seed.operator, '/leasing/finance/itgel/pay', 'POST', { method: 'QPAY', settlementIds: [settlement.id], amount: 7_000 }, 201);
    expect(partial.invoice.urls.length).toBe(1);
    const resumed = await request<{ invoice: { invoiceId: string } }>(seed.operator, `/leasing/finance/itgel/payments/${partial.payment.id}/resume`, 'POST', {});
    expect(resumed.invoice.invoiceId).toBe(partial.invoice.invoiceId);
    bank.invoices.get(partial.invoice.invoiceId)!.paid = true;
    await request(seed.operator, `/leasing/finance/itgel/payments/${partial.payment.id}/verify`, 'POST', {});
    await request(seed.operator, `/leasing/finance/itgel/payments/${partial.payment.id}/verify`, 'POST', {});
    settlement = await prisma.itgelSettlement.findUniqueOrThrow({ where: { id: settlement.id } });
    expect(settlement.paidAmount).toBe(7_000); expect(settlement.remainingAmount).toBe(33_000);
    await request(seed.operator, '/leasing/finance/itgel/pay', 'POST', { method: 'BANK_TRANSFER', settlementIds: [settlement.id], bankRef: 'invalid-date', bankDate: 'not-a-date' }, 403);
    await request(seed.admin, '/admin/leasing-settlements/bank-payment', 'POST', { ownerAdminId: seed.operator.admin.id, settlementIds: [settlement.id], bankRef: 'invalid-date', bankDate: 'not-a-date' }, 400);
    await request(seed.operator, '/leasing/finance/itgel/pay', 'POST', { method: 'BANK_TRANSFER', settlementIds: [settlement.id], bankRef: 'flow-ref', bankDate: '2026-10-12' }, 403);
    const claim = await request<{ payment: { id: string } }>(seed.admin, '/admin/leasing-settlements/bank-payment', 'POST', { ownerAdminId: seed.operator.admin.id, settlementIds: [settlement.id], bankRef: randomUUID(), bankDate: '2026-10-12' }, 201);
    expect((await prisma.itgelSettlement.findUniqueOrThrow({ where: { id: settlement.id } })).remainingAmount).toBe(33_000);
    await request(owner, '/admin/leasing-settlements/bank-payment', 'POST', { ownerAdminId: seed.operator.admin.id, settlementIds: [settlement.id], bankRef: randomUUID(), bankDate: '2026-10-12' }, 403);
    await request(owner, `/admin/leasing-settlements/payments/${claim.payment.id}/confirm`, 'POST', {}, 403);
    await request(seed.operator, `/admin/leasing-settlements/payments/${claim.payment.id}/confirm`, 'POST', {}, 403);
    await request(seed.admin, `/admin/leasing-settlements/payments/${claim.payment.id}/confirm`, 'POST', {});
    await request(seed.admin, `/admin/leasing-settlements/payments/${claim.payment.id}/confirm`, 'POST', {});
    expect((await prisma.itgelSettlement.findUniqueOrThrow({ where: { id: settlement.id } })).remainingAmount).toBe(0);
    await customerPay(seed, { amount: 20_000 });
    await customerPay(seed, { amount: 20_000 });
    await arrival(seed, 1_000);
    await customerPay(seed, { purpose: 'CARGO' });
    const ledger = await request<{ maxRefundable: number }>(seed.operator, `/leasing/orders/${seed.order.id}/payments`);
    expect(ledger.maxRefundable).toBe(40_000 + seed.order.leasingFee);
    await request(seed.operator, `/leasing/orders/${seed.order.id}/payments/refunds`, 'POST', { amount: 41_000 + seed.order.leasingFee, method: 'BANK_TRANSFER' }, 409);
    await request(seed.customer, `/orders/${seed.order.code}/fulfilment`, 'POST', { type: 'PICKUP', itemIds: seed.order.items.map((item) => item.id) });
    for (let count = 0; count < 2; count++) {
      const payload = { items: [{ itemId: seed.order.items[0]!.id, qty: 1, expectedHandedQty: count }], idempotencyKey: randomUUID() };
      await request(seed.admin, '/admin/handover/partial', 'POST', payload);
      await request(seed.admin, '/admin/handover/partial', 'POST', payload);
    }
    const final = await request<{ status: string; dueAmount: number }>(seed.customer, `/orders/${seed.order.code}`);
    expect(final.status).toBe('HANDED_OVER'); expect(final.dueAmount).toBe(0);
    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: seed.order.items[0]!.id } })).handedOverQty).toBe(2);
    const pays = await prisma.payment.findMany({ where: { orderId: seed.order.id } });
    expect(pays.filter((payment) => payment.payeeKind === 'SHOP').reduce((sum, payment) => sum + payment.amount, 0)).toBe(2_000);
    expect(pays.filter((payment) => payment.payeeKind === 'LEASING').reduce((sum, payment) => sum + payment.amount, 0)).toBe(40_000 + seed.order.leasingFee);
  }, 30_000);

  it('бэлэн бараа → хэрэглэгчийн QPay → хүргэлт → давтан батлахад орлого, ширхэг давхардахгүй', async () => {
    const seed = await fixture(false, true);
    const restrictedOwner = await seedAdmin('OWNER');
    await request(restrictedOwner, `/admin/orders/${seed.order.id}/payments`, 'POST', { amount: 40_000, method: 'BANK_TRANSFER', reference: randomUUID() }, 403);
    await customerPay(seed);
    await request(seed.customer, `/orders/${seed.order.code}/qpay/verify`, 'POST', {});
    await request(seed.admin, `/admin/orders/${seed.order.id}/status`, 'PATCH', { status: 'CONFIRMED' });
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: seed.order.id } }); expect(fresh.status).toBe('ARRIVED');
    await request(seed.customer, `/orders/${seed.order.code}/fulfilment`, 'POST', { type: 'DELIVERY', district: 'Баянгол', khoroo: '1', address: 'Туршилтын байр 101', itemIds: seed.order.items.map((item) => item.id) });
    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { orderId: seed.order.id } });
    await request(seed.admin, `/admin/deliveries/${delivery.id}`, 'PATCH', { status: 'ASSIGNED', courierName: 'Туршилтын хүргэлт' });
    await request(seed.admin, `/admin/deliveries/${delivery.id}`, 'PATCH', { status: 'DELIVERED' });
    await request(seed.admin, `/admin/deliveries/${delivery.id}`, 'PATCH', { status: 'DELIVERED' });
    const final = await request<{ status: string; paidAmount: number; dueAmount: number }>(seed.customer, `/orders/${seed.order.code}`);
    expect(final.status).toBe('HANDED_OVER'); expect(final.paidAmount).toBe(40_000); expect(final.dueAmount).toBe(0);
    expect(await prisma.payment.count({ where: { orderId: seed.order.id, kind: 'PAYMENT' } })).toBe(1);
    const round = await prisma.productRound.findUniqueOrThrow({ where: { id: seed.round.id } }); expect(round.stock).toBe(2); expect(round.reserved).toBe(0);
  }, 30_000);

  it('лизингийн барааг бэлэн худалдаанд шилжүүлэхэд хэрэглэгчийн төлбөр ба Итгэлд төлөх өрийг хадгална', async () => {
    const seed = await fixture(true); await customerPay(seed); await arrival(seed);
    const payload = { reason: 'Хэрэглэгч авахгүй болсон — тест', lines: [{ orderItemId: seed.order.items[0]!.id, qty: 2, resaleUnitPrice: 25_000 }] };
    await request(seed.operator, `/leasing/orders/${seed.order.id}/ready-transfer/preview`, 'POST', payload);
    const transferred = await request<{ destRoundIds: string[] }>(seed.operator, `/leasing/orders/${seed.order.id}/ready-transfer`, 'POST', payload, 201);
    expect(transferred.destRoundIds).toHaveLength(1);
    const original = await prisma.order.findUniqueOrThrow({ where: { id: seed.order.id } });
    expect(original.debtClosedAt).not.toBeNull(); expect(original.paidAmount).toBe(seed.order.leasingFee);
    expect((await prisma.itgelSettlement.findUniqueOrThrow({ where: { sourceOrderItemId: seed.order.items[0]!.id } })).remainingAmount).toBe(40_000);
    const round = await prisma.productRound.findUniqueOrThrow({ where: { id: transferred.destRoundIds[0]! } });
    expect(round.ownerKind).toBe('LEASING'); expect(round.ownerAdminId).toBe(seed.operator.admin.id); expect(round.stock).toBe(2);
    const resale = await request<{ code: string }>(seed.customer, '/orders', 'POST', { items: [{ productId: round.id, qty: 2 }] }, 201);
    const resaleOrder = await prisma.order.findUniqueOrThrow({ where: { code: resale.code }, include: { items: true } });
    const resaleSeed = { ...seed, order: resaleOrder }; await customerPay(resaleSeed);
    await request(seed.operator, `/leasing/orders/${resaleOrder.id}/status`, 'PATCH', { status: 'CONFIRMED' });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: resaleOrder.id } })).paidAmount).toBe(50_000);
    await request(seed.customer, `/orders/${resale.code}/fulfilment`, 'POST', { type: 'PICKUP', itemIds: resaleOrder.items.map((item) => item.id) });
    await request(seed.admin, '/admin/handover/partial', 'POST', { items: [{ itemId: resaleOrder.items[0]!.id, qty: 2, expectedHandedQty: 0 }], idempotencyKey: randomUUID() });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: resaleOrder.id } })).status).toBe('HANDED_OVER');
  }, 30_000);
});
