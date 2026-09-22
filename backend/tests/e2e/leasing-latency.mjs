#!/usr/bin/env node
/**
 * Лизингийн админ хуудас/QPay хурд — локал docker Postgres + mock QPay.
 * Production DB / merchant.qpay.mn / SMS руу явахгүй.
 *
 *   node tests/e2e/leasing-latency.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOtpWorkspace } from './otpWorkspace.mjs';

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOCAL_DB = 'postgresql://itgel:itgel@127.0.0.1:5432/itgel';
const API_PORT = 4016;
const MOCK_PORT = 4096;
const API = `http://127.0.0.1:${API_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;

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

function isolatedEnv() {
  return {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(API_PORT),
    DATABASE_URL: LOCAL_DB,
    DIRECT_URL: LOCAL_DB,
    JWT_SECRET: 'isolated-leasing-latency',
    CRON_ENABLED: 'false',
    CRON_SECRET: 'isolated-latency-cron',
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
    SETTLEMENT_QPAY_TIMEOUT_MS: '8000',
    LEASING_QPAY_ENABLED: 'true',
    LEASING_QPAY_BASE_URL: `${MOCK}/v2`,
    LEASING_QPAY_CLIENT_ID: 'leasing-test',
    LEASING_QPAY_CLIENT_SECRET: 'leasing-secret',
    LEASING_QPAY_INVOICE_CODE: 'LEASING_TEST_INVOICE',
    LEASING_QPAY_CALLBACK_URL: `${API}/api/orders/leasing-qpay/callback`,
    SUPABASE_URL: '',
    SUPABASE_PUBLISHABLE_KEY: '',
    SUPABASE_SECRET_KEY: '',
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    R2_ENDPOINT: '',
    R2_ACCESS_KEY_ID: '',
    R2_SECRET_ACCESS_KEY: '',
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
    requests.push({ method: req.method, url });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
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
      if (invoiceCreateDelayMs > 0) await new Promise((r) => setTimeout(r, invoiceCreateDelayMs));
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
      send(200, { count: id ? 1 : 0, rows: id ? [{ invoice_id: id, sender_invoice_no: sender, amount: invoices.get(id)?.amount, invoice_status: 'OPEN' }] : [] });
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

function startBackend(logs) {
  const child = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: BACKEND_ROOT,
    env: isolatedEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const onData = (buf) => logs.push(buf.toString());
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  return child;
}

async function waitForHealth() {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API}/health`);
      if (res.ok) return;
    } catch {
      /* boot */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('backend health хүлээгдсэнгүй');
}

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const t0 = Date.now();
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  const timing = res.headers.get('server-timing') ?? '';
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text, ms, timing };
}

function data(res) {
  if (res.json?.data === undefined) throw new Error(`data алга (${res.status}): ${res.text.slice(0, 300)}`);
  return res.json.data;
}

function stats(samples) {
  if (!samples.length) return { n: 0, median: 0, p95: 0, min: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  return { n: sorted.length, median, p95, min: sorted[0], max: sorted[sorted.length - 1] };
}

async function repeat(n, fn) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(await fn());
  return out;
}

const workspaceOtp = createOtpWorkspace({ req, sql, data });
const logs = [];
let backend;
let mock;

try {
  mock = await startMockQpay();
  backend = startBackend(logs);
  await waitForHealth();

  sql(`DELETE FROM "PhoneOtp" WHERE phone='99000002'`);
  const leasing = await workspaceOtp.workspaceLogin('leasing@itgel.mn', '99000002');
  const token = leasing.token;
  assert.ok(token);

  const cold = {};
  cold.products = (await req('/api/leasing/products?pageSize=100', { token })).ms;
  cold.orders = (await req('/api/leasing/orders?goods=arrived_unpaid&page=1&pageSize=100', { token })).ms;
  cold.summary = (await req('/api/leasing/orders/summary', { token })).ms;
  cold.itgelSummary = (await req('/api/leasing/finance/itgel/summary', { token })).ms;
  cold.itgelPending = (await req('/api/leasing/finance/itgel/pending', { token })).ms;
  cold.itgelList = (await req('/api/leasing/finance/itgel/settlements?remaining=1&take=50', { token })).ms;

  const warmN = 7;
  const products = await repeat(warmN, async () => (await req('/api/leasing/products?pageSize=100', { token })).ms);
  const orders = await repeat(warmN, async () => (await req('/api/leasing/orders?goods=arrived_unpaid&page=1&pageSize=100', { token })).ms);
  const orderSummary = await repeat(warmN, async () => (await req('/api/leasing/orders/summary', { token })).ms);
  const itgelSummary = await repeat(warmN, async () => (await req('/api/leasing/finance/itgel/summary', { token })).ms);
  const itgelPending = await repeat(warmN, async () => (await req('/api/leasing/finance/itgel/pending', { token })).ms);
  const itgelList = await repeat(warmN, async () => (await req('/api/leasing/finance/itgel/settlements?remaining=1&take=50', { token })).ms);
  const itgelPreview = await repeat(warmN, async () => {
    const list = data(await req('/api/leasing/finance/itgel/settlements?remaining=1&take=5', { token }));
    const ids = (Array.isArray(list) ? list : []).filter((row) => row.selectable).slice(0, 2).map((row) => row.id);
    if (ids.length === 0) return 0;
    return (await req('/api/leasing/finance/itgel/preview', { method: 'POST', token, body: { settlementIds: ids } })).ms;
  });

  const serial = await repeat(5, async () => {
    const a = await req('/api/leasing/finance/itgel/summary', { token });
    const b = await req('/api/leasing/finance/itgel/pending', { token });
    const c = await req('/api/leasing/finance/itgel/settlements?remaining=1&take=50', { token });
    return a.ms + b.ms + c.ms;
  });
  const parallel = await repeat(5, async () => {
    const t0 = Date.now();
    await Promise.all([
      req('/api/leasing/finance/itgel/summary', { token }),
      req('/api/leasing/finance/itgel/pending', { token }),
      req('/api/leasing/finance/itgel/settlements?remaining=1&take=50', { token }),
    ]);
    return Date.now() - t0;
  });

  const fmt = (s) => (s.n ? `median ${s.median}ms · p95 ${s.p95}ms · min ${s.min} · max ${s.max}` : 'n/a');
  console.log('LOCAL HTTP after-fix (docker Postgres, GET/preview only)');
  console.log('cold', JSON.stringify(cold));
  console.log('products', fmt(stats(products)));
  console.log('orders page1', fmt(stats(orders)));
  console.log('orders summary', fmt(stats(orderSummary)));
  console.log('itgel summary', fmt(stats(itgelSummary)));
  console.log('itgel pending', fmt(stats(itgelPending)));
  console.log('itgel list', fmt(stats(itgelList)));
  console.log('itgel preview', fmt(stats(itgelPreview.filter((n) => n > 0))));
  console.log('itgel serial 3req', fmt(stats(serial)));
  console.log('itgel parallel 3req', fmt(stats(parallel)));
  console.log('QPay create/resume not run on existing debts; unit tests cover stored QR vs create');
} finally {
  if (backend) backend.kill('SIGTERM');
  if (mock?.server) mock.server.close();
}
