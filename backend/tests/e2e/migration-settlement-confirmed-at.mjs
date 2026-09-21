/**
 * Цэвэр Postgres (itgel_mig_settlement) дээр хуучин schema + fixture,
 * дараа нь 20260921120000 / 20260921180000. Isolated `itgel` / production руу явахгүй.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = join(ROOT, 'prisma/migrations');
const FIRST = '20260921120000';
const SECOND = '20260921180000';
const CONTAINER = 'itgel-db';
const DB = 'itgel_mig_settlement';
const MOCK_PORT = 4101;

function dockerPsql(db, extraArgs, input) {
  const result = spawnSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'itgel', '-d', db, '-v', 'ON_ERROR_STOP=1', '-At', ...extraArgs],
    { encoding: 'utf8', input },
  );
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || result.error?.message || `psql exit ${result.status}`).trim(),
    );
  }
  return (result.stdout ?? '').trim();
}

function sql(text) {
  return dockerPsql(DB, ['-c', text]);
}

function sqlFile(file) {
  dockerPsql(DB, [], readFileSync(file, 'utf8'));
}

function columns(table) {
  return new Set(
    sql(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}'`,
    )
      .split('\n')
      .filter(Boolean),
  );
}

function sqlLit(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function insert(table, row) {
  const cols = columns(table);
  const keys = Object.keys(row).filter((key) => cols.has(key));
  if (keys.length === 0) throw new Error(`${table}: no matching columns`);
  const names = keys.map((key) => `"${key}"`).join(', ');
  const vals = keys.map((key) => sqlLit(row[key])).join(', ');
  sql(`INSERT INTO "${table}" (${names}) VALUES (${vals})`);
}

function snapshot() {
  return {
    settlement: sql(
      `SELECT coalesce(sum(amount),0)||' '||coalesce(sum("paidAmount"),0)||' '||coalesce(sum("remainingAmount"),0)||' '||count(*) FROM "ItgelSettlement"`,
    ),
    payments: sql(
      `SELECT status||':'||count(*)||':'||coalesce(sum(amount),0) FROM "ItgelSettlementPayment" GROUP BY status ORDER BY status`,
    ),
    ledger: sql(
      `SELECT "kind"::text||':'||coalesce(sum(amount),0)||':'||count(*) FROM "Payment" GROUP BY "kind" ORDER BY "kind"`,
    ),
    exceptions: sql(`SELECT coalesce(sum(amount),0)||' '||count(*) FROM "MoneyException"`),
    statuses: sql(`SELECT status||':'||count(*) FROM "ItgelSettlement" GROUP BY status ORDER BY status`),
  };
}

const dirs = readdirSync(MIGRATIONS)
  .filter((name) => /^\d{14}_/.test(name))
  .sort();
const oldDirs = dirs.filter((name) => name.slice(0, 14) < FIRST);
const newDirs = dirs.filter((name) => name.slice(0, 14) >= FIRST);
assert.ok(oldDirs.length > 0);
assert.equal(newDirs[0]?.slice(0, 14), FIRST);
assert.ok(newDirs.some((name) => name.startsWith(SECOND)));

dockerPsql('postgres', [
  '-c',
  `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB}' AND pid <> pg_backend_pid()`,
]);
dockerPsql('postgres', ['-c', `DROP DATABASE IF EXISTS ${DB}`]);
dockerPsql('postgres', ['-c', `CREATE DATABASE ${DB} OWNER itgel`]);

for (const dir of oldDirs) {
  sqlFile(join(MIGRATIONS, dir, 'migration.sql'));
}

assert.equal(columns('ItgelSettlementPayment').has('confirmedAt'), false);
assert.equal(columns('ItgelSettlementPayment').has('invoicePayload'), false);
assert.equal(columns('ItgelSettlementPayment').has('confirmedAtSource'), false);

const now = '2026-09-01T00:00:00.000Z';
insert('Category', { id: 'cat_m', name: 'Шалгалт', isActive: true, sortOrder: 0, createdAt: now, updatedAt: now });
insert('Product', {
  id: 'prod_m',
  name: 'Шалгах бараа',
  categoryId: 'cat_m',
  costPrice: 10000,
  sellPrice: 20000,
  stock: 20,
  status: 'ACTIVE',
  createdAt: now,
  updatedAt: now,
});
insert('ProductRound', {
  id: 'round_m',
  productId: 'prod_m',
  roundNo: 1,
  costPrice: 10000,
  sellPrice: 20000,
  stock: 20,
  status: 'ACTIVE',
  createdAt: now,
  updatedAt: now,
});
insert('Customer', {
  id: 'cust_m',
  phone: '99000011',
  email: 'mig-settlement@phone.local',
  name: 'Шалгах',
  createdAt: now,
  updatedAt: now,
});
insert('AdminUser', {
  id: 'adm_lease',
  email: 'lease-mig@itgel.mn',
  name: 'Лизинг',
  passwordHash: 'x',
  role: 'LEASING',
  isActive: true,
  createdAt: now,
});
insert('Order', {
  id: 'order_m',
  code: 'PH-MIG01',
  customerId: 'cust_m',
  status: 'CONFIRMED',
  subtotal: 149000,
  paidAmount: 8000,
  refundedAmount: 1000,
  dueAmount: 142000,
  isLeasing: true,
  leasingFee: 8000,
  payeeKind: 'LEASING',
  createdAt: now,
  updatedAt: now,
  confirmedAt: now,
});

const items = [
  ['item_open', 50000],
  ['item_invoiced', 12000],
  ['item_bank', 8000],
  ['item_paid_audit', 20000],
  ['item_paid_none', 15000],
  ['item_uncertain', 9000],
  ['item_partial', 35000],
];
for (const [id, price] of items) {
  insert('OrderItem', {
    id,
    orderId: 'order_m',
    productId: 'prod_m',
    roundId: 'round_m',
    nameSnapshot: 'Шалгах бараа',
    qty: 1,
    unitPrice: price,
    costPriceSnapshot: 10000,
    selections: {},
  });
}

insert('Payment', {
  id: 'ledger_pay',
  orderId: 'order_m',
  kind: 'PAYMENT',
  amount: 8000,
  method: 'BANK_TRANSFER',
  actor: 'admin:mig',
  createdAt: now,
});
insert('Payment', {
  id: 'ledger_refund',
  orderId: 'order_m',
  kind: 'REFUND',
  amount: 1000,
  method: 'BANK_TRANSFER',
  actor: 'admin:mig',
  createdAt: now,
});

insert('ItgelSettlementPayment', {
  id: 'pay_invoiced',
  ownerAdminId: 'adm_lease',
  method: 'QPAY',
  amount: 12000,
  status: 'PENDING',
  qpayInvoiceId: 'inv_legacy',
  claimedBy: 'admin:adm_lease',
  createdAt: now,
  updatedAt: now,
});
insert('ItgelSettlementPayment', {
  id: 'pay_bank',
  ownerAdminId: 'adm_lease',
  method: 'BANK_TRANSFER',
  amount: 8000,
  status: 'PENDING',
  claimedBy: 'admin:adm_lease',
  bankRef: 'BNK-1',
  createdAt: now,
  updatedAt: now,
});
insert('ItgelSettlementPayment', {
  id: 'pay_audit',
  ownerAdminId: 'adm_lease',
  method: 'QPAY',
  amount: 20000,
  status: 'CONFIRMED',
  qpayInvoiceId: 'inv_audit',
  claimedBy: 'admin:adm_lease',
  confirmedBy: 'admin:adm_lease',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
});
insert('ItgelSettlementPayment', {
  id: 'pay_none',
  ownerAdminId: 'adm_lease',
  method: 'BANK_TRANSFER',
  amount: 15000,
  status: 'CONFIRMED',
  claimedBy: 'admin:adm_lease',
  confirmedBy: 'admin:adm_lease',
  createdAt: '2026-07-02T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
});
insert('ItgelSettlementPayment', {
  id: 'pay_uncertain',
  ownerAdminId: 'adm_lease',
  method: 'QPAY',
  amount: 9000,
  status: 'PENDING',
  claimedBy: 'admin:adm_lease',
  createdAt: now,
  updatedAt: now,
});
insert('ItgelSettlementPayment', {
  id: 'pay_partial',
  ownerAdminId: 'adm_lease',
  method: 'QPAY',
  amount: 10000,
  status: 'PENDING',
  claimedBy: 'admin:adm_lease',
  createdAt: now,
  updatedAt: now,
});

const settlements = [
  ['sett_open', 'item_open', 'OPEN', 50000, 0, 50000, null],
  ['sett_invoiced', 'item_invoiced', 'INVOICED', 12000, 0, 12000, 'pay_invoiced'],
  ['sett_bank', 'item_bank', 'PENDING_BANK', 8000, 0, 8000, 'pay_bank'],
  ['sett_paid_audit', 'item_paid_audit', 'PAID', 20000, 20000, 0, null],
  ['sett_paid_none', 'item_paid_none', 'PAID', 15000, 15000, 0, null],
  ['sett_uncertain', 'item_uncertain', 'INVOICED', 9000, 0, 9000, 'pay_uncertain'],
  ['sett_partial', 'item_partial', 'INVOICED', 35000, 0, 35000, 'pay_partial'],
];
for (const [id, itemId, status, amount, paid, remaining, lock] of settlements) {
  insert('ItgelSettlement', {
    id,
    sourceOrderItemId: itemId,
    sourceOrderId: 'order_m',
    sourceOrderCode: 'PH-MIG01',
    customerId: 'cust_m',
    customerName: 'Шалгах',
    ownerAdminId: 'adm_lease',
    productId: 'prod_m',
    roundId: 'round_m',
    productName: 'Шалгах бараа',
    qty: 1,
    unitPrice: amount,
    amount,
    confirmedAt: now,
    status,
    paidAmount: paid,
    remainingAmount: remaining,
    lockPaymentId: lock,
    createdAt: now,
    updatedAt: now,
  });
}

insert('ItgelSettlementPaymentLine', { id: 'line_invoiced', paymentId: 'pay_invoiced', settlementId: 'sett_invoiced', amount: 12000 });
insert('ItgelSettlementPaymentLine', { id: 'line_bank', paymentId: 'pay_bank', settlementId: 'sett_bank', amount: 8000 });
insert('ItgelSettlementPaymentLine', { id: 'line_audit', paymentId: 'pay_audit', settlementId: 'sett_paid_audit', amount: 20000 });
insert('ItgelSettlementPaymentLine', { id: 'line_none', paymentId: 'pay_none', settlementId: 'sett_paid_none', amount: 15000 });
insert('ItgelSettlementPaymentLine', { id: 'line_uncertain', paymentId: 'pay_uncertain', settlementId: 'sett_uncertain', amount: 9000 });
insert('ItgelSettlementPaymentLine', { id: 'line_partial', paymentId: 'pay_partial', settlementId: 'sett_partial', amount: 10000 });

insert('AuditLog', {
  id: 'audit_pay',
  actor: 'admin:adm_lease',
  action: 'ITGEL_PAYMENT_CONFIRMED',
  entity: 'ItgelSettlementPayment',
  entityId: 'pay_audit',
  createdAt: '2026-07-15T12:00:00.000Z',
});
insert('MoneyException', {
  id: 'ex_open',
  kind: 'SETTLEMENT_MISMATCH',
  settlementPaymentId: 'pay_none',
  amount: 111,
  status: 'OPEN',
  note: 'fixture',
  actor: 'admin:mig',
  createdAt: now,
});

const before = snapshot();
assert.equal(before.settlement, '149000 35000 114000 7');

for (const dir of newDirs) {
  sqlFile(join(MIGRATIONS, dir, 'migration.sql'));
}

const afterFirst = snapshot();
assert.deepEqual(afterFirst, before, 'migration must not change debt/payment/refund/remaining totals');
assert.equal(sql(`SELECT "invoicePayload" IS NULL AND "senderInvoiceNo" IS NULL FROM "ItgelSettlementPayment" WHERE id='pay_invoiced'`), 't');
assert.equal(sql(`SELECT "qpayInvoiceId" FROM "ItgelSettlementPayment" WHERE id='pay_invoiced'`), 'inv_legacy');
assert.equal(sql(`SELECT "confirmedAtSource" FROM "ItgelSettlementPayment" WHERE id='pay_audit'`), 'AUDIT');
assert.equal(sql(`SELECT "confirmedAt"::date FROM "ItgelSettlementPayment" WHERE id='pay_audit'`), '2026-07-15');
assert.equal(sql(`SELECT "confirmedAt" IS NULL AND "confirmedAtSource" IS NULL FROM "ItgelSettlementPayment" WHERE id='pay_none'`), 't');

sql(`UPDATE "ItgelSettlementPayment" SET "invoiceAttemptAt" = NOW(), "senderInvoiceNo" = 'ITGEL-pay_uncertain' WHERE id='pay_uncertain' AND "qpayInvoiceId" IS NULL`);

for (const dir of newDirs) {
  sqlFile(join(MIGRATIONS, dir, 'migration.sql'));
}
const afterRerun = snapshot();
assert.deepEqual(afterRerun, before, 're-run must not duplicate or change totals');
assert.equal(sql(`SELECT count(*) FROM "ItgelSettlementPayment"`), '6');
assert.equal(sql(`SELECT count(*) FROM "ItgelSettlement"`), '7');
assert.equal(sql(`SELECT count(*) FROM "MoneyException"`), '1');
assert.equal(sql(`SELECT "confirmedAt" IS NULL FROM "ItgelSettlementPayment" WHERE id='pay_none'`), 't');

sql(`UPDATE "ItgelSettlementPayment" SET status='CONFIRMED' WHERE id='pay_partial' AND status='PENDING'`);
sql(`
  UPDATE "ItgelSettlement"
  SET status='PAID', "paidAmount"="paidAmount"+10000, "remainingAmount"=0, "lockPaymentId"=NULL
  WHERE id='sett_partial' AND "remainingAmount"=10000 AND "lockPaymentId"='pay_partial' AND status IN ('INVOICED','PENDING_BANK')
`);
assert.equal(
  sql(`SELECT status||' '||"remainingAmount"||' '||"paidAmount" FROM "ItgelSettlement" WHERE id='sett_partial'`),
  'INVOICED 35000 0',
  'old confirm must not treat partial as full close',
);
assert.equal(sql(`SELECT status FROM "ItgelSettlementPayment" WHERE id='pay_partial'`), 'CONFIRMED');
sql(`UPDATE "ItgelSettlementPayment" SET status='PENDING' WHERE id='pay_partial'`);

const requests = [];
const server = createServer(async (req, res) => {
  const url = req.url ?? '';
  requests.push(`${req.method} ${url}`);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = {};
  }
  const send = (status, data) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  if (req.method === 'POST' && url === '/v2/auth/token') {
    send(200, { access_token: 'mock-shop', expires_in: 3600 });
    return;
  }
  if (req.method === 'POST' && url === '/v2/invoice') {
    send(400, { message: 'create must not run after attempt' });
    return;
  }
  if (req.method === 'GET' && url === '/v2/invoice/inv_legacy') {
    send(200, { invoice_id: 'inv_legacy', qr_text: 'qr:inv_legacy', amount: 12000 });
    return;
  }
  if (req.method === 'GET' && url === '/v2/invoice/inv_uncertain') {
    send(200, { invoice_id: 'inv_uncertain', qr_text: 'qr:inv_uncertain', amount: 9000 });
    return;
  }
  if (req.method === 'POST' && url === '/v2/invoice/list') {
    const sender = String(body.sender_invoice_no ?? '');
    const rows =
      sender === 'ITGEL-pay_uncertain'
        ? [{ invoice_id: 'inv_uncertain', sender_invoice_no: sender, amount: 9000, invoice_status: 'OPEN' }]
        : [];
    send(200, { count: rows.length, rows });
    return;
  }
  if (req.method === 'POST' && url === '/v2/payment/check') {
    const id = String(body.object_id ?? '');
    if (id === 'inv_uncertain') {
      send(200, { count: 1, paid_amount: 9000, rows: [{ payment_id: 'qp_unc', invoice_id: id }] });
      return;
    }
    send(200, { count: 0, paid_amount: 0, rows: [] });
    return;
  }
  send(404, { message: `${req.method} ${url}` });
});

await new Promise((resolve) => server.listen(MOCK_PORT, '127.0.0.1', resolve));

const env = {
  ...process.env,
  DATABASE_URL: `postgresql://itgel:itgel@127.0.0.1:5432/${DB}`,
  DIRECT_URL: `postgresql://itgel:itgel@127.0.0.1:5432/${DB}`,
  JWT_SECRET: 'isolated-settlement-mig-tests',
  QPAY_ENABLED: 'true',
  QPAY_USERNAME: 'shop-test',
  QPAY_PASSWORD: 'shop-secret',
  QPAY_INVOICE_CODE: 'SHOP_TEST_INVOICE',
  QPAY_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v2`,
  QPAY_CALLBACK_URL: 'http://127.0.0.1:9/callback',
  CRON_ENABLED: 'false',
  SMS_PROVIDER: 'console',
  STORAGE_PROVIDER: 'mock',
};
const childOut = await new Promise((resolve, reject) => {
  const child = spawn('./node_modules/.bin/tsx', ['tests/e2e/settlement-mig-resume.ts'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.on('error', reject);
  child.on('close', (code) => {
    if (code !== 0) reject(new Error((stderr || stdout || `resume exit ${code}`).trim()));
    else resolve(stdout);
  });
});
server.close();
assert.equal(sql(`SELECT status||' '||"remainingAmount" FROM "ItgelSettlement" WHERE id='sett_invoiced'`), 'INVOICED 12000');
assert.equal(sql(`SELECT "invoicePayload" IS NOT NULL FROM "ItgelSettlementPayment" WHERE id='pay_invoiced'`), 't');
assert.equal(sql(`SELECT status||' '||"remainingAmount"||' '||"paidAmount" FROM "ItgelSettlement" WHERE id='sett_uncertain'`), 'PAID 0 9000');
assert.equal(sql(`SELECT status FROM "ItgelSettlementPayment" WHERE id='pay_uncertain'`), 'CONFIRMED');
assert.ok(requests.some((row) => row === 'GET /v2/invoice/inv_legacy'));
assert.ok(requests.some((row) => row === 'POST /v2/invoice/list'));
assert.ok(!requests.some((row) => row === 'POST /v2/invoice'));
assert.match(childOut, /resume-ok/);

console.log('migration-settlement-confirmed-at: PASS');
console.log('  totals unchanged across both migrations and re-run');
console.log('  unproven confirmedAt stays NULL');
console.log('  old INVOICED resumes via GET; uncertain paid without callback records once');
console.log('  old confirm does not close partial remaining as PAID');
