/** Opt-in current-database authorization probe. No ledger write, invoice, SMS or real payment. */
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/prisma.js';
import { signAdminToken, signCustomerToken } from '../src/lib/jwt.js';

if (process.env.ITGEL_BANK_PERMISSION_PROBE !== 'YES') throw new Error('Explicit QA opt-in is required.');
const base = 'https://api.itgelshop.mn/api';
const tag = `BANK-PERM-QA-${randomUUID()}`; const ids: string[] = [];
async function request(token: string | null, path: string, method = 'GET', body?: unknown) {
  const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  return { status: response.status, body: await response.json() as { data?: { manualBankAllowed?: boolean }; error?: unknown } };
}
try {
  const tokens = new Map<string, string>();
  for (const role of ['ADMIN', 'LEASING', 'OWNER'] as const) {
    const admin = await prisma.adminUser.create({ data: { email: `${tag}-${role}@itgel.test`, name: tag, role, passwordHash: 'qa-no-password-login', phoneVerifiedAt: new Date() } });
    ids.push(admin.id); tokens.set(role, signAdminToken({ sub: admin.id, email: admin.email, role, tv: admin.tokenVersion }));
  }
  const checks: { check: string; status: number; passed: boolean }[] = [];
  for (const [role, path, allowed] of [
    ['ADMIN', '/admin/leasing-settlements/payment-options', true],
    ['OWNER', '/admin/leasing-settlements/payment-options', false],
    ['LEASING', '/leasing/finance/itgel/payment-options', false],
  ] as const) {
    const result = await request(tokens.get(role)!, path);
    checks.push({ check: `${role}-bank-options`, status: result.status, passed: result.status === 200 && result.body.data?.manualBankAllowed === allowed });
  }
  const bank = { amount: 1, method: 'BANK_TRANSFER', reference: tag };
  for (const [role, token, expected] of [
    ['OWNER', tokens.get('OWNER')!, 403], ['LEASING', tokens.get('LEASING')!, 403],
    ['CUSTOMER', signCustomerToken({ sub: tag, email: null, phone: null }), 401], ['anonymous', null, 401],
  ] as const) {
    const result = await request(token, `/admin/orders/${tag}/payments`, 'POST', bank);
    checks.push({ check: `${role}-manual-order-payment-denied`, status: result.status, passed: result.status === expected });
  }
  const leased = await request(tokens.get('LEASING')!, '/leasing/finance/itgel/pay', 'POST', { method: 'BANK_TRANSFER', settlementIds: [tag], bankRef: tag, bankDate: '2026-10-13' });
  checks.push({ check: 'LEASING-settlement-bank-denied', status: leased.status, passed: leased.status === 403 });
  if (checks.some((check) => !check.passed)) throw new Error(JSON.stringify(checks));
  console.log(JSON.stringify({ checks, ledgerWrites: 0, realPayments: 0 }, null, 2));
} finally {
  await prisma.adminUser.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
}
