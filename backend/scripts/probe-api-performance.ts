/** Read-only production API benchmark. Creates and removes one temporary verified owner; sends no SMS. */
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { prisma } from '../src/prisma.js';
import { signAdminToken } from '../src/lib/jwt.js';

if (process.env.ITGEL_PERFORMANCE_PROBE !== 'YES') throw new Error('Explicit QA opt-in is required.');
const api = process.env.ITGEL_PERFORMANCE_API ?? 'https://api.itgelshop.mn/api';
if (!['https://api.itgelshop.mn/api', 'http://127.0.0.1:4018/api'].includes(api)) throw new Error('Unexpected API host.');
const tag = `PERF-QA-${randomUUID()}`;
const probeAbort = new AbortController();
process.once('SIGINT', () => probeAbort.abort());
process.once('SIGTERM', () => probeAbort.abort());
let adminId: string | undefined;
const rows: { path: string; sample: number; ms: number; timing: string | null; bytes: number; status: number }[] = [];
try {
  const admin = await prisma.adminUser.create({ data: { email: `${tag}@itgel.test`, name: tag, passwordHash: 'qa-no-password-login', role: 'OWNER', phoneVerifiedAt: new Date() } });
  adminId = admin.id;
  const token = signAdminToken({ sub: admin.id, email: admin.email, role: admin.role, tv: admin.tokenVersion });
  const order = await prisma.order.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  const paths = [
    '/admin/auth/me', '/admin/products?pageSize=20', '/admin/orders?pageSize=20',
    '/admin/products?pageSize=100', '/admin/products?pageSize=30',
    '/admin/products?view=templates&pageSize=30',
    '/admin/orders?pageSize=100', '/admin/orders?pageSize=30',
    '/admin/customers?pageSize=20', '/admin/work/today',
    '/leasing/orders/summary', '/leasing/orders?goods=all&pageSize=20',
    '/leasing/orders?goods=all&pageSize=100', '/leasing/orders?goods=all&pageSize=30',
    '/leasing/customers?pageSize=20', '/leasing/work/today',
    '/leasing/finance/itgel/summary', '/leasing/finance/itgel/settlements?take=20',
    ...(order ? [`/admin/orders/${order.id}`, `/admin/orders/${order.id}/payments`, `/admin/orders/${order.id}/qpay`] : []),
  ];
  for (const sample of [1, 2, 3]) {
    for (const path of paths) {
      const started = performance.now();
      const response = await fetch(api + path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([AbortSignal.timeout(60_000), probeAbort.signal]) });
      const body = await response.text();
      const row = { path: path.replace(/\/[a-z0-9]{20,}/g, '/:id'), sample, ms: Math.round(performance.now() - started), timing: response.headers.get('server-timing'), bytes: Buffer.byteLength(body), status: response.status };
      rows.push(row);
      console.log(JSON.stringify(row));
      if (!response.ok) throw new Error(`Benchmark endpoint failed: ${row.path} ${row.status}`);
    }
  }
  if (process.env.ITGEL_PERFORMANCE_OUTPUT) await writeFile(process.env.ITGEL_PERFORMANCE_OUTPUT, JSON.stringify(rows, null, 2));
} finally {
  if (adminId) await prisma.adminUser.deleteMany({ where: { id: adminId } });
  await prisma.$disconnect();
}
