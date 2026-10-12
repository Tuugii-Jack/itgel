/** Explicitly authorized production probe: create unpaid QA invoices, verify, cancel and clean up only QA records. */
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/prisma.js';
import { signAdminToken, signCustomerToken } from '../src/lib/jwt.js';

if (process.env.ITGEL_QPAY_LIFECYCLE_PROBE !== 'YES') throw new Error('Explicit QA opt-in is required.');
const api = 'https://api.itgelshop.mn/api';
const tag = `QPAY-QA-${randomUUID()}`;
const ids = { admins: [] as string[], orders: [] as string[], products: [] as string[], rounds: [] as string[], invoices: [] as string[], settlementPayments: [] as string[], customer: '' };
const steps: { step: string; ok: boolean; bankLinks?: number; amount?: number }[] = [];
let paid = false;

async function request<T>(token: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(api + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
  const result = await response.json() as { data: T; error?: { code?: string; message?: string } };
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${result.error?.code ?? ''} ${result.error?.message ?? ''}`);
  return result.data;
}

async function main() {
  const category = await prisma.category.findFirst({ select: { id: true } });
  if (!category) throw new Error('No category for the hidden QA fixture.');
  for (const role of ['ADMIN', 'LEASING'] as const) {
    const admin = await prisma.adminUser.create({ data: { email: `${tag}-${role}@itgel.test`, name: `${tag} ${role}`, passwordHash: 'qa-no-password-login', role } });
    ids.admins.push(admin.id);
  }
  const [admin, operator] = await prisma.adminUser.findMany({ where: { id: { in: ids.admins } }, orderBy: { role: 'asc' } });
  if (!admin || !operator || admin.role !== 'ADMIN' || operator.role !== 'LEASING') throw new Error('QA roles missing.');
  const adminToken = signAdminToken({ sub: admin.id, email: admin.email, role: admin.role, tv: admin.tokenVersion });
  const operatorToken = signAdminToken({ sub: operator.id, email: operator.email, role: operator.role, tv: operator.tokenVersion });
  await request(adminToken, '/admin/auth/me');
  await request(operatorToken, '/leasing/finance/itgel/payment-options');
  const customer = await prisma.customer.create({ data: { name: tag } }); ids.customer = customer.id;
  const customerToken = signCustomerToken({ sub: customer.id, email: null, phone: null });
  const product = await prisma.product.create({ data: { categoryId: category.id, name: tag } }); ids.products.push(product.id);
  const round = await prisma.productRound.create({ data: { productId: product.id, roundNo: 1, costPrice: 500, sellPrice: 1000, status: 'HIDDEN', closeAt: new Date(Date.now() + 86_400_000) } }); ids.rounds.push(round.id);
  for (const leasing of [false, true]) {
    const order = await prisma.order.create({ data: {
      code: `PH-${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`, customerId: customer.id, status: 'NEW',
      isLeasing: leasing, payeeKind: leasing ? 'LEASING' : 'SHOP', leasingOperatorAdminId: leasing ? operator.id : null,
      subtotal: 1000, leasingFee: leasing ? 100 : 0, dueAmount: leasing ? 1100 : 1000, note: tag,
      items: { create: { productId: product.id, roundId: round.id, nameSnapshot: tag, qty: 1, unitPrice: 1000, costPriceSnapshot: 500 } },
    }, include: { items: true } }); ids.orders.push(order.id);
    const invoice = await request<{ invoiceId: string; amount: number; qrText: string; urls: unknown[] }>(customerToken, `/orders/${order.code}/qpay/invoice`, 'POST', {});
    ids.invoices.push(invoice.invoiceId);
    if (!invoice.qrText || !invoice.urls?.length || invoice.amount !== (leasing ? 100 : 1000)) throw new Error('Incomplete customer QR or wrong amount.');
    const status = await request<{ paidAmount: number }>(customerToken, `/orders/${order.code}/qpay/verify`, 'POST', {});
    if (status.paidAmount !== 0) { paid = true; throw new Error('QA invoice received money; preserve records for reconciliation.'); }
    await request(leasing ? operatorToken : adminToken, `/${leasing ? 'leasing' : 'admin'}/orders/${order.id}/qpay/invoice`, 'DELETE');
    steps.push({ step: leasing ? 'customer-leasing-qpay-create-verify-cancel' : 'customer-itgel-qpay-create-verify-cancel', ok: true, bankLinks: invoice.urls.length, amount: invoice.amount });
    if (leasing) {
      const item = order.items[0]!;
      const settlement = await prisma.itgelSettlement.create({ data: { sourceOrderId: order.id, sourceOrderItemId: item.id, sourceOrderCode: order.code,
        customerId: customer.id, customerName: tag, ownerAdminId: operator.id, productId: product.id, roundId: round.id, productName: tag,
        qty: 1, unitPrice: 1000, amount: 1000, remainingAmount: 1000, confirmedAt: new Date() } });
      const result = await request<{ payment: { id: string; amount: number }; invoice: { invoiceId: string; qrText: string; urls: unknown[] } }>(operatorToken, '/leasing/finance/itgel/pay', 'POST', { settlementIds: [settlement.id], method: 'QPAY' });
      ids.settlementPayments.push(result.payment.id); ids.invoices.push(result.invoice.invoiceId);
      if (!result.invoice.qrText || !result.invoice.urls.length || result.payment.amount !== 1000) throw new Error('Incomplete settlement QR.');
      const checked = await request<{ status: string }>(operatorToken, `/leasing/finance/itgel/payments/${result.payment.id}/verify`, 'POST', {});
      if (checked.status === 'CONFIRMED') { paid = true; throw new Error('QA settlement received money; preserve records.'); }
      await request(operatorToken, `/leasing/finance/itgel/payments/${result.payment.id}/cancel`, 'POST', {});
      steps.push({ step: 'leasing-admin-to-itgel-qpay-create-verify-cancel', ok: true, bankLinks: result.invoice.urls.length, amount: result.payment.amount });
    }
  }
}

async function cleanup() {
  const fixturePayments = await prisma.itgelSettlementPayment.findMany({ where: { ownerAdminId: { in: ids.admins } }, select: { id: true, status: true } });
  ids.settlementPayments = [...new Set([...ids.settlementPayments, ...fixturePayments.map((payment) => payment.id)])];
  const fixtureInvoices = await prisma.qpayInvoice.findMany({ where: { OR: [{ orderId: { in: ids.orders } }, { settlementPaymentId: { in: ids.settlementPayments } }] }, select: { id: true } });
  ids.invoices = [...new Set([...ids.invoices, ...fixtureInvoices.map((invoice) => invoice.id)])];
  if (fixturePayments.some((payment) => payment.status === 'CONFIRMED')) paid = true;
  if (await prisma.payment.count({ where: { orderId: { in: ids.orders } } })) paid = true;
  if (paid) {
    await prisma.adminUser.updateMany({ where: { id: { in: ids.admins } }, data: { isActive: false, tokenVersion: { increment: 1 } } });
    throw new Error('Real money detected: QA records preserved, temporary sessions revoked.');
  }
  // Retain failed/uncertain live invoices rather than deleting ownership metadata.
  const open = await prisma.itgelSettlementPayment.count({ where: { id: { in: ids.settlementPayments }, status: 'PENDING' } });
  const attached = await prisma.order.count({ where: { id: { in: ids.orders }, qpayInvoiceId: { not: null } } });
  if (open || attached) {
    await prisma.adminUser.updateMany({ where: { id: { in: ids.admins } }, data: { isActive: false, tokenVersion: { increment: 1 } } });
    throw new Error('Uncancelled QA invoice: preserve records and revoke temporary sessions.');
  }
  await prisma.$transaction(async (tx) => {
    await tx.qpayInvoice.deleteMany({ where: { id: { in: ids.invoices } } });
    await tx.itgelSettlementPayment.deleteMany({ where: { id: { in: ids.settlementPayments } } });
    await tx.itgelSettlement.deleteMany({ where: { sourceOrderId: { in: ids.orders } } });
    await tx.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...ids.orders, ...ids.settlementPayments] } }, { actor: { in: ids.admins.map((id) => `admin:${id}`) } }] } });
    await tx.order.deleteMany({ where: { id: { in: ids.orders } } });
    await tx.productRound.deleteMany({ where: { id: { in: ids.rounds } } });
    await tx.product.deleteMany({ where: { id: { in: ids.products } } });
    if (ids.customer) await tx.customer.deleteMany({ where: { id: ids.customer } });
    await tx.adminUser.deleteMany({ where: { id: { in: ids.admins } } });
  });
}

try {
  await main(); await cleanup();
  console.log(JSON.stringify({ steps, realPayments: 0, qaRecordsCleaned: true }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'QA probe failed');
  try { await cleanup(); } catch (cleanupError) { console.error(cleanupError instanceof Error ? cleanupError.message : 'QA cleanup failed'); }
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
