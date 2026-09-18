/**
 * Хуучин schema + төлөөлөх өгөгдөл дээр 20260918 migration-уудыг тусгаарласан DB-д шалгана.
 * Production / isolated `itgel` DB-д хүрэхгүй.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = join(ROOT, 'prisma/migrations');
const CUTOFF = '20260918120000';
const CONTAINER = 'itgel-db';

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
  return dockerPsql('itgel_migtest', ['-c', text]);
}

function sqlFile(file) {
  dockerPsql('itgel_migtest', [], readFileSync(file, 'utf8'));
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

const dirs = readdirSync(MIGRATIONS)
  .filter((name) => /^\d{14}_/.test(name))
  .sort();
const oldDirs = dirs.filter((name) => name.slice(0, 14) < CUTOFF);
const newDirs = dirs.filter((name) => name.slice(0, 14) >= CUTOFF);
assert.ok(oldDirs.length > 0);
assert.ok(newDirs.some((name) => name.startsWith('20260918120000')));
assert.ok(newDirs.some((name) => name.startsWith('20260918140000')));

dockerPsql(
  'postgres',
  [
    '-c',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='itgel_migtest' AND pid <> pg_backend_pid()`,
  ],
);
dockerPsql('postgres', ['-c', 'DROP DATABASE IF EXISTS itgel_migtest']);
dockerPsql('postgres', ['-c', 'CREATE DATABASE itgel_migtest OWNER itgel']);

for (const dir of oldDirs) {
  sqlFile(join(MIGRATIONS, dir, 'migration.sql'));
}

const roundCols = columns('ProductRound');
assert.equal(roundCols.has('reserved'), false, 'old ProductRound must not have reserved');
assert.equal(roundCols.has('available'), false, 'old ProductRound must not have available');
assert.equal(columns('Order').has('leasingOperatorAdminId'), false);
assert.equal(sql(`SELECT to_regclass('public."ItgelSettlement"')`), '');

const now = new Date().toISOString();
insert('Category', {
  id: 'cat_old',
  name: 'Хуучин',
  isActive: true,
  sortOrder: 0,
  createdAt: now,
  updatedAt: now,
});
insert('Product', {
  id: 'prod_old',
  name: 'Хуучин бэлэн',
  categoryId: 'cat_old',
  costPrice: 40000,
  sellPrice: 80000,
  stock: 10,
  status: 'ACTIVE',
  createdAt: now,
  updatedAt: now,
});
insert('ProductRound', {
  id: 'round_old',
  productId: 'prod_old',
  roundNo: 1,
  costPrice: 40000,
  sellPrice: 80000,
  stock: 10,
  status: 'ACTIVE',
  createdAt: now,
  updatedAt: now,
});
if (columns('RoundSkuStock').size > 0) {
  insert('RoundSkuStock', {
    id: 'sku_old',
    roundId: 'round_old',
    skuKey: 'Өнгө=Хар',
    selections: { Өнгө: 'Хар' },
    stock: 3,
  });
}
insert('Customer', {
  id: 'cust_old',
  phone: '99001122',
  email: 'legacy-migtest@phone.local',
  name: 'Хуучин хэрэглэгч',
  createdAt: now,
  updatedAt: now,
});
insert('Order', {
  id: 'order_old',
  code: 'PH-OLD01',
  customerId: 'cust_old',
  status: 'CONFIRMED',
  subtotal: 80000,
  paidAmount: 8000,
  dueAmount: 72000,
  isLeasing: true,
  leasingFee: 8000,
  payeeKind: 'LEASING',
  createdAt: now,
  updatedAt: now,
  confirmedAt: now,
});
insert('OrderItem', {
  id: 'item_old',
  orderId: 'order_old',
  productId: 'prod_old',
  roundId: 'round_old',
  nameSnapshot: 'Хуучин бэлэн',
  qty: 1,
  unitPrice: 80000,
  costPriceSnapshot: 40000,
  selections: {},
});
insert('Payment', {
  id: 'pay_old',
  orderId: 'order_old',
  kind: 'PAYMENT',
  amount: 8000,
  method: 'BANK_TRANSFER',
  actor: 'admin:migtest',
  createdAt: now,
});

const oldStock = sql(`SELECT stock FROM "ProductRound" WHERE id='round_old'`);
const oldPaid = sql(`SELECT "paidAmount" FROM "Order" WHERE id='order_old'`);
assert.equal(oldStock, '10');
assert.equal(oldPaid, '8000');

for (const dir of newDirs) {
  sqlFile(join(MIGRATIONS, dir, 'migration.sql'));
}

assert.equal(sql(`SELECT stock FROM "ProductRound" WHERE id='round_old'`), '10');
assert.equal(sql(`SELECT reserved FROM "ProductRound" WHERE id='round_old'`), '0');
assert.equal(sql(`SELECT available FROM "ProductRound" WHERE id='round_old'`), '10');
if (columns('RoundSkuStock').has('available')) {
  assert.equal(sql(`SELECT stock FROM "RoundSkuStock" WHERE id='sku_old'`), '3');
  assert.equal(sql(`SELECT reserved FROM "RoundSkuStock" WHERE id='sku_old'`), '0');
  assert.equal(sql(`SELECT available FROM "RoundSkuStock" WHERE id='sku_old'`), '3');
}
assert.equal(sql(`SELECT "paidAmount" FROM "Order" WHERE id='order_old'`), '8000');
assert.equal(sql(`SELECT amount FROM "Payment" WHERE id='pay_old'`), '8000');
assert.equal(sql(`SELECT status FROM "Order" WHERE id='order_old'`), 'CONFIRMED');
assert.equal(sql(`SELECT count(*) FROM "ItgelSettlement"`), '0');
assert.equal(sql(`SELECT "leasingOperatorAdminId" FROM "Order" WHERE id='order_old'`), '');
assert.equal(sql(`SELECT "leasingSettlementAdminId" FROM "Setting" WHERE id=1`) || '', '');

sql(`UPDATE "ProductRound" SET available = GREATEST(0, stock - reserved)`);
assert.equal(sql(`SELECT available FROM "ProductRound" WHERE id='round_old'`), '10');

console.log('migration-stock-settlement: PASS');
console.log('  old stock/reserved/payments preserved');
console.log('  available backfilled from stock-reserved');
console.log('  no historical ItgelSettlement rows');
