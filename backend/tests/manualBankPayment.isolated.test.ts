import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/prisma.js';
import { seedAdmin, seedCatalog } from './helpers/seedAdmin.js';
import { startApp } from './helpers/httpApp.js';
import { signCustomerToken } from '../src/lib/jwt.js';

let server: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => { server = await startApp(); });
afterAll(async () => { await server.close(); });
async function fixture(leasing = false) {
  const catalog = await seedCatalog(); const admin = await seedAdmin('ADMIN'); const operator = await seedAdmin('LEASING');
  await prisma.productRound.update({ where: { id: catalog.round.id }, data: { closeAt: new Date(Date.now() + 86_400_000) } });
  const order = await prisma.order.create({ data: {
    code: `BM-${randomUUID().slice(0, 6).toUpperCase()}`, customerId: catalog.customer.id,
    subtotal: 20_000, dueAmount: leasing ? 25_000 : 20_000, leasingFee: leasing ? 2000 : 0, cargoFee: leasing ? 3000 : 0,
    isLeasing: leasing, payeeKind: leasing ? 'LEASING' : 'SHOP', leasingOperatorAdminId: leasing ? operator.admin.id : null,
    items: { create: { productId: catalog.product.id, roundId: catalog.round.id, nameSnapshot: catalog.product.name, qty: 1, unitPrice: 20_000, costPriceSnapshot: 10_000 } },
  } });
  return { ...catalog, admin, operator, order };
}
async function post(headers: Record<string, string>, orderId: string, body: unknown, portal = 'admin') {
  const response = await fetch(`${server.url}/api/${portal}/orders/${orderId}/payments`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as { data?: { payment: { id: string; method: string; payeeKind: string }; replayed: boolean }; error?: unknown } };
}
describe('ADMIN-only manual incoming bank payments', () => {
  it('records a partial bank receipt once, including concurrent and case-normalized replay', async () => {
    const f = await fixture(); const reference = `BANK-${randomUUID()}`;
    const body = { amount: 7000, method: 'BANK_TRANSFER', reference };
    const results = await Promise.all([post(f.admin.headers, f.order.id, body), post(f.admin.headers, f.order.id, { ...body, reference: reference.toLowerCase() })]);
    expect(results.map((row) => row.status).sort()).toEqual([200, 201]);
    expect(results[0]!.body.data!.payment.id).toBe(results[1]!.body.data!.payment.id);
    expect(await prisma.payment.count({ where: { orderId: f.order.id } })).toBe(1);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).toMatchObject({ paidAmount: 7000, dueAmount: 13_000, shopPaidAmount: 7000 });
    expect(results[0]!.body.data!.payment).toMatchObject({ method: 'BANK_TRANSFER', payeeKind: 'SHOP' });
    expect((await post(f.admin.headers, f.order.id, { ...body, amount: 7001 })).status).toBe(409);
  });
  it('rejects LEASING, OWNER, STAFF, CUSTOMER, anonymous and forged JWT role', async () => {
    const f = await fixture(true); const body = { amount: 1000, method: 'BANK_TRANSFER', reference: randomUUID(), payeeKind: 'LEASING' };
    // Make the leasing order visible to its operator, using a real ledger receipt.
    await prisma.order.update({ where: { id: f.order.id }, data: { status: 'CONFIRMED', paidAmount: 2000, dueAmount: 23_000 } });
    await prisma.payment.create({ data: { orderId: f.order.id, kind: 'PAYMENT', amount: 2000, method: 'QPAY', payeeKind: 'LEASING', actor: 'system' } });
    expect((await post(f.operator.headers, f.order.id, body, 'leasing')).status).toBe(403);
    for (const role of ['OWNER', 'STAFF'] as const) {
      const user = await seedAdmin(role); expect((await post(user.headers, f.order.id, body)).status).toBe(403);
    }
    const customer = signCustomerToken({ sub: f.customer.id, email: null, phone: f.customer.phone });
    expect((await post({ Authorization: `Bearer ${customer}`, 'Content-Type': 'application/json' }, f.order.id, body)).status).toBe(401);
    expect((await post({ 'Content-Type': 'application/json' }, f.order.id, body)).status).toBe(401);
    const staleAdmin = f.admin;
    await prisma.adminUser.update({ where: { id: staleAdmin.admin.id }, data: { role: 'LEASING' } });
    expect((await post(staleAdmin.headers, f.order.id, body)).status).toBe(403);
    expect(await prisma.payment.count({ where: { orderId: f.order.id, method: 'BANK_TRANSFER' } })).toBe(0);
  });
  it('requires a bank reference and rejects fake QPay/cash/card records and overpayment', async () => {
    const f = await fixture();
    expect((await post(f.admin.headers, f.order.id, { amount: 1000, method: 'BANK_TRANSFER' })).status).toBe(400);
    for (const method of ['QPAY', 'CASH', 'CARD', 'OTHER']) expect((await post(f.admin.headers, f.order.id, { amount: 1000, method, reference: randomUUID() })).status).toBe(403);
    expect((await post(f.admin.headers, f.order.id, { amount: 20_001, method: 'BANK_TRANSFER', reference: randomUUID() })).status).toBe(409);
    expect(await prisma.payment.count({ where: { orderId: f.order.id } })).toBe(0);
  });
  it('cannot spend one receipt twice across orders or overpay with concurrent different receipts', async () => {
    const f = await fixture(); const second = await fixture(); const ref = randomUUID();
    expect((await post(f.admin.headers, f.order.id, { amount: 5000, reference: ref })).status).toBe(201);
    expect((await post(f.admin.headers, second.order.id, { amount: 5000, reference: ref })).status).toBe(409);
    const race = await Promise.all([post(second.admin.headers, second.order.id, { amount: 20_000, reference: randomUUID() }), post(second.admin.headers, second.order.id, { amount: 20_000, reference: randomUUID() })]);
    expect(race.map((row) => row.status).sort()).toEqual([201, 409]);
    expect(await prisma.payment.count({ where: { orderId: second.order.id } })).toBe(1);
  });
  it('keeps leasing principal/fee and Itgel cargo money separate and confirms the paid leasing fee', async () => {
    const f = await fixture(true);
    expect((await post(f.admin.headers, f.order.id, { amount: 2000, reference: randomUUID() })).status).toBe(400);
    expect((await post(f.admin.headers, f.order.id, { amount: 2000, reference: randomUUID(), payeeKind: 'LEASING' })).status).toBe(201);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).toMatchObject({ status: 'CONFIRMED', paidAmount: 2000, shopPaidAmount: 0 });
    expect((await post(f.admin.headers, f.order.id, { amount: 20_001, reference: randomUUID(), payeeKind: 'LEASING' })).status).toBe(409);
    expect((await post(f.admin.headers, f.order.id, { amount: 3000, reference: randomUUID(), payeeKind: 'SHOP' })).status).toBe(201);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).toMatchObject({ paidAmount: 5000, shopPaidAmount: 3000, dueAmount: 20_000 });
  });
  it('does not add incoming money to cancelled or written-off orders', async () => {
    for (const closed of [false, true]) {
      const f = await fixture();
      await prisma.order.update({ where: { id: f.order.id }, data: closed ? { debtClosedAt: new Date(), writtenOffAmount: 20_000, dueAmount: 0 } : { status: 'CANCELLED' } });
      expect((await post(f.admin.headers, f.order.id, { amount: 1000, reference: randomUUID() })).status).toBe(409);
      expect(await prisma.payment.count({ where: { orderId: f.order.id } })).toBe(0);
    }
  });
  it('a bank receipt reserved for Itgel settlement cannot also credit a customer order', async () => {
    const f = await fixture(); const reference = `SETTLEMENT-${randomUUID()}`;
    await prisma.itgelSettlementPayment.create({ data: { ownerAdminId: f.operator.admin.id, method: 'BANK_TRANSFER', amount: 1000, bankRef: reference, bankDate: new Date(), claimedBy: `admin:${f.admin.admin.id}` } });
    expect((await post(f.admin.headers, f.order.id, { amount: 1000, reference })).status).toBe(409);
    expect(await prisma.payment.count({ where: { orderId: f.order.id } })).toBe(0);
  });
  it('manual payment options expose no other owners\' financial balances to leasing staff', async () => {
    const f = await fixture(true);
    await prisma.order.update({ where: { id: f.order.id }, data: { status: 'CONFIRMED', paidAmount: 2000, dueAmount: 23_000 } });
    await prisma.payment.create({ data: { orderId: f.order.id, amount: 2000, method: 'QPAY', kind: 'PAYMENT', payeeKind: 'LEASING', actor: 'system' } });
    const lease = await fetch(`${server.url}/api/leasing/orders/${f.order.id}/payments`, { headers: f.operator.headers });
    expect(lease.status).toBe(200);
    expect(await lease.json()).toMatchObject({ data: { manualPayment: { allowed: false, recipients: [] } } });
    const admin = await fetch(`${server.url}/api/admin/orders/${f.order.id}/payments`, { headers: f.admin.headers });
    expect(admin.status).toBe(200);
    expect(await admin.json()).toMatchObject({ data: { manualPayment: { allowed: true, recipients: [{ payeeKind: 'LEASING', dueAmount: 20_000 }, { payeeKind: 'SHOP', dueAmount: 3000 }] } } });
  });
  it('an existing QPay payment reference cannot be relabeled as a bank receipt', async () => {
    const f = await fixture(); const reference = `QPAY-${randomUUID()}`;
    await prisma.payment.create({ data: { orderId: f.order.id, kind: 'PAYMENT', amount: 1000, method: 'QPAY', payeeKind: 'SHOP', reference, actor: 'system' } });
    expect((await post(f.admin.headers, f.order.id, { amount: 1000, reference })).status).toBe(409);
    expect(await prisma.payment.count({ where: { orderId: f.order.id } })).toBe(1);
  });
  it('QPay settlement references cannot become manual bank income in either ledger', async () => {
    const f = await fixture(); const invoice = `INVOICE-${randomUUID()}`; const sender = `SENDER-${randomUUID()}`;
    await prisma.itgelSettlementPayment.create({ data: { ownerAdminId: f.operator.admin.id, method: 'QPAY', amount: 1000, status: 'CONFIRMED', qpayInvoiceId: invoice, senderInvoiceNo: sender, claimedBy: 'system' } });
    for (const reference of [invoice.toLowerCase(), sender.toLowerCase()]) {
      expect((await post(f.admin.headers, f.order.id, { amount: 1000, reference })).status).toBe(409);
      const response = await fetch(`${server.url}/api/admin/leasing-settlements/bank-payment`, { method: 'POST', headers: f.admin.headers, body: JSON.stringify({ ownerAdminId: f.operator.admin.id, settlementIds: ['no-such-settlement'], amount: 1000, bankRef: reference, bankDate: '2026-10-13' }) });
      expect(response.status).toBe(409);
    }
    expect(await prisma.payment.count({ where: { orderId: f.order.id } })).toBe(0);
    expect(await prisma.itgelSettlementPayment.count({ where: { ownerAdminId: f.operator.admin.id } })).toBe(1);
  });
});
