/** Opt-in API sample check. Reads orders only; creates and removes one temporary QA login. */
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { prisma } from '../src/prisma.js';
import { signAdminToken } from '../src/lib/jwt.js';

if (process.env.ITGEL_PRODUCT_ORDERS_PROBE !== 'YES') throw new Error('Explicit QA opt-in is required.');
const tag = `PRODUCT-ORDERS-QA-${randomUUID()}`;
let adminId: string | null = null;
try {
  const admin = await prisma.adminUser.create({ data: { email: `${tag}@itgel.test`, name: tag, role: 'ADMIN', passwordHash: 'qa-no-password-login', phoneVerifiedAt: new Date() } });
  adminId = admin.id;
  const token = signAdminToken({ sub: admin.id, email: admin.email, role: admin.role, tv: admin.tokenVersion });
  const checks: { check: string; rows?: number; passed: boolean }[] = [];
  async function get<T>(path: string): Promise<T> {
    const response = await fetch('https://api.itgelshop.mn/api' + path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 200, 'Expected successful read of ' + path);
    return await response.json() as T;
  }
  type Row = { roundId: string; qty: number; byVariant: { qty: number }[] };
  for (const closed of ['closed', 'open', 'all']) {
    const result = await get<{ data: Row[]; meta: { total: number } }>(`/admin/orders/by-product?closed=${closed}&pageSize=4`);
    assert.ok(result.meta.total >= result.data.length);
    for (const row of result.data) assert.equal(row.byVariant.reduce((sum, variant) => sum + variant.qty, 0), row.qty);
    checks.push({ check: closed + '-list-and-variant-qty', rows: result.data.length, passed: true });
    if (closed !== 'all') continue;
    for (const row of result.data.slice(0, 2)) {
      const detail = await get<{ data: { summary: { qty: number; revenue: number; orderCount: number; byVariant: { qty: number }[] }; orders: { orderId: string; qty: number; total: number; cancelled: boolean }[] } }>(`/admin/rounds/${encodeURIComponent(row.roundId)}/orders`);
      const active = detail.data.orders.filter((buyer) => !buyer.cancelled);
      assert.equal(active.reduce((sum, buyer) => sum + buyer.qty, 0), detail.data.summary.qty);
      assert.equal(active.reduce((sum, buyer) => sum + buyer.total, 0), detail.data.summary.revenue);
      assert.equal(new Set(active.map((buyer) => buyer.orderId)).size, detail.data.summary.orderCount);
      assert.equal(detail.data.summary.byVariant.reduce((sum, variant) => sum + variant.qty, 0), detail.data.summary.qty);
      assert.equal(detail.data.summary.qty, row.qty, 'List/detail quantity must agree');
      checks.push({ check: 'buyer-detail-totals-and-distinct-orders', rows: detail.data.orders.length, passed: true });
    }
  }
  const dates = await get<{ data: { year: number; month: number; day: number }[] }>('/admin/orders/by-product/dates?closed=all');
  checks.push({ check: 'date-options', rows: dates.data.length, passed: true });
  const date = dates.data.find((value) => value.year >= 2020 && value.year <= 2100);
  if (date) {
    await get(`/admin/orders/by-product?closed=all&year=${date.year}&month=${date.month}&days=${date.day}&pageSize=4`);
    checks.push({ check: 'calendar-filter', passed: true });
  }
  console.log(JSON.stringify({ checks, orderWrites: 0, ledgerWrites: 0, realPayments: 0, sms: 0 }, null, 2));
} finally {
  if (adminId) await prisma.adminUser.deleteMany({ where: { id: adminId } });
  await prisma.$disconnect();
}
