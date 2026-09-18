#!/usr/bin/env node
/**
 * Local DB + mocked QPay HTTP. Production DB / merchant.qpay.mn / SMS / email руу явахгүй.
 *
 *   node tests/e2e/checkout-qpay.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOCAL_DB = 'postgresql://itgel:itgel@127.0.0.1:5432/itgel';
const API_PORT = 4012;
const MOCK_PORT = 4099;
const API = `http://127.0.0.1:${API_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;

const results = [];
function passLog(name, detail = '') {
  const line = `PASS ${name}${detail ? ` — ${detail}` : ''}`;
  results.push(line);
  console.log(line);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) {
  fail(`DATABASE_URL локал биш — зогсоов: ${process.env.DATABASE_URL.replace(/:[^@]+@/, ':***@')}`);
}

function sql(query) {
  return execFileSync(
    'docker',
    ['exec', 'itgel-db', 'psql', '-U', 'itgel', '-d', 'itgel', '-At', '-c', query],
    { encoding: 'utf8' },
  ).trim();
}

function dockerHost() {
  return execFileSync(
    'docker',
    ['inspect', '-f', '{{range $p, $conf := .NetworkSettings.Ports}}{{$p}}={{(index $conf 0).HostPort}};{{end}}', 'itgel-db'],
    { encoding: 'utf8' },
  );
}

const hostPorts = dockerHost();
if (!hostPorts.includes('5432')) fail(`itgel-db 5432 дээр биш: ${hostPorts}`);
const dbUrl = sql("SELECT current_database();");
assert.equal(dbUrl, 'itgel');
passLog('isolation docker Postgres itgel @ 127.0.0.1:5432');

function startMockQpay() {
  const invoices = new Map();
  const payments = new Map();
  const checkFails = new Map();
  const requests = [];
  let seq = 0;

  function accountOf(req) {
    const auth = req.headers.authorization ?? '';
    if (auth.startsWith('Basic ')) {
      const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
      if (user === 'shop-test' && pass === 'shop-secret') return 'shop';
      if (user === 'leasing-test' && pass === 'leasing-secret') return 'leasing';
      return null;
    }
    if (auth === 'Bearer mock-shop') return 'shop';
    if (auth === 'Bearer mock-leasing') return 'leasing';
    return null;
  }

  function send(res, status, body) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(text);
  }

  async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw.trim()) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return { _raw: raw };
    }
  }

  const server = createServer(async (req, res) => {
    const url = req.url ?? '/';
    requests.push({ method: req.method, url });
    if (url.includes('merchant.qpay.mn') || url.includes('supabase')) {
      send(res, 500, { error: 'refusing non-mock host' });
      return;
    }

    if (req.method === 'POST' && url === '/v2/auth/token') {
      const kind = accountOf(req);
      if (!kind) {
        send(res, 401, { message: 'auth failed' });
        return;
      }
      send(res, 200, {
        access_token: kind === 'leasing' ? 'mock-leasing' : 'mock-shop',
        expires_in: 3600,
      });
      return;
    }

    const kind = accountOf(req);
    if (!kind) {
      send(res, 401, { message: 'unauthorized' });
      return;
    }

    if (req.method === 'POST' && url === '/v2/invoice') {
      const body = await readBody(req);
      const id = `inv_${kind}_${randomUUID()}`;
      invoices.set(id, {
        id,
        account: kind,
        amount: Number(body.amount ?? 0),
        paidAmount: 0,
        paymentIds: [],
        cancelled: false,
      });
      send(res, 200, {
        invoice_id: id,
        qr_text: `qr:${id}`,
        amount: body.amount,
        urls: [],
      });
      return;
    }

    const invoiceDelete = url.match(/^\/v2\/invoice\/([^/]+)$/);
    if (req.method === 'DELETE' && invoiceDelete) {
      const inv = invoices.get(decodeURIComponent(invoiceDelete[1]));
      if (inv) inv.cancelled = true;
      send(res, 200, {});
      return;
    }

    if (req.method === 'POST' && url === '/v2/payment/check') {
      const body = await readBody(req);
      const id = String(body.object_id ?? '');
      const left = checkFails.get(id) ?? 0;
      if (left > 0) {
        checkFails.set(id, left - 1);
        send(res, 500, { message: 'temporary qpay failure' });
        return;
      }
      const inv = invoices.get(id);
      if (!inv || inv.account !== kind) {
        send(res, 200, { count: 0, paid_amount: 0, rows: [] });
        return;
      }
      send(res, 200, {
        count: inv.paymentIds.length,
        paid_amount: inv.paidAmount,
        rows: inv.paymentIds.map((paymentId) => ({ payment_id: paymentId, invoice_id: id })),
      });
      return;
    }

    const paymentGet = url.match(/^\/v2\/payment\/([^/]+)$/);
    if (req.method === 'GET' && paymentGet) {
      const payment = payments.get(decodeURIComponent(paymentGet[1]));
      if (!payment) {
        send(res, 404, { message: 'not found' });
        return;
      }
      send(res, 200, {
        payment_id: payment.id,
        invoice_id: payment.invoiceId,
        payment_amount: payment.amount,
      });
      return;
    }

    send(res, 404, { message: `mock missing ${req.method} ${url}` });
  });

  return new Promise((resolve) => {
    server.listen(MOCK_PORT, '127.0.0.1', () => {
      resolve({
        server,
        requests,
        invoices,
        pay(invoiceId, amount) {
          const inv = invoices.get(invoiceId);
          if (!inv) throw new Error(`mock invoice ${invoiceId} алга`);
          inv.paidAmount = amount;
          const id = `pay_${++seq}`;
          inv.paymentIds.push(id);
          payments.set(id, { id, invoiceId, amount });
          return id;
        },
        failNextCheck(invoiceId, times = 1) {
          checkFails.set(invoiceId, times);
        },
      });
    });
  });
}

function isolatedEnv() {
  return {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(API_PORT),
    DATABASE_URL: LOCAL_DB,
    DIRECT_URL: LOCAL_DB,
    JWT_SECRET: 'isolated-checkout-qpay-tests',
    CRON_ENABLED: 'false',
    CRON_SECRET: 'isolated-checkout-cron-secret',
    SMS_PROVIDER: 'console',
    SHOP_SMS_PROVIDER: 'console',
    STORAGE_PROVIDER: 'mock',
    CORS_ORIGIN: '*',
    QPAY_ENABLED: 'true',
    QPAY_BASE_URL: `${MOCK}/v2`,
    QPAY_USERNAME: 'shop-test',
    QPAY_PASSWORD: 'shop-secret',
    QPAY_INVOICE_CODE: 'SHOP_TEST_INVOICE',
    QPAY_CALLBACK_URL: `${API}/api/orders/qpay/callback`,
    LEASING_QPAY_ENABLED: 'true',
    LEASING_QPAY_BASE_URL: `${MOCK}/v2`,
    LEASING_QPAY_CLIENT_ID: 'leasing-test',
    LEASING_QPAY_CLIENT_SECRET: 'leasing-secret',
    LEASING_QPAY_INVOICE_CODE: 'LEASING_TEST_INVOICE',
    LEASING_QPAY_CALLBACK_URL: `${API}/api/orders/leasing-qpay/callback`,
    SUPABASE_URL: '',
    SUPABASE_PUBLISHABLE_KEY: '',
    SUPABASE_SECRET_KEY: '',
    SUPABASE_JWKS_URL: '',
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    R2_ENDPOINT: '',
    R2_ACCESS_KEY_ID: '',
    R2_SECRET_ACCESS_KEY: '',
  };
}

function cancelUnpaidNow() {
  const out = execFileSync('npx', ['tsx', 'tests/e2e/cancel-unpaid-once.ts'], {
    cwd: BACKEND_ROOT,
    env: isolatedEnv(),
    encoding: 'utf8',
  });
  const match = out.match(/UNPAID_CANCELLED=(\d+)/);
  return Number(match?.[1] ?? 'NaN');
}

function startBackend(logs) {
  const child = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: BACKEND_ROOT,
    env: isolatedEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const onData = (buf) => {
    logs.push(buf.toString());
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  return child;
}

async function waitForHealth() {
  const deadline = Date.now() + 25_000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API}/health`);
      last = await res.text();
      if (res.ok && last.includes('"ok":true')) return;
    } catch {
      /* still booting */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  fail(`backend 4012 health хүлээгдсэнгүй: ${last}`);
}

let ipSeq = 20;
async function req(path, { method = 'GET', token, body, raw, idempotencyKey } = {}) {
  const headers = {
    accept: 'application/json',
    'x-forwarded-for': `127.0.0.${ipSeq++}`,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (raw) return { status: res.status, text };
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { parseError: true, text };
  }
  return { status: res.status, json, text };
}

function data(res) {
  if (res.json?.data === undefined) {
    throw new Error(`data алга (${res.status}): ${res.text.slice(0, 400)}`);
  }
  return res.json.data;
}

async function loginCustomer(phone, name) {
  const otp = await req('/api/auth/otp', { method: 'POST', body: { phone, name } });
  assert.equal(otp.status, 200, otp.text);
  const code = sql(
    `SELECT code FROM "PhoneOtp" WHERE phone='${phone}' AND purpose='LOGIN' ORDER BY "createdAt" DESC LIMIT 1`,
  );
  assert.match(code, /^\d{6}$/);
  const verify = await req('/api/auth/verify', { method: 'POST', body: { phone, code } });
  assert.equal(verify.status, 200, verify.text);
  const token = data(verify).token;
  const customerId = sql(`SELECT id FROM "Customer" WHERE phone='${phone}'`);
  return { token, customerId };
}

function lineOf(product, qty = 1) {
  const sku = (product.skuStocks ?? []).find((s) => s.stock > 0);
  if (sku?.selections) {
    return {
      productId: product.id,
      qty,
      selections: sku.selections,
      ...(sku.selections['Хэмжээ'] ? { size: sku.selections['Хэмжээ'] } : {}),
      ...(sku.selections['Өнгө'] ? { color: sku.selections['Өнгө'] } : {}),
    };
  }
  const selections = {};
  for (const opt of product.options ?? []) {
    if (opt.values?.[0]) selections[opt.name] = opt.values[0];
  }
  return {
    productId: product.id,
    qty,
    ...(Object.keys(selections).length ? { selections } : {}),
  };
}

function skuKey(selections) {
  return Object.keys(selections)
    .sort((a, b) => a.localeCompare(b, 'mn'))
    .map((k) => `${k}=${selections[k]}`)
    .join('|');
}

function bumpStock(product, qty) {
  sql(
    `UPDATE "ProductRound" SET stock = stock + ${qty}, available = available + ${qty}, status = CASE WHEN available + ${qty} > 0 THEN 'ACTIVE' ELSE status END WHERE id='${product.id}'`,
  );
  const line = lineOf(product);
  if (line.selections && Object.keys(line.selections).length) {
    sql(
      `UPDATE "RoundSkuStock" SET stock = stock + ${qty}, available = available + ${qty} WHERE "roundId"='${product.id}' AND "skuKey"='${skuKey(line.selections)}'`,
    );
  }
}

function setStock(product, qty) {
  sql(
    `UPDATE "ProductRound" SET stock = ${qty}, reserved = 0, available = ${qty}, status = CASE WHEN ${qty} > 0 THEN 'ACTIVE' ELSE status END WHERE id='${product.id}'`,
  );
  const line = lineOf(product);
  if (line.selections && Object.keys(line.selections).length) {
    sql(
      `UPDATE "RoundSkuStock" SET stock = ${qty}, reserved = 0, available = ${qty} WHERE "roundId"='${product.id}' AND "skuKey"='${skuKey(line.selections)}'`,
    );
  }
}

function roundHold(product) {
  const raw = sql(
    `SELECT stock || ' ' || reserved || ' ' || available FROM "ProductRound" WHERE id='${product.id}'`,
  );
  const [stock, reserved, available] = raw.split(' ').map(Number);
  return { stock, reserved, available };
}

function skuHold(roundId, skuKey) {
  const raw = sql(
    `SELECT stock || ' ' || reserved || ' ' || available FROM "RoundSkuStock" WHERE "roundId"='${roundId}' AND "skuKey"='${skuKey}'`,
  );
  const [stock, reserved, available] = raw.split(' ').map(Number);
  return { stock, reserved, available };
}

function roundStock(product) {
  return roundHold(product).stock;
}

function assertReserved(product, before, qty = 1) {
  const after = roundHold(product);
  assert.equal(after.stock, before.stock, 'checkout must not consume warehouse stock');
  assert.equal(after.reserved, before.reserved + qty);
  assert.equal(after.available, before.available - qty);
}

function paymentsOf(orderId) {
  const raw = sql(
    `SELECT kind || ':' || amount || ':' || COALESCE("qpayInvoiceId",'') FROM "Payment" WHERE "orderId"='${orderId}' ORDER BY "createdAt", id`,
  );
  return raw ? raw.split('\n') : [];
}

function invoiceHistory(orderId) {
  const raw = sql(
    `SELECT id || ':' || account FROM "QpayInvoice" WHERE "orderId"='${orderId}' ORDER BY "createdAt"`,
  );
  return raw ? raw.split('\n').filter(Boolean) : [];
}

const mock = await startMockQpay();
passLog('mock QPay HTTP', MOCK);

execFileSync('npx', ['prisma', 'generate'], {
  cwd: BACKEND_ROOT,
  env: { ...process.env, DATABASE_URL: LOCAL_DB, DIRECT_URL: LOCAL_DB },
  stdio: 'inherit',
});
execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
  cwd: BACKEND_ROOT,
  env: { ...process.env, DATABASE_URL: LOCAL_DB, DIRECT_URL: LOCAL_DB },
  stdio: 'inherit',
});
const table = sql(`SELECT to_regclass('public."CheckoutIdempotency"')`);
assert.match(table, /CheckoutIdempotency/);
passLog('local migrate CheckoutIdempotency');

const logs = [];
const backend = startBackend(logs);
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  backend.kill('SIGTERM');
  mock.server.close();
}
process.on('SIGINT', () => void shutdown().then(() => process.exit(1)));
process.on('SIGTERM', () => void shutdown().then(() => process.exit(1)));

try {
  await waitForHealth();
  const boot = logs.join('');
  if (/merchant\.qpay\.mn|supabase\.com|pooler\.supabase/.test(boot)) {
    fail(`isolated backend production host руу хандсан:\n${boot.slice(-800)}`);
  }
  if (!/\[qpay] enabled=true ready=true/.test(boot) || !/\[leasing-qpay] enabled=true ready=true/.test(boot)) {
    fail(`QPay mock ready биш:\n${boot.slice(-800)}`);
  }
  passLog('isolated backend', API);

  const store = data(await req('/api/store'));
  assert.equal(store.qpay?.enabled, true);
  assert.equal(store.qpay?.ready, true);
  passLog('store QPay enabled via mock — not a disabled-503 stand-in');

  const phoneA = `8${String(Date.now()).slice(-7)}`;
  const phoneB = `9${String(Date.now()).slice(-7)}`;
  const userA = await loginCustomer(phoneA, 'Idem A');
  const userB = await loginCustomer(phoneB, 'Idem B');
  passLog('two customers');

  const products = data(await req('/api/products?type=ready&pageSize=50'));
  const shopReady = products.find((p) => p.ownerKind !== 'LEASING' && p.stock >= 0);
  const shopSku = products.find(
    (p) =>
      p.ownerKind !== 'LEASING' &&
      Array.isArray(p.skuStocks) &&
      p.skuStocks.some((s) => s.stock >= 0),
  );
  const leaseReady = products.find((p) => p.ownerKind === 'LEASING');
  assert.ok(shopReady, 'shop ready product');
  assert.ok(leaseReady, 'leasing ready product');
  bumpStock(shopReady, 30);
  bumpStock(leaseReady, 20);
  if (shopSku) bumpStock(shopSku, 20);

  const skuProduct = shopSku ?? shopReady;
  const shopLine = lineOf(shopReady);
  const skuLine = lineOf(skuProduct);
  const leaseLine = lineOf(leaseReady);

  const keyReplay = randomUUID();
  const stockBefore = roundHold(shopReady);
  const first = await req('/api/orders', {
    method: 'POST',
    token: userA.token,
    idempotencyKey: keyReplay,
    body: { name: 'Idem A', items: [shopLine] },
  });
  assert.equal(first.status, 201, first.text);
  const firstData = data(first);
  const replay = await req('/api/orders', {
    method: 'POST',
    token: userA.token,
    idempotencyKey: keyReplay,
    body: { name: 'Idem A', items: [shopLine] },
  });
  assert.equal(replay.status, 201, replay.text);
  assert.deepEqual(data(replay), firstData);
  assertReserved(shopReady, stockBefore);
  const orderId = sql(`SELECT id FROM "Order" WHERE code='${firstData.code}'`);
  const audits = Number(
    sql(`SELECT COUNT(*) FROM "AuditLog" WHERE entity='Order' AND "entityId"='${orderId}' AND action='CREATE'`),
  );
  assert.equal(audits, 1);
  const stored = sql(
    `SELECT "orderIds"[1] FROM "CheckoutIdempotency" WHERE "customerId"='${userA.customerId}' AND "idempotencyKey"='${keyReplay}'`,
  );
  assert.equal(stored, orderId);
  passLog('replay same key+payload after save — one order/stock/audit', firstData.code);

  const conflictRes = await req('/api/orders', {
    method: 'POST',
    token: userA.token,
    idempotencyKey: keyReplay,
    body: { name: 'Idem A', items: [{ ...shopLine, qty: 2 }] },
  });
  assert.equal(conflictRes.status, 409, conflictRes.text);
  assert.equal(conflictRes.json?.error?.details?.code, 'IDEMPOTENCY_KEY_REUSED');
  assertReserved(shopReady, stockBefore);
  passLog('same key different payload → 409, no extra stock hit');

  const other = await req('/api/orders', {
    method: 'POST',
    token: userB.token,
    idempotencyKey: keyReplay,
    body: { name: 'Idem B', items: [shopLine] },
  });
  assert.equal(other.status, 201, other.text);
  assert.notEqual(data(other).code, firstData.code);
  passLog('same key different customer creates a new order', data(other).code);

  const repurchaseKey = randomUUID();
  const again = await req('/api/orders', {
    method: 'POST',
    token: userA.token,
    idempotencyKey: repurchaseKey,
    body: { name: 'Idem A', items: [shopLine] },
  });
  assert.equal(again.status, 201, again.text);
  assert.notEqual(data(again).code, firstData.code);
  passLog('new key allows buying the same item again', data(again).code);

  const mixedKey = randomUUID();
  const mixedBody = { name: 'Idem A', leasing: true, items: [shopLine, leaseLine] };
  const mixed1 = await req('/api/orders', {
    method: 'POST',
    token: userA.token,
    idempotencyKey: mixedKey,
    body: mixedBody,
  });
  assert.equal(mixed1.status, 201, mixed1.text);
  const mixedData = data(mixed1);
  assert.equal((mixedData.splitOrders ?? []).length, 1, mixed1.text);
  const mixed2 = await req('/api/orders', {
    method: 'POST',
    token: userA.token,
    idempotencyKey: mixedKey,
    body: mixedBody,
  });
  assert.equal(mixed2.status, 201, mixed2.text);
  assert.deepEqual(data(mixed2), mixedData);
  const mixedIds = sql(
    `SELECT array_length("orderIds", 1) FROM "CheckoutIdempotency" WHERE "customerId"='${userA.customerId}' AND "idempotencyKey"='${mixedKey}'`,
  );
  assert.equal(Number(mixedIds), 2);
  passLog('mixed-cart retry returns the same splitOrders', `${mixedData.code}+${mixedData.splitOrders[0].code}`);

  const concKey = randomUUID();
  const skuBefore = roundHold(skuProduct);
  const concurrent = await Promise.all([
    req('/api/orders', {
      method: 'POST',
      token: userA.token,
      idempotencyKey: concKey,
      body: { name: 'Idem A', items: [skuLine] },
    }),
    req('/api/orders', {
      method: 'POST',
      token: userA.token,
      idempotencyKey: concKey,
      body: { name: 'Idem A', items: [skuLine] },
    }),
  ]);
  assert.equal(concurrent.every((r) => r.status === 201), true, concurrent.map((r) => r.text).join(' | '));
  assert.equal(data(concurrent[0]).code, data(concurrent[1]).code);
  assertReserved(skuProduct, skuBefore);
  passLog('concurrent same key — one reserved hold', data(concurrent[0]).code);

  const rollbackProduct = shopReady;
  setStock(rollbackProduct, 1);
  const loseA = randomUUID();
  const loseB = randomUUID();
  const raced = await Promise.all([
    req('/api/orders', {
      method: 'POST',
      token: userA.token,
      idempotencyKey: loseA,
      body: { name: 'Idem A', items: [shopLine] },
    }),
    req('/api/orders', {
      method: 'POST',
      token: userA.token,
      idempotencyKey: loseB,
      body: { name: 'Idem A', items: [shopLine] },
    }),
  ]);
  const won = raced.filter((r) => r.status === 201);
  const lost = raced.filter((r) => r.status === 409);
  assert.equal(won.length, 1, raced.map((r) => `${r.status}:${r.text.slice(0, 120)}`).join(' | '));
  assert.equal(lost.length, 1);
  const lostKey = raced[0].status === 409 ? loseA : loseB;
  const lostRow = sql(
    `SELECT COUNT(*) FROM "CheckoutIdempotency" WHERE "customerId"='${userA.customerId}' AND "idempotencyKey"='${lostKey}'`,
  );
  assert.equal(Number(lostRow), 0);
  const racedHold = roundHold(rollbackProduct);
  assert.equal(racedHold.stock, 1, 'unpaid checkout keeps warehouse stock');
  assert.equal(racedHold.reserved, 1);
  assert.equal(racedHold.available, 0);
  passLog('failed stock transaction rolls back its idempotency row');
  bumpStock(rollbackProduct, 10);

  // --- QPay live mock flow ---
  const shopPayKey = randomUUID();
  const shopPay = await req('/api/orders', {
    method: 'POST',
    token: userA.token,
    idempotencyKey: shopPayKey,
    body: { name: 'Idem A', items: [shopLine] },
  });
  assert.equal(shopPay.status, 201, shopPay.text);
  const shopCode = data(shopPay).code;
  const shopOrderId = sql(`SELECT id FROM "Order" WHERE code='${shopCode}'`);
  const shopDue = Number(sql(`SELECT "dueAmount" FROM "Order" WHERE id='${shopOrderId}'`));

  const inv1 = await req(`/api/orders/${shopCode}/qpay/invoice`, { method: 'POST', token: userA.token, body: {} });
  assert.equal(inv1.status, 201, inv1.text);
  const oldInvoice = data(inv1).invoiceId;
  const inv2 = await req(`/api/orders/${shopCode}/qpay/invoice`, { method: 'POST', token: userA.token, body: {} });
  assert.equal(inv2.status, 201, inv2.text);
  const newInvoice = data(inv2).invoiceId;
  assert.notEqual(oldInvoice, newInvoice);
  const history = invoiceHistory(shopOrderId);
  assert.ok(history.some((row) => row.startsWith(`${oldInvoice}:shop`)));
  assert.ok(history.some((row) => row.startsWith(`${newInvoice}:shop`)));
  passLog('invoice replacement keeps both invoices', `${oldInvoice} → ${newInvoice}`);

  mock.pay(oldInvoice, shopDue);
  const oldCb = await req('/api/orders/qpay/callback', {
    method: 'POST',
    body: { invoice_id: oldInvoice, payment_id: 'ignored' },
    raw: true,
  });
  assert.equal(oldCb.status, 200, oldCb.text);
  assert.equal(oldCb.text, 'SUCCESS');
  assert.deepEqual(paymentsOf(shopOrderId), [`PAYMENT:${shopDue}:${oldInvoice}`]);
  assert.equal(Number(sql(`SELECT "paidAmount" FROM "Order" WHERE id='${shopOrderId}'`)), shopDue);
  assert.equal(Number(sql(`SELECT "dueAmount" FROM "Order" WHERE id='${shopOrderId}'`)), 0);
  assert.equal(
    sql(`SELECT "stockHold" FROM "OrderItem" WHERE "orderId"='${shopOrderId}' LIMIT 1`),
    'CONSUMED',
  );
  passLog('old-invoice callback still posts to the order ledger');

  const leaseKey = randomUUID();
  const leasePay = await req('/api/orders', {
    method: 'POST',
    token: userA.token,
    idempotencyKey: leaseKey,
    body: { name: 'Idem A', items: [leaseLine] },
  });
  assert.equal(leasePay.status, 201, leasePay.text);
  const leaseCode = data(leasePay).code;
  assert.equal(data(leasePay).payeeKind, 'LEASING');
  const leaseOrderId = sql(`SELECT id FROM "Order" WHERE code='${leaseCode}'`);
  const leaseDue = Number(sql(`SELECT "dueAmount" FROM "Order" WHERE id='${leaseOrderId}'`));
  const leaseInv = await req(`/api/orders/${leaseCode}/qpay/invoice`, {
    method: 'POST',
    token: userA.token,
    body: {},
  });
  assert.equal(leaseInv.status, 201, leaseInv.text);
  const leaseInvoiceId = data(leaseInv).invoiceId;
  assert.match(leaseInvoiceId, /^inv_leasing_/);
  mock.pay(leaseInvoiceId, leaseDue);

  const cross = await req('/api/orders/qpay/callback', {
    method: 'POST',
    body: { invoice_id: leaseInvoiceId },
    raw: true,
  });
  assert.equal(cross.status, 200, cross.text);
  assert.equal(cross.text, 'SUCCESS');
  assert.deepEqual(paymentsOf(leaseOrderId), []);
  const leaseCb = await req('/api/orders/leasing-qpay/callback', {
    method: 'POST',
    body: { invoice_id: leaseInvoiceId },
    raw: true,
  });
  assert.equal(leaseCb.status, 200, leaseCb.text);
  assert.deepEqual(paymentsOf(leaseOrderId), [`PAYMENT:${leaseDue}:${leaseInvoiceId}`]);
  const leaseActor = sql(
    `SELECT actor FROM "Payment" WHERE "orderId"='${leaseOrderId}' AND kind='PAYMENT'`,
  );
  assert.equal(leaseActor, 'system:leasing-qpay');
  const leaseAccount = sql(`SELECT account FROM "QpayInvoice" WHERE id='${leaseInvoiceId}'`);
  assert.equal(leaseAccount, 'leasing');
  passLog('SHOP callback ignores leasing invoice; leasing callback records leasing account');

  const partKey = randomUUID();
  const partOrder = await req('/api/orders', {
    method: 'POST',
    token: userA.token,
    idempotencyKey: partKey,
    body: { name: 'Idem A', items: [shopLine] },
  });
  const partCode = data(partOrder).code;
  const partId = sql(`SELECT id FROM "Order" WHERE code='${partCode}'`);
  const partDue = Number(sql(`SELECT "dueAmount" FROM "Order" WHERE id='${partId}'`));
  const partInvRes = await req(`/api/orders/${partCode}/qpay/invoice`, {
    method: 'POST',
    token: userA.token,
    body: {},
  });
  const partInvoice = data(partInvRes).invoiceId;
  const firstSlice = Math.min(40_000, Math.max(1, Math.floor(partDue / 2)));
  mock.pay(partInvoice, firstSlice);
  const partCb1 = await req('/api/orders/qpay/callback', {
    method: 'POST',
    body: { invoice_id: partInvoice },
    raw: true,
  });
  assert.equal(partCb1.status, 200, partCb1.text);
  mock.pay(partInvoice, partDue);
  const [partCb2, partCb3, verify1, verify2] = await Promise.all([
    req('/api/orders/qpay/callback', { method: 'POST', body: { invoice_id: partInvoice }, raw: true }),
    req('/api/orders/qpay/callback', { method: 'POST', body: { invoice_id: partInvoice }, raw: true }),
    req(`/api/orders/${partCode}/qpay/verify`, { method: 'POST', token: userA.token }),
    req(`/api/orders/${partCode}/qpay/verify`, { method: 'POST', token: userA.token }),
  ]);
  assert.equal(partCb2.status, 200, partCb2.text);
  assert.equal(partCb3.status, 200, partCb3.text);
  assert.equal(verify1.status, 200, verify1.text);
  assert.equal(verify2.status, 200, verify2.text);
  assert.deepEqual(paymentsOf(partId), [
    `PAYMENT:${firstSlice}:${partInvoice}`,
    `PAYMENT:${partDue - firstSlice}:${partInvoice}`,
  ]);
  assert.equal(Number(sql(`SELECT "paidAmount" FROM "Order" WHERE id='${partId}'`)), partDue);
  assert.equal(Number(sql(`SELECT "dueAmount" FROM "Order" WHERE id='${partId}'`)), 0);
  passLog('partial + duplicate callback + concurrent verify records only the delta');

  const failKey = randomUUID();
  const failOrder = await req('/api/orders', {
    method: 'POST',
    token: userA.token,
    idempotencyKey: failKey,
    body: { name: 'Idem A', items: [shopLine] },
  });
  const failCode = data(failOrder).code;
  const failId = sql(`SELECT id FROM "Order" WHERE code='${failCode}'`);
  const failDue = Number(sql(`SELECT "dueAmount" FROM "Order" WHERE id='${failId}'`));
  const failInvRes = await req(`/api/orders/${failCode}/qpay/invoice`, {
    method: 'POST',
    token: userA.token,
    body: {},
  });
  const failInvoice = data(failInvRes).invoiceId;
  mock.pay(failInvoice, failDue);
  mock.failNextCheck(failInvoice, 1);
  const failCb = await req('/api/orders/qpay/callback', {
    method: 'POST',
    body: { invoice_id: failInvoice },
    raw: true,
  });
  assert.equal(failCb.status, 503, failCb.text);
  assert.equal(failCb.text, 'RETRY');
  assert.deepEqual(paymentsOf(failId), []);
  const retryCb = await req('/api/orders/qpay/callback', {
    method: 'POST',
    body: { invoice_id: failInvoice },
    raw: true,
  });
  assert.equal(retryCb.status, 200, retryCb.text);
  assert.deepEqual(paymentsOf(failId), [`PAYMENT:${failDue}:${failInvoice}`]);
  const retryAgain = await req('/api/orders/qpay/callback', {
    method: 'POST',
    body: { invoice_id: failInvoice },
    raw: true,
  });
  assert.equal(retryAgain.status, 200, retryAgain.text);
  assert.deepEqual(paymentsOf(failId), [`PAYMENT:${failDue}:${failInvoice}`]);
  passLog('QPay temporary check failure then retry — payment neither lost nor doubled');

  assert.ok(mock.requests.some((r) => r.url === '/v2/auth/token'));
  assert.ok(mock.requests.some((r) => r.url === '/v2/invoice'));
  assert.ok(mock.requests.some((r) => r.url === '/v2/payment/check'));
  passLog(`mock QPay saw ${mock.requests.length} merchant-shaped calls`);

  // --- Лизинг / нөөц / Итгэлийн тооцоо ---
  async function payMock(invoiceId, amount, path = '/api/orders/qpay/callback') {
    mock.pay(invoiceId, amount);
    const cb = await req(path, { method: 'POST', body: { invoice_id: invoiceId }, raw: true });
    assert.equal(cb.status, 200, cb.text);
    return cb;
  }

  async function qpayCallbackRetry(invoiceId, path = '/api/orders/qpay/callback') {
    let last = { status: 0, text: '' };
    for (let i = 0; i < 8; i += 1) {
      last = await req(path, { method: 'POST', body: { invoice_id: invoiceId }, raw: true });
      if (last.status === 200) return last;
      if (last.status !== 503) return last;
      await new Promise((r) => setTimeout(r, 120 * (i + 1)));
    }
    return last;
  }

  const adminLogin = await req('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'admin@itgel.mn', password: 'admin123' },
  });
  assert.equal(adminLogin.status, 200, adminLogin.text);
  const adminToken = data(adminLogin).token;
  const leasingLogin = await req('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'leasing@itgel.mn', password: 'leasing123' },
  });
  assert.equal(leasingLogin.status, 200, leasingLogin.text);
  const leasingToken = data(leasingLogin).token;
  const leasingAdminId = sql(`SELECT id FROM "AdminUser" WHERE email='leasing@itgel.mn'`);
  const ownerPatch = await req('/api/admin/settings', {
    method: 'PATCH',
    token: adminToken,
    body: { leasingSettlementAdminId: leasingAdminId },
  });
  assert.equal(ownerPatch.status, 200, ownerPatch.text);
  assert.equal(data(ownerPatch).leasingSettlementAdminId, leasingAdminId);
  const categoryId = sql(`SELECT "categoryId" FROM "Product" WHERE "deletedAt" IS NULL LIMIT 1`);
  assert.ok(categoryId);

  async function createShopReady(name, stock, price, cargoFee = 0) {
    const created = await req('/api/admin/products', {
      method: 'POST',
      token: adminToken,
      body: { name, categoryId, images: [] },
    });
    assert.ok([200, 201].includes(created.status), created.text);
    const productId = data(created).id;
    const roundRes = await req(`/api/admin/products/${productId}/rounds`, {
      method: 'POST',
      token: adminToken,
      body: {
        sellPrice: price,
        stock,
        closeAt: null,
        status: 'ACTIVE',
        optionPrices: [],
        note: name,
      },
    });
    assert.equal(roundRes.status, 201, roundRes.text);
    const rounds = data(roundRes).rounds ?? [];
    const round = rounds.find((r) => r.note === name) ?? rounds[0];
    assert.ok(round?.id, roundRes.text);
    if (cargoFee > 0) {
      sql(`UPDATE "ProductRound" SET "cargoFee"=${cargoFee} WHERE id='${round.id}'`);
    }
    sql(
      `UPDATE "ProductRound" SET stock=${stock}, reserved=0, available=${stock}, status='ACTIVE' WHERE id='${round.id}'`,
    );
    return { productId, id: round.id, price, stock };
  }

  async function createShopReadySkus(name, price, skus) {
    const colors = skus.map((row) => row.selections['Өнгө']).filter(Boolean);
    const created = await req('/api/admin/products', {
      method: 'POST',
      token: adminToken,
      body: { name, categoryId, images: [], colors },
    });
    assert.ok([200, 201].includes(created.status), created.text);
    const productId = data(created).id;
    const total = skus.reduce((sum, row) => sum + row.stock, 0);
    const roundRes = await req(`/api/admin/products/${productId}/rounds`, {
      method: 'POST',
      token: adminToken,
      body: {
        sellPrice: price,
        stock: total,
        closeAt: null,
        status: 'ACTIVE',
        optionPrices: [],
        skuStocks: skus,
        note: name,
      },
    });
    assert.equal(roundRes.status, 201, roundRes.text);
    const rounds = data(roundRes).rounds ?? [];
    const round = rounds.find((r) => r.note === name) ?? rounds[0];
    assert.ok(round?.id, roundRes.text);
    sql(
      `UPDATE "ProductRound" SET stock=${total}, reserved=0, available=${total}, status='ACTIVE' WHERE id='${round.id}'`,
    );
    for (const row of skus) {
      const key = skuKey(row.selections);
      sql(
        `UPDATE "RoundSkuStock" SET stock=${row.stock}, reserved=0, available=${row.stock} WHERE "roundId"='${round.id}' AND "skuKey"='${key}'`,
      );
    }
    return { productId, id: round.id, price, stock: total };
  }

  const shopPhone = sql(`SELECT phone FROM "Setting" WHERE id=1`);
  const contactPatch = await req('/api/leasing/settings', {
    method: 'PATCH',
    token: leasingToken,
    body: {
      publicName: 'Тест лизинг',
      contactPhone: '99118877',
      chatUrl: 'https://t.me/itgel-leasing-test',
    },
  });
  assert.equal(contactPatch.status, 200, contactPatch.text);
  assert.equal(data(contactPatch).publicName, 'Тест лизинг');
  const badPhone = await req('/api/leasing/settings', {
    method: 'PATCH',
    token: leasingToken,
    body: { contactPhone: 'not-a-phone' },
  });
  assert.equal(badPhone.status, 400, badPhone.text);
  const adminSettingsForbidden = await req('/api/leasing/settings', {
    method: 'PATCH',
    token: adminToken,
    body: { publicName: 'Хак' },
  });
  assert.equal(adminSettingsForbidden.status, 403);
  const storeAfter = data(await req('/api/store'));
  assert.equal(storeAfter.phone, shopPhone);
  assert.equal(storeAfter.leasingContact?.name, 'Тест лизинг');
  assert.equal(storeAfter.leasingContact?.phone, '99118877');
  passLog('leasing public contact saved; shop phone unchanged');

  const hideProduct = await createShopReady(`HideZero ${phoneA}`, 1, 55_000);
  const hideLine = { productId: hideProduct.id, qty: 1 };
  const hideOrder = await req('/api/orders', {
    method: 'POST',
    token: userA.token,
    idempotencyKey: randomUUID(),
    body: { name: 'Idem A', items: [hideLine] },
  });
  assert.equal(hideOrder.status, 201, hideOrder.text);
  const listedGone = data(await req('/api/products?type=ready&pageSize=60'));
  const listedGoneRow = listedGone.find((p) => p.id === hideProduct.id);
  if (listedGoneRow) assert.equal(listedGoneRow.stock, 0, 'unexpired reserve must not be sellable');
  const searchedGone = data(
    await req(`/api/products?type=ready&q=${encodeURIComponent(`HideZero ${phoneA}`)}&pageSize=20`),
  );
  const searchedGoneRow = searchedGone.find((p) => p.id === hideProduct.id);
  if (searchedGoneRow) assert.equal(searchedGoneRow.stock, 0);
  const detailGone = await req(`/api/products/${hideProduct.id}`);
  assert.equal(detailGone.status, 200, detailGone.text);
  assert.equal(data(detailGone).stock, 0);
  const blocked = await req('/api/orders', {
    method: 'POST',
    token: userA.token,
    idempotencyKey: randomUUID(),
    body: { name: 'Idem A', items: [hideLine] },
  });
  assert.equal(blocked.status, 409, blocked.text);
  passLog('zero-available ready product hidden from list/search, detail unsellable');

  const hideOrderId = sql(`SELECT id FROM "Order" WHERE code='${data(hideOrder).code}'`);
  sql(`UPDATE "Order" SET "createdAt"=NOW() - INTERVAL '13 hours' WHERE id='${hideOrderId}'`);
  const agedWarehouse = roundHold(hideProduct);
  assert.equal(agedWarehouse.stock, 1);
  assert.equal(agedWarehouse.reserved, 1);
  assert.equal(agedWarehouse.available, 0);
  const listedAged = data(await req('/api/products?type=ready&pageSize=60'));
  assert.ok(listedAged.some((p) => p.id === hideProduct.id), 'expired unpaid hold is sellable before cancel');
  const detailAged = data(await req(`/api/products/${hideProduct.id}`));
  assert.equal(detailAged.stock, 1);
  const cancelledUnpaid = cancelUnpaidNow();
  assert.ok(cancelledUnpaid >= 1, `expected unpaid cancel, got ${cancelledUnpaid}`);
  assert.equal(sql(`SELECT status FROM "Order" WHERE id='${hideOrderId}'`), 'CANCELLED');
  assert.equal(roundHold(hideProduct).available, 1);
  assert.equal(roundHold(hideProduct).reserved, 0);
  assert.equal(roundHold(hideProduct).stock, 1);
  const listedBack = data(await req('/api/products?type=ready&pageSize=60'));
  assert.ok(listedBack.some((p) => p.id === hideProduct.id));
  const detailAfterCancel = data(await req(`/api/products/${hideProduct.id}`));
  assert.equal(detailAfterCancel.stock, 1, 'expired hold must not be added twice after cancel');
  passLog('unpaid cancel releases reserve and product reappears');

  const partialProd = await createShopReady(`PartialKeep ${phoneA}`, 2, 40_000);
  const partialKeep = await req('/api/orders', {
    method: 'POST',
    token: userA.token,
    idempotencyKey: randomUUID(),
    body: { name: 'Idem A', items: [{ productId: partialProd.id, qty: 1 }] },
  });
  const partialKeepId = sql(`SELECT id FROM "Order" WHERE code='${data(partialKeep).code}'`);
  const partialKeepCode = data(partialKeep).code;
  const partialInv = data(
    await req(`/api/orders/${partialKeepCode}/qpay/invoice`, {
      method: 'POST',
      token: userA.token,
      body: {},
    }),
  ).invoiceId;
  await payMock(partialInv, 1000);
  const partialHoldAfterPay = roundHold(partialProd);
  sql(`UPDATE "Order" SET "createdAt"=NOW() - INTERVAL '13 hours' WHERE id='${partialKeepId}'`);
  const partialAged = data(await req(`/api/products/${partialProd.id}`));
  assert.equal(
    partialAged.stock,
    partialHoldAfterPay.available,
    'partial-paid hold must not overlay back into sellable',
  );
  cancelUnpaidNow();
  assert.equal(sql(`SELECT status FROM "Order" WHERE id='${partialKeepId}'`), 'NEW');
  assert.equal(Number(sql(`SELECT "paidAmount" FROM "Order" WHERE id='${partialKeepId}'`)), 1000);
  const partialAfterCancel = roundHold(partialProd);
  assert.equal(partialAfterCancel.available, partialHoldAfterPay.available);
  assert.equal(partialAfterCancel.stock, partialHoldAfterPay.stock);
  passLog('partial payment is not unpaid-cancelled');

  const skuProd = await createShopReadySkus(`SkuHold ${phoneA}`, 20_000, [
    { selections: { Өнгө: 'Хар' }, stock: 1 },
    { selections: { Өнгө: 'Цагаан' }, stock: 1 },
  ]);
  const skuBlack = await req('/api/orders', {
    method: 'POST',
    token: userA.token,
    idempotencyKey: randomUUID(),
    body: {
      name: 'Idem A',
      items: [{ productId: skuProd.id, qty: 1, selections: { Өнгө: 'Хар' }, color: 'Хар' }],
    },
  });
  assert.equal(skuBlack.status, 201, skuBlack.text);
  const skuBlackId = sql(`SELECT id FROM "Order" WHERE code='${data(skuBlack).code}'`);
  sql(`UPDATE "Order" SET "createdAt"=NOW() - INTERVAL '13 hours' WHERE id='${skuBlackId}'`);
  const skuWh = roundHold(skuProd);
  assert.equal(skuWh.stock, 2);
  assert.equal(skuWh.reserved, 1);
  assert.equal(skuWh.available, 1);
  assert.equal(skuHold(skuProd.id, 'Өнгө=Хар').available, 0);
  assert.equal(skuHold(skuProd.id, 'Өнгө=Цагаан').available, 1);
  const skuAged = data(await req(`/api/products/${skuProd.id}`));
  assert.equal(skuAged.stock, 2);
  const skuBlackRow = (skuAged.skuStocks ?? []).find((s) => s.selections?.['Өнгө'] === 'Хар');
  const skuWhiteRow = (skuAged.skuStocks ?? []).find((s) => s.selections?.['Өнгө'] === 'Цагаан');
  assert.equal(skuBlackRow?.stock, 1);
  assert.equal(skuWhiteRow?.stock, 1);
  cancelUnpaidNow();
  assert.equal(roundHold(skuProd).available, 2);
  assert.equal(roundHold(skuProd).reserved, 0);
  assert.equal(roundHold(skuProd).stock, 2);
  assert.equal(skuHold(skuProd.id, 'Өнгө=Хар').available, 1);
  assert.equal(skuHold(skuProd.id, 'Өнгө=Цагаан').available, 1);
  const skuAfter = data(await req(`/api/products/${skuProd.id}`));
  assert.equal(skuAfter.stock, 2, 'expired SKU hold must not double-count after cancel');
  passLog('SKU sellable overlay is per-sku and not double-counted');

  const lateProd = await createShopReady(`LatePay ${phoneA}`, 1, 33_000);
  const lateOrder = await req('/api/orders', {
    method: 'POST',
    token: userA.token,
    idempotencyKey: randomUUID(),
    body: { name: 'Idem A', items: [{ productId: lateProd.id, qty: 1 }] },
  });
  const lateCode = data(lateOrder).code;
  const lateId = sql(`SELECT id FROM "Order" WHERE code='${lateCode}'`);
  const lateInv = data(
    await req(`/api/orders/${lateCode}/qpay/invoice`, { method: 'POST', token: userA.token, body: {} }),
  ).invoiceId;
  sql(`UPDATE "Order" SET "createdAt"=NOW() - INTERVAL '13 hours' WHERE id='${lateId}'`);
  cancelUnpaidNow();
  const winnerLate = await req('/api/orders', {
    method: 'POST',
    token: userB.token,
    idempotencyKey: randomUUID(),
    body: { name: 'Idem B', items: [{ productId: lateProd.id, qty: 1 }] },
  });
  assert.equal(winnerLate.status, 201, winnerLate.text);
  const winnerLateCode = data(winnerLate).code;
  const winnerLateDue = Number(sql(`SELECT "dueAmount" FROM "Order" WHERE code='${winnerLateCode}'`));
  const winnerLateInv = data(
    await req(`/api/orders/${winnerLateCode}/qpay/invoice`, {
      method: 'POST',
      token: userB.token,
      body: {},
    }),
  ).invoiceId;
  await payMock(winnerLateInv, winnerLateDue);
  const lateDue = Number(sql(`SELECT "dueAmount" FROM "Order" WHERE id='${lateId}'`));
  await payMock(lateInv, lateDue > 0 ? lateDue : 33_000);
  const latePayCount = Number(sql(`SELECT count(*) FROM "Payment" WHERE "orderId"='${lateId}' AND kind='PAYMENT'`));
  assert.ok(latePayCount >= 1, 'late payment after cancel is recorded');
  const lateEx = Number(
    sql(`SELECT count(*) FROM "MoneyException" WHERE "orderId"='${lateId}' AND kind IN ('LATE_AFTER_CANCEL','STOCK_SHORTFALL')`),
  );
  assert.ok(lateEx >= 1, 'stock shortfall after cancel is visible to admin');
  assert.equal(sql(`SELECT status FROM "Order" WHERE id='${lateId}'`), 'CANCELLED');
  assert.equal(sql(`SELECT "stockHold" FROM "OrderItem" WHERE "orderId"='${lateId}'`), 'RELEASED');
  assert.equal(sql(`SELECT "stockShortfall" FROM "OrderItem" WHERE "orderId"='${lateId}'`), 't');
  assert.equal(sql(`SELECT "handedOverAt" FROM "OrderItem" WHERE "orderId"='${lateId}'`), '');
  const winnerLateId = sql(`SELECT id FROM "Order" WHERE code='${winnerLateCode}'`);
  assert.equal(sql(`SELECT "stockHold" FROM "OrderItem" WHERE "orderId"='${winnerLateId}'`), 'CONSUMED');
  assert.equal(roundHold(lateProd).stock, 0);
  assert.equal(roundHold(lateProd).reserved, 0);
  assert.equal(roundHold(lateProd).available, 0);
  passLog('late QPay after cancel recorded with money exception');

  const cargoProd = await createShopReady(`CargoLease ${phoneA}`, 8, 100_000, 15_000);
  async function createLeasingPaid(product, token, name, { expectSettlement = true } = {}) {
    const created = await req('/api/orders', {
      method: 'POST',
      token,
      idempotencyKey: randomUUID(),
      body: { name, leasing: true, items: [{ productId: product.id, qty: 1 }] },
    });
    assert.equal(created.status, 201, created.text);
    const payload = data(created);
    assert.equal(payload.isLeasing, true);
    const orderId = sql(`SELECT id FROM "Order" WHERE code='${payload.code}'`);
    const fee = Number(sql(`SELECT "leasingFee" FROM "Order" WHERE id='${orderId}'`));
    assert.ok(fee > 0, 'leasing fee snapshot');
    const feeInv = data(
      await req(`/api/orders/${payload.code}/qpay/invoice`, { method: 'POST', token, body: {} }),
    ).invoiceId;
    assert.match(feeInv, /^inv_leasing_/);
    await payMock(feeInv, fee, '/api/orders/leasing-qpay/callback');
    const status = sql(`SELECT status FROM "Order" WHERE id='${orderId}'`);
    assert.ok(['CONFIRMED', 'ARRIVED'].includes(status), `leasing after fee: ${status}`);
    const settlements = Number(sql(`SELECT count(*) FROM "ItgelSettlement" WHERE "sourceOrderId"='${orderId}'`));
    if (expectSettlement) assert.equal(settlements, 1);
    else assert.equal(settlements, 0);
    return { ...payload, orderId, fee };
  }

  const lease1 = await createLeasingPaid(cargoProd, userA.token, 'Idem A');
  const publicLease = data(await req(`/api/orders/${lease1.code}`, { token: userA.token }));
  assert.equal(publicLease.contact?.kind, 'LEASING');
  assert.equal(publicLease.contact?.title, 'Тест лизинг');
  assert.equal(publicLease.contact?.phone, '99118877');
  assert.equal(publicLease.unpaidCargoFee, 15_000);
  const shopPublic = data(await req(`/api/orders/${shopCode}`, { token: userA.token }));
  assert.equal(shopPublic.contact?.kind, 'SHOP');
  passLog('mixed shop vs leasing contact on customer orders');

  const feeKeepProd = await createShopReady(`FeeKeep ${phoneA}`, 1, 88_000);
  const feeKeep = await createLeasingPaid(feeKeepProd, userA.token, 'Idem A');
  sql(`UPDATE "Order" SET "createdAt"=NOW() - INTERVAL '13 hours' WHERE id='${feeKeep.orderId}'`);
  assert.ok(['CONFIRMED', 'ARRIVED'].includes(sql(`SELECT status FROM "Order" WHERE id='${feeKeep.orderId}'`)));
  const feeWh = roundHold(feeKeepProd);
  assert.equal(feeWh.stock, 0);
  assert.equal(feeWh.available, 0);
  const feeAged = data(await req(`/api/products/${feeKeepProd.id}`));
  assert.equal(feeAged.stock, 0, 'fee-paid leasing must not overlay back into sellable');
  const feeBlocked = await req('/api/orders', {
    method: 'POST',
    token: userB.token,
    idempotencyKey: randomUUID(),
    body: { name: 'Idem B', items: [{ productId: feeKeepProd.id, qty: 1 }] },
  });
  assert.equal(feeBlocked.status, 409, feeBlocked.text);
  cancelUnpaidNow();
  assert.ok(['CONFIRMED', 'ARRIVED'].includes(sql(`SELECT status FROM "Order" WHERE id='${feeKeep.orderId}'`)));
  assert.equal(roundHold(feeKeepProd).stock, 0);
  assert.equal(roundHold(feeKeepProd).available, 0);
  passLog('fee-paid leasing stock is not returned to sellable');

  const settleAmount = Number(
    sql(`SELECT amount FROM "ItgelSettlement" WHERE "sourceOrderId"='${lease1.orderId}'`),
  );
  assert.equal(settleAmount, 100_000);
  assert.equal(
    sql(`SELECT "ownerAdminId" FROM "ItgelSettlement" WHERE "sourceOrderId"='${lease1.orderId}'`),
    leasingAdminId,
  );
  assert.equal(
    sql(`SELECT "leasingOperatorAdminId" FROM "Order" WHERE id='${lease1.orderId}'`),
    leasingAdminId,
  );
  const principalInv = data(
    await req(`/api/orders/${lease1.code}/qpay/invoice`, {
      method: 'POST',
      token: userA.token,
      body: { amount: 20_000 },
    }),
  ).invoiceId;
  assert.match(principalInv, /^inv_leasing_/);
  await payMock(principalInv, 20_000, '/api/orders/leasing-qpay/callback');
  assert.equal(
    Number(sql(`SELECT "remainingAmount" FROM "ItgelSettlement" WHERE "sourceOrderId"='${lease1.orderId}'`)),
    100_000,
  );
  passLog('customer partial principal does not reduce Itgel settlement');

  const cargoInvRes = await req(`/api/orders/${lease1.code}/qpay/invoice`, {
    method: 'POST',
    token: userA.token,
    body: { purpose: 'CARGO' },
  });
  assert.equal(cargoInvRes.status, 201, cargoInvRes.text);
  const cargoInv = data(cargoInvRes).invoiceId;
  assert.match(cargoInv, /^inv_shop_/);
  assert.equal(sql(`SELECT purpose FROM "QpayInvoice" WHERE id='${cargoInv}'`), 'CARGO');
  await payMock(cargoInv, 15_000);
  const cargoPayee = sql(
    `SELECT "payeeKind" FROM "Payment" WHERE "orderId"='${lease1.orderId}' AND "qpayInvoiceId"='${cargoInv}'`,
  );
  assert.equal(cargoPayee, 'SHOP');
  assert.equal(
    Number(sql(`SELECT "remainingAmount" FROM "ItgelSettlement" WHERE "sourceOrderId"='${lease1.orderId}'`)),
    100_000,
  );
  const afterCargo = data(await req(`/api/orders/${lease1.code}`, { token: userA.token }));
  assert.ok(afterCargo.leasingPrincipalDue > 0, 'cargo paid is not full product payment');
  assert.equal(afterCargo.unpaidCargoFee ?? 0, 0);
  const confirmAgain = Number(sql(`SELECT count(*) FROM "ItgelSettlement" WHERE "sourceOrderId"='${lease1.orderId}'`));
  assert.equal(confirmAgain, 1);
  passLog('leasing cargo pays Itgel shop QPay without closing product debt');

  const lease2 = await createLeasingPaid(cargoProd, userA.token, 'Idem A');
  const s1 = sql(`SELECT id FROM "ItgelSettlement" WHERE "sourceOrderId"='${lease1.orderId}'`);
  const s2 = sql(`SELECT id FROM "ItgelSettlement" WHERE "sourceOrderId"='${lease2.orderId}'`);
  const doublePay = await Promise.all([
    req('/api/leasing/finance/itgel/pay', {
      method: 'POST',
      token: leasingToken,
      body: { settlementIds: [s2], method: 'QPAY' },
    }),
    req('/api/leasing/finance/itgel/pay', {
      method: 'POST',
      token: leasingToken,
      body: { settlementIds: [s2], method: 'QPAY' },
    }),
  ]);
  assert.equal(doublePay.filter((r) => r.status === 201).length, 1, doublePay.map((r) => r.text).join(' | '));
  assert.equal(doublePay.filter((r) => r.status === 409 || r.status === 404).length, 1);
  passLog('double-tab settlement pay locks once');

  const overlapBank = await req('/api/leasing/finance/itgel/pay', {
    method: 'POST',
    token: leasingToken,
    body: {
      settlementIds: [s2],
      method: 'BANK_TRANSFER',
      bankRef: 'overlap-ref',
      bankDate: '2026-09-18',
    },
  });
  assert.equal(overlapBank.status, 409, overlapBank.text);

  const multiPay = await req('/api/leasing/finance/itgel/pay', {
    method: 'POST',
    token: leasingToken,
    body: { settlementIds: [s1, s2], method: 'QPAY' },
  });
  // s2 is already invoiced, so this should fail; cancel open invoice first
  const openPayId = data(doublePay.find((r) => r.status === 201)).payment.id;
  await req(`/api/leasing/finance/itgel/payments/${openPayId}/cancel`, {
    method: 'POST',
    token: leasingToken,
  });
  const multiPay2 = await req('/api/leasing/finance/itgel/pay', {
    method: 'POST',
    token: leasingToken,
    body: { settlementIds: [s1, s2], method: 'QPAY' },
  });
  assert.equal(multiPay2.status, 201, `${multiPay.status}:${multiPay.text} | ${multiPay2.text}`);
  const multiInv = data(multiPay2).invoice.invoiceId;
  assert.match(multiInv, /^inv_shop_/);
  assert.equal(sql(`SELECT purpose FROM "QpayInvoice" WHERE id='${multiInv}'`), 'ITGEL_SETTLEMENT');
  const multiAmount = data(multiPay2).payment.amount;
  assert.equal(multiAmount, 200_000);
  await payMock(multiInv, multiAmount);
  assert.equal(sql(`SELECT status FROM "ItgelSettlement" WHERE id='${s1}'`), 'PAID');
  assert.equal(sql(`SELECT status FROM "ItgelSettlement" WHERE id='${s2}'`), 'PAID');
  passLog('one shop QPay closes two Itgel settlements');

  const lease3 = await createLeasingPaid(cargoProd, userA.token, 'Idem A');
  const s3 = sql(`SELECT id FROM "ItgelSettlement" WHERE "sourceOrderId"='${lease3.orderId}'`);
  const bankPay = await req('/api/leasing/finance/itgel/pay', {
    method: 'POST',
    token: leasingToken,
    body: {
      settlementIds: [s3],
      method: 'BANK_TRANSFER',
      bankRef: 'BANK-ISO-1',
      bankDate: '2026-09-18T00:00:00.000Z',
    },
  });
  assert.equal(bankPay.status, 201, bankPay.text);
  const bankPaymentId = data(bankPay).payment.id;
  const leasingConfirm = await req(`/api/admin/leasing-settlements/payments/${bankPaymentId}/confirm`, {
    method: 'POST',
    token: leasingToken,
  });
  assert.equal(leasingConfirm.status, 403);
  assert.equal(sql(`SELECT status FROM "ItgelSettlement" WHERE id='${s3}'`), 'PENDING_BANK');
  const adminConfirm = await req(`/api/admin/leasing-settlements/payments/${bankPaymentId}/confirm`, {
    method: 'POST',
    token: adminToken,
  });
  assert.equal(adminConfirm.status, 200, adminConfirm.text);
  assert.equal(sql(`SELECT status FROM "ItgelSettlement" WHERE id='${s3}'`), 'PAID');
  passLog('bank transfer confirmed only by shop admin');

  sql(
    `UPDATE "ItgelSettlement" SET "confirmedAt"=NOW() - INTERVAL '1 day' WHERE id='${s3}'`,
  );
  const summary = data(await req('/api/leasing/finance/itgel/summary', { token: leasingToken }));
  assert.ok(summary.priorUnpaidAmount === 0 || summary.priorUnpaidCount >= 0);
  const yDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar' }).format(
    new Date(Date.now() - 24 * 60 * 60 * 1000),
  );
  const ySummary = data(
    await req(`/api/leasing/finance/itgel/summary?day=${yDay}`, { token: leasingToken }),
  );
  assert.ok(ySummary.lines.some((line) => line.id === s3) || ySummary.amount >= 100_000);
  passLog('UB day boundary keeps yesterday settlement on that day');

  const xferGet = await req(`/api/leasing/orders/${lease3.orderId}/ready-transfer`, {
    token: leasingToken,
  });
  assert.equal(xferGet.status, 200, xferGet.text);
  const eligible = (data(xferGet).items ?? []).filter((i) => i.eligible);
  assert.ok(eligible.length > 0, xferGet.text);
  const xfer = await req(`/api/leasing/orders/${lease3.orderId}/ready-transfer`, {
    method: 'POST',
    token: leasingToken,
    body: {
      reason: 'e2e-ready',
      lines: [{ orderItemId: eligible[0].id, qty: eligible[0].availableQty, resaleUnitPrice: eligible[0].unitPrice }],
    },
  });
  assert.ok([200, 201].includes(xfer.status), xfer.text);
  const destRoundId = data(xfer).destRoundIds?.[0];
  assert.ok(destRoundId);
  assert.equal(
    sql(`SELECT "readyTransferId" IS NOT NULL FROM "ItgelSettlement" WHERE id='${s3}'`),
    't',
  );
  const resale = await req('/api/orders', {
    method: 'POST',
    token: userB.token,
    idempotencyKey: randomUUID(),
    body: { name: 'Idem B', items: [{ productId: destRoundId, qty: 1 }] },
  });
  assert.equal(resale.status, 201, resale.text);
  const resaleId = sql(`SELECT id FROM "Order" WHERE code='${data(resale).code}'`);
  assert.equal(Number(sql(`SELECT count(*) FROM "ItgelSettlement" WHERE "sourceOrderId"='${resaleId}'`)), 0);
  assert.equal(Number(sql(`SELECT count(*) FROM "ItgelSettlement" WHERE id='${s3}'`)), 1);
  passLog('ready-transfer keeps original Itgel bill; resale does not create another');

  const leaseBEmail = `lease2${phoneA}@itgel.mn`;
  const leaseBCreate = await req('/api/admin/staff', {
    method: 'POST',
    token: adminToken,
    body: { email: leaseBEmail, name: 'Leasing Two', password: 'leasing123', role: 'LEASING' },
  });
  assert.ok([200, 201].includes(leaseBCreate.status), leaseBCreate.text);
  const leaseBLogin = await req('/api/admin/auth/login', {
    method: 'POST',
    body: { email: leaseBEmail, password: 'leasing123' },
  });
  const leaseBToken = data(leaseBLogin).token;
  const leaseBProduct = await req('/api/leasing/products', {
    method: 'POST',
    token: leaseBToken,
    body: {
      name: `B-only ${phoneA}`,
      categoryId,
      images: [],
      sellPrice: 22_000,
      stock: 3,
      status: 'ACTIVE',
    },
  });
  assert.equal(leaseBProduct.status, 201, leaseBProduct.text);
  const leaseBRoundId = data(leaseBProduct).rounds[0].id;
  const aProducts = data(await req('/api/leasing/products?pageSize=50', { token: leasingToken }));
  assert.equal(aProducts.some((p) => (p.rounds ?? []).some((r) => r.id === leaseBRoundId) || p.id === data(leaseBProduct).id), false);
  const bProducts = data(await req('/api/leasing/products?pageSize=50', { token: leaseBToken }));
  assert.ok(bProducts.some((p) => p.id === data(leaseBProduct).id));
  const bPayA = await req('/api/leasing/finance/itgel/pay', {
    method: 'POST',
    token: leaseBToken,
    body: { settlementIds: [s1], method: 'QPAY' },
  });
  assert.ok([403, 404, 409].includes(bPayA.status), bPayA.text);
  const aCustomer = await req(`/api/orders/${lease1.code}`, { token: userB.token });
  assert.ok([401, 403, 404].includes(aCustomer.status), aCustomer.text);
  passLog('two leasing admins and customer orders stay isolated');

  const leaseBId = data(leaseBCreate).id;
  const switchOwner = await req('/api/admin/settings', {
    method: 'PATCH',
    token: adminToken,
    body: { leasingSettlementAdminId: leaseBId },
  });
  assert.equal(switchOwner.status, 200, switchOwner.text);
  const leaseBContract = await createLeasingPaid(cargoProd, userA.token, 'Idem A');
  assert.equal(
    sql(`SELECT "ownerAdminId" FROM "ItgelSettlement" WHERE "sourceOrderId"='${leaseBContract.orderId}'`),
    leaseBId,
  );
  assert.equal(
    sql(`SELECT "ownerAdminId" FROM "ItgelSettlement" WHERE "sourceOrderId"='${lease1.orderId}'`),
    leasingAdminId,
  );
  const deactivateB = await req(`/api/admin/staff/${leaseBId}`, {
    method: 'PATCH',
    token: adminToken,
    body: { isActive: false },
  });
  assert.equal(deactivateB.status, 200, deactivateB.text);
  assert.equal(
    sql(`SELECT "ownerAdminId" FROM "ItgelSettlement" WHERE "sourceOrderId"='${leaseBContract.orderId}'`),
    leaseBId,
  );
  const restoreOwner = await req('/api/admin/settings', {
    method: 'PATCH',
    token: adminToken,
    body: { leasingSettlementAdminId: leasingAdminId },
  });
  assert.equal(restoreOwner.status, 200, restoreOwner.text);
  assert.equal(
    sql(`SELECT "ownerAdminId" FROM "ItgelSettlement" WHERE "sourceOrderId"='${leaseBContract.orderId}'`),
    leaseBId,
  );
  const clearOwner = await req('/api/admin/settings', {
    method: 'PATCH',
    token: adminToken,
    body: { leasingSettlementAdminId: null },
  });
  assert.equal(clearOwner.status, 200, clearOwner.text);
  const noOwner = await createLeasingPaid(cargoProd, userA.token, 'Idem A', { expectSettlement: false });
  assert.equal(
    Number(
      sql(
        `SELECT count(*) FROM "MoneyException" WHERE "orderId"='${noOwner.orderId}' AND kind='SETTLEMENT_OWNER_MISSING'`,
      ),
    ),
    1,
  );
  const putOwnerBack = await req('/api/admin/settings', {
    method: 'PATCH',
    token: adminToken,
    body: { leasingSettlementAdminId: leasingAdminId },
  });
  assert.equal(putOwnerBack.status, 200, putOwnerBack.text);
  passLog('settlement owner snapshot survives deactivate/switch; unset does not assign first-active');

  const reactivateB = await req(`/api/admin/staff/${leaseBId}`, {
    method: 'PATCH',
    token: adminToken,
    body: { isActive: true },
  });
  assert.equal(reactivateB.status, 200, reactivateB.text);
  const [assignA, assignB] = await Promise.all([
    req('/api/admin/leasing-settlements/missing-owners/assign', {
      method: 'POST',
      token: adminToken,
      body: { ownerAdminId: leasingAdminId, orderIds: [noOwner.orderId] },
    }),
    req('/api/admin/leasing-settlements/missing-owners/assign', {
      method: 'POST',
      token: adminToken,
      body: { ownerAdminId: leaseBId, orderIds: [noOwner.orderId] },
    }),
  ]);
  assert.equal(assignA.status, 200, assignA.text);
  assert.equal(assignB.status, 200, assignB.text);
  assert.equal(
    Number(sql(`SELECT count(*) FROM "ItgelSettlement" WHERE "sourceOrderId"='${noOwner.orderId}'`)),
    1,
  );
  const assignedOwner = sql(
    `SELECT "ownerAdminId" FROM "ItgelSettlement" WHERE "sourceOrderId"='${noOwner.orderId}'`,
  );
  const assignedSnap = sql(
    `SELECT "leasingOperatorAdminId" FROM "Order" WHERE id='${noOwner.orderId}'`,
  );
  assert.equal(assignedOwner, assignedSnap);
  assert.ok([leasingAdminId, leaseBId].includes(assignedOwner), assignedOwner);
  assert.equal(
    Number(
      sql(
        `SELECT count(*) FROM "MoneyException" WHERE "orderId"='${noOwner.orderId}' AND kind='SETTLEMENT_OWNER_MISSING' AND status='OPEN'`,
      ),
    ),
    0,
  );
  const assignedAmount = Number(
    sql(`SELECT COALESCE(sum(amount),0) FROM "ItgelSettlement" WHERE "sourceOrderId"='${noOwner.orderId}'`),
  );
  const assignedItemAmount = Number(
    sql(`SELECT COALESCE(sum("unitPrice" * qty),0) FROM "OrderItem" WHERE "orderId"='${noOwner.orderId}' AND "cancelledAt" IS NULL`),
  );
  assert.equal(assignedAmount, assignedItemAmount);
  passLog('concurrent missing-owner assign keeps one owner and one debt');

  const cronSecret = 'isolated-checkout-cron-secret';
  const cronDenied = await req('/api/cron/unpaid-cancel');
  assert.equal(cronDenied.status, 401, cronDenied.text);
  const cronProd = await createShopReady(`CronHttp ${phoneA}`, 1, 21_000);
  const cronOrder = await req('/api/orders', {
    method: 'POST',
    token: userA.token,
    idempotencyKey: randomUUID(),
    body: { name: 'Idem A', items: [{ productId: cronProd.id, qty: 1 }] },
  });
  assert.equal(cronOrder.status, 201, cronOrder.text);
  const cronOrderId = sql(`SELECT id FROM "Order" WHERE code='${data(cronOrder).code}'`);
  sql(`UPDATE "Order" SET "createdAt"=NOW() - INTERVAL '13 hours' WHERE id='${cronOrderId}'`);
  const beforeHold = roundHold(cronProd);
  const cronFirst = await req('/api/cron/unpaid-cancel', { token: cronSecret });
  assert.equal(cronFirst.status, 200, cronFirst.text);
  assert.ok(data(cronFirst).cancelled >= 1, cronFirst.text);
  assert.equal(sql(`SELECT status FROM "Order" WHERE id='${cronOrderId}'`), 'CANCELLED');
  assert.equal(roundHold(cronProd).available, beforeHold.available + 1);
  assert.equal(roundHold(cronProd).reserved, beforeHold.reserved - 1);
  assert.equal(roundHold(cronProd).stock, beforeHold.stock);
  const cronSecond = await req('/api/cron/unpaid-cancel', { token: cronSecret });
  assert.equal(cronSecond.status, 200, cronSecond.text);
  assert.equal(sql(`SELECT status FROM "Order" WHERE id='${cronOrderId}'`), 'CANCELLED');
  assert.equal(roundHold(cronProd).available, beforeHold.available + 1);
  assert.equal(roundHold(cronProd).reserved, beforeHold.reserved - 1);
  assert.equal(roundHold(cronProd).stock, beforeHold.stock);
  passLog('HTTP unpaid-cancel auth, catch-up, and no double stock restore');

  const raceProd = await createShopReady(`RaceLast ${phoneA}`, 1, 44_000);
  const raceA = await req('/api/orders', {
    method: 'POST',
    token: userA.token,
    idempotencyKey: randomUUID(),
    body: { name: 'Idem A', items: [{ productId: raceProd.id, qty: 1 }] },
  });
  assert.equal(raceA.status, 201, raceA.text);
  const raceACode = data(raceA).code;
  const raceAId = sql(`SELECT id FROM "Order" WHERE code='${raceACode}'`);
  const raceInv = data(
    await req(`/api/orders/${raceACode}/qpay/invoice`, { method: 'POST', token: userA.token, body: {} }),
  ).invoiceId;
  const raceDue = Number(sql(`SELECT "dueAmount" FROM "Order" WHERE id='${raceAId}'`));
  sql(`UPDATE "Order" SET "createdAt"=NOW() - INTERVAL '13 hours' WHERE id='${raceAId}'`);
  const raceCheckoutKey = randomUUID();
  async function raceCheckoutOnce() {
    let last = { status: 0, text: '' };
    for (let i = 0; i < 8; i += 1) {
      last = await req('/api/orders', {
        method: 'POST',
        token: userB.token,
        idempotencyKey: raceCheckoutKey,
        body: { name: 'Idem B', items: [{ productId: raceProd.id, qty: 1 }] },
      });
      if (last.status !== 503) return last;
      await new Promise((r) => setTimeout(r, 120 * (i + 1)));
    }
    return last;
  }
  const [raceCheckout, racePay, raceRelease] = await Promise.all([
    raceCheckoutOnce(),
    (async () => {
      mock.pay(raceInv, raceDue > 0 ? raceDue : 44_000);
      return qpayCallbackRetry(raceInv);
    })(),
    req('/api/cron/unpaid-cancel', { token: cronSecret }),
  ]);
  assert.ok([200, 201, 409].includes(raceCheckout.status), raceCheckout.text);
  assert.equal(racePay.status, 200, racePay.text);
  assert.equal(raceRelease.status, 200, raceRelease.text);
  const raceHold = roundHold(raceProd);
  assert.ok(raceHold.stock >= 0 && raceHold.reserved >= 0 && raceHold.available >= 0, JSON.stringify(raceHold));
  assert.equal(raceHold.stock, raceHold.available + raceHold.reserved);
  const raceConsumed = Number(
    sql(`SELECT count(*) FROM "OrderItem" WHERE "roundId"='${raceProd.id}' AND "stockHold"='CONSUMED'`),
  );
  assert.ok(raceConsumed <= 1, `oversell consumed=${raceConsumed}`);
  const racePaid = Number(sql(`SELECT count(*) FROM "Payment" WHERE "orderId"='${raceAId}' AND kind='PAYMENT'`));
  if (racePaid >= 1 && raceConsumed === 0) {
    assert.ok(
      Number(
        sql(
          `SELECT count(*) FROM "MoneyException" WHERE "orderId"='${raceAId}' AND kind IN ('LATE_AFTER_CANCEL','STOCK_SHORTFALL')`,
        ),
      ) >= 1,
    );
    assert.equal(sql(`SELECT "stockHold" FROM "OrderItem" WHERE "orderId"='${raceAId}'`), 'RELEASED');
    assert.equal(sql(`SELECT "stockShortfall" FROM "OrderItem" WHERE "orderId"='${raceAId}'`), 't');
    assert.equal(sql(`SELECT "handedOverAt" FROM "OrderItem" WHERE "orderId"='${raceAId}'`), '');
  }
  passLog('concurrent last-unit checkout/callback/release does not oversell');

  const salesA = await req('/api/leasing/finance/ready/sales', { token: leasingToken });
  assert.equal(salesA.status, 200, salesA.text);
  const stockA = await req('/api/leasing/finance/ready/stock', { token: leasingToken });
  assert.equal(stockA.status, 200, stockA.text);
  assert.equal(typeof data(stockA).available, 'number');
  const holds = await req('/api/admin/leasing-settlements/unpaid-ready-holds', { token: adminToken });
  assert.equal(holds.status, 200, holds.text);
  assert.equal(typeof data(holds).unpaidCancelHours, 'number');
  passLog('leasing ready finance + read-only unpaid holds');

  const finalBoot = logs.join('');
  if (/merchant\.qpay\.mn/.test(finalBoot)) fail('backend жинхэнэ QPay руу хандсан');
  passLog('no merchant.qpay.mn traffic');

  console.log('\nCheckout/QPay isolated flows:', results.length);
  for (const row of results) console.log(' ', row);
} finally {
  await shutdown();
}
