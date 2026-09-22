#!/usr/bin/env node
/**
 * HEAD (474bc27) vs working tree — same local docker Postgres, same leasing user.
 * Production / merchant.qpay.mn / SMS руу явахгүй.
 *
 *   LATENCY_BEFORE_ROOT=/path/to/worktree KEEP_SERVERS=1 node tests/e2e/leasing-compare.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOtpWorkspace } from './otpWorkspace.mjs';

const AFTER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BEFORE_ROOT = process.env.LATENCY_BEFORE_ROOT;
const LOCAL_DB = 'postgresql://itgel:itgel@127.0.0.1:5432/itgel';
const AFTER_PORT = Number(process.env.LATENCY_AFTER_PORT ?? 4016);
const BEFORE_PORT = Number(process.env.LATENCY_BEFORE_PORT ?? 4017);
const MOCK_PORT = Number(process.env.LATENCY_MOCK_PORT ?? 4096);
const ORIGIN = process.env.LATENCY_ORIGIN ?? 'http://127.0.0.1:3015';
const REPEAT = 7;
const OUT_PATH = process.env.LATENCY_OUT ?? '/tmp/itgel-latency-compare.json';

if (!BEFORE_ROOT) {
  console.error('LATENCY_BEFORE_ROOT заагаагүй.');
  process.exit(1);
}
if (process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) {
  console.error('DATABASE_URL локал биш — зогсоов.');
  process.exit(1);
}

function sql(query) {
  return execFileSync(
    'docker',
    ['exec', 'itgel-db', 'psql', '-U', 'itgel', '-d', 'itgel', '-At', '-c', query],
    { encoding: 'utf8' },
  ).trim();
}

function isolatedEnv(port, extra = {}) {
  return {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    DATABASE_URL: LOCAL_DB,
    DIRECT_URL: LOCAL_DB,
    JWT_SECRET: 'isolated-leasing-latency',
    CRON_ENABLED: 'false',
    CRON_SECRET: 'isolated-latency-cron',
    SMS_PROVIDER: 'console',
    SHOP_SMS_PROVIDER: 'console',
    STORAGE_PROVIDER: 'mock',
    CORS_ORIGIN: '*',
    PRISMA_QUERY_TIMING: '1',
    QPAY_ENABLED: 'true',
    QPAY_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v2`,
    QPAY_USERNAME: 'shop-test',
    QPAY_PASSWORD: 'shop-secret',
    QPAY_INVOICE_CODE: 'SHOP_TEST_INVOICE',
    QPAY_CALLBACK_URL: `http://127.0.0.1:${port}/api/orders/qpay/callback`,
    SETTLEMENT_QPAY_TIMEOUT_MS: '8000',
    LEASING_QPAY_ENABLED: 'true',
    LEASING_QPAY_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v2`,
    LEASING_QPAY_CLIENT_ID: 'leasing-test',
    LEASING_QPAY_CLIENT_SECRET: 'leasing-secret',
    LEASING_QPAY_INVOICE_CODE: 'LEASING_TEST_INVOICE',
    LEASING_QPAY_CALLBACK_URL: `http://127.0.0.1:${port}/api/orders/leasing-qpay/callback`,
    SUPABASE_URL: '',
    SUPABASE_PUBLISHABLE_KEY: '',
    SUPABASE_SECRET_KEY: '',
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    R2_ENDPOINT: '',
    R2_ACCESS_KEY_ID: '',
    R2_SECRET_ACCESS_KEY: '',
    ...extra,
  };
}

function startMockQpay() {
  const invoices = new Map();
  const invoicesBySender = new Map();
  let seq = 0;
  let invoiceCreateDelayMs = 0;
  const requests = [];
  const server = createServer(async (req, res) => {
    const url = req.url ?? '';
    const started = Date.now();
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }
    if (req.method === 'POST' && url === '/v2/invoice' && invoiceCreateDelayMs > 0) {
      await new Promise((r) => setTimeout(r, invoiceCreateDelayMs));
    }
    const send = (status, data) => {
      requests.push({ method: req.method, url, ms: Date.now() - started, status });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (req.method === 'POST' && url === '/v2/auth/token') {
      send(200, { access_token: 'mock-shop', expires_in: 3600 });
      return;
    }
    if (req.method === 'POST' && url === '/v2/invoice') {
      const id = `inv_${++seq}`;
      const invoice = {
        invoice_id: id,
        qr_text: `qr:${id}`,
        qr_image: null,
        urls: [],
        amount: Number(body.amount ?? 0),
        sender_invoice_no: body.sender_invoice_no ?? null,
      };
      invoices.set(id, invoice);
      if (body.sender_invoice_no) invoicesBySender.set(String(body.sender_invoice_no), id);
      send(200, invoice);
      return;
    }
    if (req.method === 'POST' && url === '/v2/invoice/list') {
      const sender = String(body.sender_invoice_no ?? '');
      const id = invoicesBySender.get(sender);
      send(200, {
        count: id ? 1 : 0,
        rows: id
          ? [{ invoice_id: id, sender_invoice_no: sender, amount: invoices.get(id)?.amount, invoice_status: 'OPEN' }]
          : [],
      });
      return;
    }
    const getInv = url.match(/^\/v2\/invoice\/([^/]+)$/);
    if (req.method === 'GET' && getInv) {
      const inv = invoices.get(decodeURIComponent(getInv[1]));
      if (!inv) {
        send(404, { message: 'not found' });
        return;
      }
      send(200, inv);
      return;
    }
    if (req.method === 'POST' && url === '/v2/payment/check') {
      send(200, { count: 0, paid_amount: 0, rows: [] });
      return;
    }
    send(404, { message: `mock missing ${req.method} ${url}` });
  });
  return new Promise((resolve) => {
    server.listen(MOCK_PORT, '127.0.0.1', () => {
      resolve({
        server,
        requests,
        setInvoiceCreateDelay(ms) {
          invoiceCreateDelayMs = ms;
        },
      });
    });
  });
}

function startBackend(root, port, logs) {
  const child = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: root,
    env: isolatedEnv(port),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const onData = (buf) => logs.push(buf.toString());
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  return child;
}

async function waitForHealth(api) {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${api}/health`);
      if (res.ok) return;
    } catch {
      /* boot */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`health хүлээгдсэнгүй: ${api}`);
}

function parseServerTiming(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(',')) {
    const m = part.trim().match(/^(\w+);dur=([0-9.]+)/);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

function prismaMsFrom(logs, fromIndex) {
  const added = logs.slice(fromIndex).join('');
  const times = [...added.matchAll(/\[prisma\] (\d+(?:\.\d+)?)ms/g)].map((m) => Number(m[1]));
  return {
    n: times.length,
    sum: times.reduce((a, b) => a + b, 0),
    max: times.length ? Math.max(...times) : 0,
  };
}

async function timedReq(api, path, { method = 'GET', token, body, origin = ORIGIN } = {}, logs) {
  const headers = { accept: 'application/json', origin };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const logAt = logs.length;
  const t0 = Date.now();
  const res = await fetch(`${api}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  const timing = parseServerTiming(res.headers.get('server-timing') ?? '');
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    status: res.status,
    json,
    text,
    ms,
    timing,
    prisma: prismaMsFrom(logs, logAt),
    ttfbHint: timing.app ?? null,
  };
}

async function timedOptions(api, path) {
  const t0 = Date.now();
  const res = await fetch(`${api}${path}`, {
    method: 'OPTIONS',
    headers: {
      origin: ORIGIN,
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization',
    },
  });
  await res.text();
  return { status: res.status, ms: Date.now() - t0 };
}

function data(res) {
  if (res.json?.data === undefined) {
    throw new Error(`data алга (${res.status}): ${String(res.text ?? '').slice(0, 240)}`);
  }
  return res.json.data;
}

function stats(samples) {
  const nums = samples.filter((n) => Number.isFinite(n));
  if (!nums.length) return { n: 0, median: null, p95: null, min: null, max: null, first: null };
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  return { n: sorted.length, median, p95, min: sorted[0], max: sorted[sorted.length - 1], first: nums[0] };
}

function summarize(rows) {
  const ok = rows.filter((r) => r.status === 200 || r.status === 204 || r.status === 201);
  return {
    statuses: [...new Set(rows.map((r) => r.status))],
    n: rows.length,
    n200: ok.length,
    client: stats(rows.map((r) => r.ms)),
    app: stats(rows.map((r) => r.timing?.app).filter((n) => n != null)),
    prismaSum: stats(rows.map((r) => r.prisma?.sum).filter((n) => n > 0)),
    prismaQueries: stats(rows.map((r) => r.prisma?.n).filter((n) => n > 0)),
    samples: rows.map((r) => ({
      status: r.status,
      clientMs: r.ms,
      appMs: r.timing?.app ?? null,
      internalMs: r.timing?.internal ?? null,
      qpayMs: r.timing?.qpay ?? null,
      prismaSumMs: r.prisma?.sum ?? 0,
      prismaN: r.prisma?.n ?? 0,
    })),
  };
}

async function repeatMeasure(n, fn) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(await fn());
  return out;
}

function explainMs(query) {
  const raw = execFileSync(
    'docker',
    ['exec', 'itgel-db', 'psql', '-U', 'itgel', '-d', 'itgel', '-At', '-c', `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`],
    { encoding: 'utf8' },
  ).trim();
  try {
    const json = JSON.parse(raw);
    const plan = Array.isArray(json) ? json[0] : json;
    return {
      executionMs: plan['Execution Time'] ?? null,
      planningMs: plan['Planning Time'] ?? null,
    };
  } catch {
    return { executionMs: null, planningMs: null, raw: raw.slice(0, 200) };
  }
}

const endpoints = [
  { id: 'products', path: '/api/leasing/products?pageSize=100' },
  { id: 'orders', path: '/api/leasing/orders?goods=arrived_unpaid&page=1&pageSize=100' },
  { id: 'ordersSummary', path: '/api/leasing/orders/summary' },
  { id: 'itgelSummary', path: '/api/leasing/finance/itgel/summary' },
  { id: 'itgelPending', path: '/api/leasing/finance/itgel/pending' },
  { id: 'itgelList', path: '/api/leasing/finance/itgel/settlements?remaining=1&take=50' },
];

async function measureStack(label, api, token, logs) {
  const out = { label, api, options: {}, endpoints: {}, waterfall: {} };
  out.options.products = summarize(await repeatMeasure(REPEAT, () => timedOptions(api, '/api/leasing/products')));
  out.options.itgelSummary = summarize(
    await repeatMeasure(REPEAT, () => timedOptions(api, '/api/leasing/finance/itgel/summary')),
  );

  for (const ep of endpoints) {
    const rows = [];
    for (let i = 0; i < REPEAT; i += 1) {
      rows.push(await timedReq(api, ep.path, { token }, logs));
    }
    out.endpoints[ep.id] = summarize(rows);
  }

  const previewRows = [];
  for (let i = 0; i < REPEAT; i += 1) {
    const list = data(await timedReq(api, '/api/leasing/finance/itgel/settlements?remaining=1&take=5', { token }, logs));
    const ids = (Array.isArray(list) ? list : list?.rows ?? []).filter((row) => row.selectable).slice(0, 2).map((row) => row.id);
    if (!ids.length) break;
    previewRows.push(
      await timedReq(api, '/api/leasing/finance/itgel/preview', { method: 'POST', token, body: { settlementIds: ids } }, logs),
    );
  }
  if (previewRows.length) out.endpoints.preview = summarize(previewRows);

  out.waterfall.serial = summarize(
    await repeatMeasure(5, async () => {
      const t0 = Date.now();
      const a = await timedReq(api, '/api/leasing/finance/itgel/summary', { token }, logs);
      const b = await timedReq(api, '/api/leasing/finance/itgel/pending', { token }, logs);
      const c = await timedReq(api, '/api/leasing/finance/itgel/settlements?remaining=1&take=50', { token }, logs);
      return {
        status: a.status === 200 && b.status === 200 && c.status === 200 ? 200 : 0,
        ms: Date.now() - t0,
        timing: {},
        prisma: { n: a.prisma.n + b.prisma.n + c.prisma.n, sum: a.prisma.sum + b.prisma.sum + c.prisma.sum },
      };
    }),
  );
  out.waterfall.parallel = summarize(
    await repeatMeasure(5, async () => {
      const t0 = Date.now();
      const [a, b, c] = await Promise.all([
        timedReq(api, '/api/leasing/finance/itgel/summary', { token }, logs),
        timedReq(api, '/api/leasing/finance/itgel/pending', { token }, logs),
        timedReq(api, '/api/leasing/finance/itgel/settlements?remaining=1&take=50', { token }, logs),
      ]);
      return {
        status: a.status === 200 && b.status === 200 && c.status === 200 ? 200 : 0,
        ms: Date.now() - t0,
        timing: {},
        prisma: { n: a.prisma.n + b.prisma.n + c.prisma.n, sum: a.prisma.sum + b.prisma.sum + c.prisma.sum },
      };
    }),
  );
  return out;
}

async function catalogChecks(api, token, logs) {
  const listRes = await timedReq(api, '/api/leasing/products?pageSize=100', { token }, logs);
  if (listRes.status !== 200) return { ok: false, reason: `list ${listRes.status}` };
  const list = data(listRes);
  const product = (Array.isArray(list) ? list : [])[0];
  if (!product) return { ok: false, reason: 'no products' };
  const round = product.currentRound ?? product.rounds?.[0];
  const detailRes = await timedReq(api, `/api/leasing/products/${product.id}`, { token }, logs);
  if (detailRes.status !== 200) return { ok: false, reason: `detail ${detailRes.status}` };
  const detail = data(detailRes);
  const detailRound = detail.currentRound ?? detail.rounds?.[0];
  const fields = {
    listHasPrice: Number.isFinite(round?.sellPrice),
    listHasStock: Number.isFinite(round?.stock),
    listHasImages: Array.isArray(product.images),
    detailHasPrice: Number.isFinite(detailRound?.sellPrice),
    detailHasStock: Number.isFinite(detailRound?.stock),
    detailHasImages: Array.isArray(detail.images),
    detailHasSkuStocks: Array.isArray(detailRound?.skuStocks),
    detailHasOptions: Array.isArray(detail.options),
  };
  const beforeStock = detailRound.stock;
  const patchRes = await timedReq(
    api,
    `/api/leasing/products/rounds/${detailRound.id}`,
    { method: 'PATCH', token, body: { stock: beforeStock + 1, sellPrice: detailRound.sellPrice } },
    logs,
  );
  const listAfter = data(await timedReq(api, '/api/leasing/products?pageSize=100', { token }, logs));
  const afterRow = (Array.isArray(listAfter) ? listAfter : []).find((row) => row.id === product.id);
  const afterRound = afterRow?.currentRound ?? afterRow?.rounds?.[0];
  const restore = await timedReq(
    api,
    `/api/leasing/products/rounds/${detailRound.id}`,
    { method: 'PATCH', token, body: { stock: beforeStock, sellPrice: detailRound.sellPrice } },
    logs,
  );
  return {
    ok:
      fields.listHasPrice &&
      fields.listHasStock &&
      fields.detailHasSkuStocks &&
      patchRes.status === 200 &&
      afterRound?.stock === beforeStock + 1 &&
      restore.status === 200,
    fields,
    patchStatus: patchRes.status,
    restoreStatus: restore.status,
    stockBefore: beforeStock,
    stockAfterList: afterRound?.stock ?? null,
  };
}

async function mockQpayCreate(api, token, ownerAdminId, logs, mock) {
  const raw = sql(
    `SELECT json_build_object(
       'itemId', oi.id, 'orderId', oi."orderId", 'code', o.code, 'customerId', o."customerId",
       'customerName', coalesce(c.name,''), 'productId', oi."productId", 'roundId', oi."roundId",
       'productName', coalesce(oi."nameSnapshot",'latency'), 'qty', oi.qty, 'unitPrice', oi."unitPrice"
     )::text
     FROM "OrderItem" oi
     JOIN "Order" o ON o.id = oi."orderId"
     JOIN "Customer" c ON c.id = o."customerId"
     JOIN "Product" p ON p.id = oi."productId"
     LEFT JOIN "ItgelSettlement" s ON s."sourceOrderItemId" = oi.id
     WHERE s.id IS NULL AND p."ownerKind" = 'LEASING' AND p."ownerAdminId" = '${ownerAdminId}'
     LIMIT 1`,
  );
  if (!raw) {
    return { ran: false, reason: 'no unmatched leasing order item for disposable settlement' };
  }
  const row = JSON.parse(raw);
  const settlementId = `latcmp_${Date.now().toString(36)}`;
  const amount = Math.max(1, Number(row.qty) * Number(row.unitPrice) || 1000);
  const esc = (v) => String(v ?? '').replace(/'/g, "''");
  sql(
    `INSERT INTO "ItgelSettlement" (
       id, "sourceOrderItemId", "sourceOrderId", "sourceOrderCode", "customerId", "customerName",
       "ownerAdminId", "productId", "roundId", "productName", qty, "unitPrice", amount,
       "confirmedAt", status, "paidAmount", "remainingAmount"
     ) VALUES (
       '${settlementId}', '${esc(row.itemId)}', '${esc(row.orderId)}', '${esc(row.code)}', '${esc(row.customerId)}',
       '${esc(row.customerName)}', '${esc(ownerAdminId)}', '${esc(row.productId)}', '${esc(row.roundId)}',
       '${esc(row.productName)}', ${Number(row.qty) || 1}, ${Number(row.unitPrice) || amount}, ${amount},
       NOW(), 'OPEN', 0, ${amount}
     )`,
  );
  let pay;
  try {
    mock.setInvoiceCreateDelay(250);
    pay = await timedReq(
      api,
      '/api/leasing/finance/itgel/pay',
      { method: 'POST', token, body: { settlementIds: [settlementId], method: 'QPAY', note: 'latency-compare-disposable' } },
      logs,
    );
    const paymentId = pay.json?.data?.payment?.id;
    if (paymentId) {
      await timedReq(api, `/api/leasing/finance/itgel/payments/${paymentId}/cancel`, { method: 'POST', token }, logs);
      sql(`UPDATE "QpayInvoice" SET "settlementPaymentId" = NULL WHERE "settlementPaymentId" = '${esc(paymentId)}'`);
      sql(`DELETE FROM "ItgelSettlementPaymentLine" WHERE "paymentId" = '${esc(paymentId)}'`);
      sql(`DELETE FROM "ItgelSettlementPayment" WHERE id = '${esc(paymentId)}'`);
    }
  } finally {
    mock.setInvoiceCreateDelay(0);
    sql(`DELETE FROM "ItgelSettlementPaymentLine" WHERE "settlementId" = '${settlementId}'`);
    sql(`DELETE FROM "ItgelSettlement" WHERE id = '${settlementId}'`);
  }
  const qpayLogs = logs.join('').match(/\[qpay\] POST \S+ (\d+)ms/g) ?? [];
  return {
    ran: true,
    payStatus: pay?.status ?? 0,
    clientMs: pay?.ms ?? null,
    appMs: pay?.timing?.app ?? null,
    internalMs: pay?.timing?.internal ?? null,
    qpayMs: pay?.timing?.qpay ?? null,
    resumed: pay?.json?.data?.resumed ?? null,
    hasInvoice: Boolean(pay?.json?.data?.invoice?.invoiceId || pay?.json?.data?.invoice?.qrText),
    mockCreateDelayMs: 250,
    providerLogs: qpayLogs.slice(-4),
    error: pay?.status && pay.status >= 400 ? String(pay.text).slice(0, 240) : null,
    note: 'local mock QPay only; merchant.qpay.mn not called',
  };
}

const afterLogs = [];
const beforeLogs = [];
const afterApi = `http://127.0.0.1:${AFTER_PORT}`;
const beforeApi = `http://127.0.0.1:${BEFORE_PORT}`;
let afterBackend;
let beforeBackend;
let mock;
const report = { db: {}, after: null, before: null, catalog: null, mockQpay: null, realQpay: 'жинхэнэ QPay-ийн хугацаа хэмжигдээгүй' };

try {
  mock = await startMockQpay();
  afterBackend = startBackend(AFTER_ROOT, AFTER_PORT, afterLogs);
  beforeBackend = startBackend(BEFORE_ROOT, BEFORE_PORT, beforeLogs);
  await Promise.all([waitForHealth(afterApi), waitForHealth(beforeApi)]);

  const counts = {
    orders: Number(sql(`SELECT count(*) FROM "Order"`)),
    settlements: Number(sql(`SELECT count(*) FROM "ItgelSettlement"`)),
    products: Number(sql(`SELECT count(*) FROM "Product" WHERE "ownerKind"='LEASING'`)),
  };
  report.db.counts = counts;

  sql(`DELETE FROM "PhoneOtp" WHERE phone='99000002'`);
  const workspaceOtp = createOtpWorkspace({
    req: (p, opts) => timedReq(afterApi, p, opts, afterLogs),
    sql,
    data,
  });
  const leasing = await workspaceOtp.workspaceLogin('leasing@itgel.mn', '99000002');
  const token = leasing.token;
  const me = data(await timedReq(afterApi, '/api/admin/auth/me', { token }, afterLogs));
  report.db.userRole = me.role;
  report.db.ownerAdminIdPresent = Boolean(me.id);

  report.db.explain = {
    settlementAgg: explainMs(
      `SELECT coalesce(sum("remainingAmount") FILTER (WHERE status IN ('OPEN','INVOICED','PENDING_BANK')),0) FROM "ItgelSettlement" WHERE status <> 'VOID' AND "ownerAdminId" = '${me.id}'`,
    ),
    paymentAgg: explainMs(
      `SELECT coalesce(sum(amount) FILTER (WHERE status = 'PENDING' AND method = 'QPAY'),0) FROM "ItgelSettlementPayment" WHERE "ownerAdminId" = '${me.id}'`,
    ),
    select1: explainMs(`SELECT 1`),
  };
  const tSelect = Date.now();
  sql('SELECT 1');
  report.db.select1ClientWaitMs = Date.now() - tSelect;

  report.after = await measureStack('after', afterApi, token, afterLogs);
  report.before = await measureStack('before', beforeApi, token, beforeLogs);
  report.catalog = await catalogChecks(afterApi, token, afterLogs);
  report.mockQpay = await mockQpayCreate(afterApi, token, me.id, afterLogs, mock);

  writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
  console.log(`WROTE ${OUT_PATH}`);
  console.log(
    JSON.stringify(
      {
        db: report.db,
        catalog: report.catalog,
        mockQpay: report.mockQpay,
        realQpay: report.realQpay,
        before: Object.fromEntries(
          Object.entries(report.before.endpoints).map(([k, v]) => [k, { statuses: v.statuses, client: v.client, app: v.app, prismaSum: v.prismaSum }]),
        ),
        after: Object.fromEntries(
          Object.entries(report.after.endpoints).map(([k, v]) => [k, { statuses: v.statuses, client: v.client, app: v.app, prismaSum: v.prismaSum }]),
        ),
        waterfall: { before: report.before.waterfall, after: report.after.waterfall },
        options: { before: report.before.options, after: report.after.options },
      },
      null,
      2,
    ),
  );
  console.log('MEASURE_DONE');
  if (process.env.KEEP_SERVERS === '1') {
    console.log(`KEEP after=${afterApi} before=${beforeApi}`);
    await new Promise(() => {});
  }
} catch (error) {
  console.error(afterLogs.slice(-20).join(''));
  console.error(beforeLogs.slice(-20).join(''));
  throw error;
} finally {
  if (process.env.KEEP_SERVERS !== '1') {
    afterBackend?.kill('SIGTERM');
    beforeBackend?.kill('SIGTERM');
    mock?.server.close();
  }
}
