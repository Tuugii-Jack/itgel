#!/usr/bin/env node
/**
 * Хүсэлтийн өмнөх/дараах хэмжилт. Production DB / QPay / SMS руу явахгүй.
 *
 * Виртуал 15 мин: ижил сценарийг хуучин болон шинэ poller/CORS TTL-ээр тоолно.
 * Амьд HTTP: localhost mock QPay + docker Postgres.
 *
 *   npx tsx tests/e2e/request-traffic.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPoller, POLL_MAX_DURATION_MS } from '../../../frontend/lib/poller.ts';
import { shouldPollPayment, shouldPollSuccess } from '../../../frontend/lib/orderPolling.ts';
import { CORS_PREFLIGHT_MAX_AGE_SEC } from '../../src/lib/cors.ts';

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOCAL_DB = 'postgresql://itgel:itgel@127.0.0.1:5432/itgel';
const API_PORT = 4013;
const MOCK_PORT = 4098;
const API = `http://127.0.0.1:${API_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const WINDOW_MS = 15 * 60 * 1000;
const ORIGIN = 'http://localhost:3000';

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) {
  fail(`DATABASE_URL локал биш — зогсоов: ${process.env.DATABASE_URL.replace(/:[^@]+@/, ':***@')}`);
}

function tally(events) {
  const byMethod = { GET: 0, POST: 0, PATCH: 0, OPTIONS: 0, OTHER: 0 };
  const byEndpoint = {};
  const reasons = {};
  for (const ev of events) {
    const method = byMethod[ev.method] == null ? 'OTHER' : ev.method;
    byMethod[method] += 1;
    const key = `${ev.method} ${ev.path}`;
    byEndpoint[key] = (byEndpoint[key] ?? 0) + 1;
    reasons[ev.reason] = (reasons[ev.reason] ?? 0) + 1;
  }
  return {
    total: events.length,
    byMethod,
    byEndpoint,
    reasons,
    optionsShare: events.length ? byMethod.OPTIONS / events.length : 0,
  };
}

function printTally(title, t) {
  console.log(`\n=== ${title} ===`);
  console.log(
    `нийт ${t.total}  GET ${t.byMethod.GET}  POST ${t.byMethod.POST}  OPTIONS ${t.byMethod.OPTIONS}` +
      (t.byMethod.PATCH ? `  PATCH ${t.byMethod.PATCH}` : '') +
      (t.byMethod.OTHER ? `  OTHER ${t.byMethod.OTHER}` : ''),
  );
  const top = Object.entries(t.byEndpoint)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  for (const [k, n] of top) console.log(`  ${n}\t${k}`);
  console.log('давтагдсан шалтгаан:');
  for (const [k, n] of Object.entries(t.reasons).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n}\t${k}`);
  }
}

function needsPreflight(method, headers) {
  if (headers.authorization || headers.Authorization) return true;
  const ct = headers['content-type'] || headers['Content-Type'];
  if (ct && ct !== 'text/plain' && !String(ct).includes('www-form-urlencoded')) return true;
  return !['GET', 'HEAD', 'POST'].includes(method);
}

function createBrowser({ preflightMaxAgeSec }) {
  let now = 0;
  /** @type {{ method: string, path: string, reason: string, at: number }[]} */
  const events = [];
  const cache = new Map();

  function record(method, path, reason) {
    events.push({ method, path, reason, at: now });
  }

  function maybePreflight(method, path, headers, reason) {
    if (!needsPreflight(method, headers)) return;
    const names = Object.keys(headers)
      .map((h) => h.toLowerCase())
      .sort()
      .join(',');
    const key = `${ORIGIN}|${method}|${path}|${names}`;
    const exp = cache.get(key) ?? 0;
    if (exp > now) return;
    record('OPTIONS', path, `preflight:${reason}`);
    cache.set(key, now + preflightMaxAgeSec * 1000);
  }

  return {
    events,
    now: () => now,
    setNow(ms) {
      now = ms;
    },
    addNow(ms) {
      now += ms;
    },
    request(method, path, { headers = {}, reason = method } = {}) {
      maybePreflight(method, path, headers, reason);
      record(method, path, reason);
    },
  };
}

const AUTH = { authorization: 'Bearer customer' };
const ADMIN = { authorization: 'Bearer admin' };

function leftoverOrder() {
  return {
    status: 'NEW',
    paymentState: 'PARTIAL',
    dueAmount: 90000,
    isLeasing: true,
    cargoPayMethod: null,
    fulfilment: null,
    paidAmount: 10000,
    refundedAmount: 0,
    subtotal: 100000,
    leasingFeePaid: true,
    nextPayKind: 'PRINCIPAL',
    payPlan: { overdue: false, dueToday: false },
  };
}

function shopUnpaid() {
  return {
    status: 'NEW',
    paymentState: 'UNPAID',
    dueAmount: 100000,
    isLeasing: false,
    cargoPayMethod: null,
    fulfilment: null,
    paidAmount: 0,
    refundedAmount: 0,
    subtotal: 100000,
  };
}

function feeHold() {
  return {
    ...leftoverOrder(),
    paymentState: 'UNPAID',
    dueAmount: 110000,
    paidAmount: 0,
    leasingFeePaid: false,
    nextPayKind: 'FEE',
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function runFixedPoll(browser, { path, intervalMs, windowMs, headers, extra }) {
  /** @type {{ fn: () => unknown, at: number, live: boolean }[]} */
  const timers = [];
  const poller = createPoller({
    intervalMs,
    maxDurationMs: POLL_MAX_DURATION_MS,
    now: browser.now,
    setTimer: (fn, ms) => {
      const timer = { fn, at: browser.now() + ms, live: true };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      timer.live = false;
    },
    run: () => {
      browser.request('GET', path, { headers, reason: 'poll' });
      extra?.();
    },
  });
  poller.start();
  const end = browser.now() + windowMs;
  while (true) {
    const next = timers.filter((t) => t.live).sort((a, b) => a.at - b.at)[0];
    if (!next || next.at > end) break;
    browser.setNow(next.at);
    next.live = false;
    void next.fn();
    await flush();
    if (poller.isStopped()) break;
  }
  browser.setNow(Math.max(browser.now(), end));
  poller.stop('disabled');
}

function runLegacyPoll(browser, { path, intervalMs, windowMs, headers, extra, failEvery = 0 }) {
  const end = browser.now() + windowMs;
  let n = 0;
  browser.addNow(intervalMs);
  while (browser.now() <= end) {
    n += 1;
    browser.request('GET', path, { headers, reason: failEvery && n % failEvery === 0 ? 'poll-error' : 'poll' });
    extra?.();
    browser.addNow(intervalMs);
  }
}

function adminFanout(browser, { mutations, deferList }) {
  const list = () => {
    browser.request('GET', '/api/admin/summary', { headers: ADMIN, reason: 'admin-list' });
    browser.request('GET', '/api/admin/orders', { headers: ADMIN, reason: 'admin-list' });
    browser.request('GET', '/api/admin/batches', { headers: ADMIN, reason: 'admin-list' });
  };
  const detail = () => {
    browser.request('GET', '/api/admin/orders/o1', { headers: ADMIN, reason: 'admin-detail' });
    browser.request('GET', '/api/admin/orders/o1/payments', { headers: ADMIN, reason: 'admin-detail' });
    browser.request('GET', '/api/admin/orders/o1/qpay', { headers: ADMIN, reason: 'admin-detail' });
  };
  list();
  detail();
  for (let i = 0; i < mutations; i += 1) {
    browser.request('POST', '/api/admin/orders/o1/payments', {
      headers: { ...ADMIN, 'content-type': 'application/json' },
      reason: 'admin-mutation',
    });
    detail();
    if (!deferList) list();
  }
  if (deferList) list();
}

async function measureVirtual() {
  const before = createBrowser({ preflightMaxAgeSec: 5 });
  const after = createBrowser({ preflightMaxAgeSec: CORS_PREFLIGHT_MAX_AGE_SEC });

  // 1. Success unpaid shop — store every poll vs once
  const successPath = '/api/orders/PH-SHOP1';
  before.request('GET', successPath, { headers: AUTH, reason: 'initial-order' });
  before.request('GET', '/api/store', { reason: 'initial-store' });
  runLegacyPoll(before, {
    path: successPath,
    intervalMs: 10_000,
    windowMs: WINDOW_MS,
    headers: AUTH,
    extra: () => before.request('GET', '/api/store', { reason: 'poll-store' }),
  });

  after.request('GET', successPath, { headers: AUTH, reason: 'initial-order' });
  after.request('GET', '/api/store', { reason: 'initial-store' });
  assert.equal(shouldPollSuccess(shopUnpaid()), true);
  await runFixedPoll(after, {
    path: successPath,
    intervalMs: 10_000,
    windowMs: WINDOW_MS,
    headers: AUTH,
  });

  // 2. Track leftover leasing — remainder is not an active wait
  const leftoverPath = '/api/orders/PH-LEFT';
  const leftover = leftoverOrder();
  assert.equal(shouldPollPayment(leftover), false);
  before.request('GET', leftoverPath, { headers: AUTH, reason: 'initial-order' });
  before.request('GET', '/api/store', { reason: 'initial-store' });
  runLegacyPoll(before, {
    path: leftoverPath,
    intervalMs: 15_000,
    windowMs: WINDOW_MS,
    headers: AUTH,
  });
  after.request('GET', leftoverPath, { headers: AUTH, reason: 'initial-order' });
  after.request('GET', '/api/store', { reason: 'initial-store' });
  // no poll

  // 3. Track unpaid shop — 15s, after stops at 10 min
  const trackPath = '/api/orders/PH-TRACK';
  before.request('GET', trackPath, { headers: AUTH, reason: 'initial-order' });
  runLegacyPoll(before, { path: trackPath, intervalMs: 15_000, windowMs: WINDOW_MS, headers: AUTH });
  after.request('GET', trackPath, { headers: AUTH, reason: 'initial-order' });
  await runFixedPoll(after, { path: trackPath, intervalMs: 15_000, windowMs: WINDOW_MS, headers: AUTH });

  // 4. Error backoff on success
  const errPath = '/api/orders/PH-ERR';
  before.request('GET', errPath, { headers: AUTH, reason: 'initial-order' });
  runLegacyPoll(before, { path: errPath, intervalMs: 10_000, windowMs: WINDOW_MS, headers: AUTH });
  after.request('GET', errPath, { headers: AUTH, reason: 'initial-order' });
  /** @type {{ fn: () => unknown, at: number, live: boolean }[]} */
  const errTimers = [];
  const errPoller = createPoller({
    intervalMs: 10_000,
    now: after.now,
    setTimer: (fn, ms) => {
      const timer = { fn, at: after.now() + ms, live: true };
      errTimers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      timer.live = false;
    },
    run: () => {
      after.request('GET', errPath, { headers: AUTH, reason: 'poll-error' });
      throw new Error('network');
    },
  });
  const errStart = after.now();
  errPoller.start();
  const errEnd = errStart + WINDOW_MS;
  while (true) {
    const next = errTimers.filter((t) => t.live).sort((a, b) => a.at - b.at)[0];
    if (!next || next.at > errEnd) break;
    after.setNow(next.at);
    next.live = false;
    void next.fn();
    await flush();
    if (errPoller.isStopped()) break;
  }
  after.setNow(Math.max(after.now(), errEnd));
  errPoller.stop('disabled');

  // 5. Fee hold still polls after the fix
  const feePath = '/api/orders/PH-FEE';
  assert.equal(shouldPollPayment(feeHold()), true);
  before.request('GET', feePath, { headers: AUTH, reason: 'initial-order' });
  runLegacyPoll(before, { path: feePath, intervalMs: 10_000, windowMs: WINDOW_MS, headers: AUTH });
  after.request('GET', feePath, { headers: AUTH, reason: 'initial-order' });
  await runFixedPoll(after, { path: feePath, intervalMs: 10_000, windowMs: WINDOW_MS, headers: AUTH });

  // 6. Admin 3 mutations
  adminFanout(before, { mutations: 3, deferList: false });
  adminFanout(after, { mutations: 3, deferList: true });

  // 7. Reopen track leftover — initial only both sides
  before.request('GET', leftoverPath, { headers: AUTH, reason: 'reopen-order' });
  after.request('GET', leftoverPath, { headers: AUTH, reason: 'reopen-order' });

  // 8. Hidden tab 5 min then visible: both skip hidden; after ticks once on return
  const hidePath = '/api/orders/PH-HIDE';
  before.request('GET', hidePath, { headers: AUTH, reason: 'initial-order' });
  before.addNow(5 * 60 * 1000);
  runLegacyPoll(before, { path: hidePath, intervalMs: 15_000, windowMs: 10 * 60 * 1000, headers: AUTH });
  after.request('GET', hidePath, { headers: AUTH, reason: 'initial-order' });
  after.addNow(5 * 60 * 1000);
  after.request('GET', hidePath, { headers: AUTH, reason: 'visibility' });
  await runFixedPoll(after, { path: hidePath, intervalMs: 15_000, windowMs: 10 * 60 * 1000, headers: AUTH });

  return { before: tally(before.events), after: tally(after.events), beforeEvents: before.events, afterEvents: after.events };
}

function startMockQpay() {
  const invoices = new Map();
  const payments = new Map();
  const checkFails = new Map();
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
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  }
  async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw.trim()) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  const server = createServer(async (req, res) => {
    const url = req.url ?? '/';
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
      send(res, 200, { access_token: kind === 'leasing' ? 'mock-leasing' : 'mock-shop', expires_in: 3600 });
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
      });
      send(res, 200, { invoice_id: id, qr_text: `qr:${id}`, amount: body.amount, urls: [] });
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
    send(res, 404, { message: `mock missing ${req.method} ${url}` });
  });
  return new Promise((resolve) => {
    server.listen(MOCK_PORT, '127.0.0.1', () => {
      resolve({
        server,
        pay(id, amount) {
          const inv = invoices.get(id);
          if (!inv) throw new Error(`mock invoice ${id} алга`);
          inv.paidAmount = amount;
          const pid = `pay_${++seq}`;
          inv.paymentIds.push(pid);
          payments.set(pid, { id: pid, invoiceId: id, amount });
          return pid;
        },
        failNextCheck(id, times = 1) {
          checkFails.set(id, times);
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
    JWT_SECRET: 'isolated-request-traffic',
    CRON_ENABLED: 'false',
    SMS_PROVIDER: 'console',
    SHOP_SMS_PROVIDER: 'console',
    STORAGE_PROVIDER: 'mock',
    CORS_ORIGIN: 'http://localhost:3000',
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

function sql(query) {
  return execFileSync(
    'docker',
    ['exec', 'itgel-db', 'psql', '-U', 'itgel', '-d', 'itgel', '-At', '-c', query],
    { encoding: 'utf8' },
  ).trim();
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
  fail(`backend ${API_PORT} health хүлээгдсэнгүй: ${last}`);
}

let ipSeq = 40;
async function req(path, { method = 'GET', token, body, raw, origin } = {}) {
  const headers = {
    accept: 'application/json',
    'x-forwarded-for': `127.0.0.${ipSeq++}`,
  };
  if (origin) headers.origin = origin;
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (raw) return { status: res.status, text, headers: res.headers };
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { parseError: true, text };
  }
  return { status: res.status, json, text, headers: res.headers };
}

function data(res) {
  if (res.json?.data === undefined) {
    throw new Error(`data алга (${res.status}): ${res.text.slice(0, 400)}`);
  }
  return res.json.data;
}

function lineOf(product, qty = 1) {
  const sku = (product.skuStocks ?? []).find((s) => s.stock > 0);
  if (sku?.selections) {
    return {
      productId: product.id,
      qty,
      selections: sku.selections,
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
    `UPDATE "ProductRound" SET stock = stock + ${qty}, status = CASE WHEN stock + ${qty} > 0 THEN 'ACTIVE' ELSE status END WHERE id='${product.id}'`,
  );
  const line = lineOf(product);
  if (line.selections && Object.keys(line.selections).length) {
    sql(
      `UPDATE "RoundSkuStock" SET stock = stock + ${qty} WHERE "roundId"='${product.id}' AND "skuKey"='${skuKey(line.selections)}'`,
    );
  }
}

async function loginCustomer(phone, name) {
  const otp = await req('/api/auth/otp', { method: 'POST', body: { phone, name } });
  assert.equal(otp.status, 200, otp.text);
  const code = sql(
    `SELECT code FROM "PhoneOtp" WHERE phone='${phone}' AND purpose='LOGIN' ORDER BY "createdAt" DESC LIMIT 1`,
  );
  const verify = await req('/api/auth/verify', { method: 'POST', body: { phone, code } });
  assert.equal(verify.status, 200, verify.text);
  return data(verify).token;
}

const live = { ok: false, notes: [] };

async function runLive() {
  const hostPorts = execFileSync(
    'docker',
    ['inspect', '-f', '{{range $p, $conf := .NetworkSettings.Ports}}{{$p}}={{(index $conf 0).HostPort}};{{end}}', 'itgel-db'],
    { encoding: 'utf8' },
  );
  if (!hostPorts.includes('5432')) fail(`itgel-db 5432 дээр биш: ${hostPorts}`);
  assert.equal(sql('SELECT current_database();'), 'itgel');
  live.notes.push('docker Postgres itgel @ 127.0.0.1:5432');

  const mock = await startMockQpay();
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

  const logs = [];
  const backend = startBackend(logs);
  const shutdown = async () => {
    backend.kill('SIGTERM');
    mock.server.close();
  };
  process.on('SIGINT', () => void shutdown().then(() => process.exit(1)));

  try {
    await waitForHealth();
    const boot = logs.join('');
    if (/merchant\.qpay\.mn|supabase\.com|pooler\.supabase/.test(boot)) {
      fail(`isolated backend production host руу хандсан:\n${boot.slice(-800)}`);
    }
    live.notes.push(`isolated backend ${API}`);

    const opt = await fetch(`${API}/api/orders/x`, {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    assert.equal(opt.status, 204, await opt.text());
    assert.equal(opt.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal(opt.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(opt.headers.get('access-control-max-age'), String(CORS_PREFLIGHT_MAX_AGE_SEC));
    assert.match(opt.headers.get('cache-control') ?? '', /private/i);
    assert.match(opt.headers.get('cache-control') ?? '', /no-store/i);
    live.notes.push(`OPTIONS Max-Age=${opt.headers.get('access-control-max-age')} Cache-Control=${opt.headers.get('cache-control')}`);

    const storeRes = await req('/api/store', { origin: ORIGIN });
    assert.equal(storeRes.status, 200, storeRes.text);
    assert.match(storeRes.headers.get('cache-control') ?? '', /public/i);
    assert.equal(data(storeRes).qpay?.ready, true);

    const phone = `8${String(Date.now()).slice(-7)}`;
    const token = await loginCustomer(phone, 'Traffic User');
    const products = data(await req('/api/products?type=ready&pageSize=50'));
    const shopReady = products.find((p) => p.ownerKind !== 'LEASING');
    const leaseReady = products.find((p) => p.ownerKind === 'LEASING');
    assert.ok(shopReady, 'shop product');
    assert.ok(leaseReady, 'leasing product');
    bumpStock(shopReady, 20);
    bumpStock(leaseReady, 20);

    const shopCreate = await req('/api/orders', {
      method: 'POST',
      token,
      body: { name: 'Traffic User', items: [lineOf(shopReady)] },
    });
    assert.equal(shopCreate.status, 201, shopCreate.text);
    const shop = data(shopCreate);
    const shopGet = await req(`/api/orders/${shop.code}`, { token, origin: ORIGIN });
    assert.equal(shopGet.status, 200, shopGet.text);
    assert.match(shopGet.headers.get('cache-control') ?? '', /no-store/i);

    const inv = await req(`/api/orders/${shop.code}/qpay/invoice`, { method: 'POST', token, body: {} });
    assert.equal(inv.status, 201, inv.text);
    const invoiceId = data(inv).invoiceId;
    mock.failNextCheck(invoiceId, 1);
    const delayed = await req(`/api/orders/${shop.code}/qpay/verify`, { method: 'POST', token, raw: true });
    live.notes.push(`QPay delay verify status=${delayed.status}`);
    mock.pay(invoiceId, shop.dueAmount);
    const cb = await req('/api/orders/qpay/callback', {
      method: 'POST',
      body: { invoice_id: invoiceId },
      raw: true,
    });
    assert.equal(cb.status, 200, cb.text);
    assert.equal(cb.text, 'SUCCESS');
    const paid = data(await req(`/api/orders/${shop.code}`, { token }));
    assert.equal(paid.dueAmount, 0);
    live.notes.push(`shop pay success ${shop.code}`);

    const part = data(
      await req('/api/orders', {
        method: 'POST',
        token,
        body: { name: 'Traffic User', items: [lineOf(shopReady)] },
      }),
    );
    const partInv = data(
      await req(`/api/orders/${part.code}/qpay/invoice`, { method: 'POST', token, body: {} }),
    );
    const slice = Math.min(40_000, Math.max(1, Math.floor(part.dueAmount / 2)));
    mock.pay(partInv.invoiceId, slice);
    const partCb = await req('/api/orders/qpay/callback', {
      method: 'POST',
      body: { invoice_id: partInv.invoiceId },
      raw: true,
    });
    assert.equal(partCb.status, 200, partCb.text);
    const partial = data(await req(`/api/orders/${part.code}`, { token }));
    assert.ok(partial.dueAmount > 0 && partial.paidAmount > 0, 'partial payment leftover');
    live.notes.push(`partial pay ${part.code} paid=${partial.paidAmount} due=${partial.dueAmount}`);

    const leaseCreate = await req('/api/orders', {
      method: 'POST',
      token,
      body: { name: 'Traffic User', leasing: true, items: [lineOf(shopReady)] },
    });
    assert.equal(leaseCreate.status, 201, leaseCreate.text);
    const lease = data(leaseCreate);
    const leaseView = data(await req(`/api/orders/${lease.code}`, { token }));
    assert.equal(leaseView.isLeasing, true);
    const feeAmt = leaseView.leasingFee || leaseView.nextPayAmount;
    assert.ok(feeAmt > 0 && feeAmt < leaseView.dueAmount, `fee ${feeAmt} due ${leaseView.dueAmount}`);
    const feeInv = data(
      await req(`/api/orders/${lease.code}/qpay/invoice`, {
        method: 'POST',
        token,
        body: { amount: feeAmt },
      }),
    );
    mock.pay(feeInv.invoiceId, feeAmt);
    const leaseCb = await req('/api/orders/leasing-qpay/callback', {
      method: 'POST',
      body: { invoice_id: feeInv.invoiceId },
      raw: true,
    });
    assert.equal(leaseCb.status, 200, leaseCb.text);
    const afterFee = data(await req(`/api/orders/${lease.code}`, { token }));
    const leftoverActive = Boolean(
      afterFee.payPlan?.dueToday || afterFee.payPlan?.overdue || afterFee.nextPayKind === 'BALANCE',
    );
    assert.equal(shouldPollPayment(afterFee), leftoverActive);
    assert.equal(shouldPollSuccess(afterFee), false);
    assert.ok(afterFee.dueAmount > 0, 'principal remainder remains');
    live.notes.push(
      `leasing leftover ${lease.code} nextPayKind=${afterFee.nextPayKind} dueToday=${Boolean(afterFee.payPlan?.dueToday)} poll=${shouldPollPayment(afterFee)} due=${afterFee.dueAmount}`,
    );

    const ownedCreate = await req('/api/orders', {
      method: 'POST',
      token,
      body: { name: 'Traffic User', items: [lineOf(leaseReady)] },
    });
    assert.equal(ownedCreate.status, 201, ownedCreate.text);
    const ownedId = sql(`SELECT id FROM "Order" WHERE code='${data(ownedCreate).code}'`);

    const adminLogin = await req('/api/admin/auth/login', {
      method: 'POST',
      body: { email: 'admin@itgel.mn', password: 'admin123' },
    });
    const adminToken = data(adminLogin).token;
    const leasingLogin = await req('/api/admin/auth/login', {
      method: 'POST',
      body: { email: 'leasing@itgel.mn', password: 'leasing123' },
    });
    const leasingToken = data(leasingLogin).token;

    const shopId = sql(`SELECT id FROM "Order" WHERE code='${part.code}'`);
    await req(`/api/admin/orders/${shopId}`, { token: adminToken });
    await req(`/api/admin/orders/${shopId}/payments`, { token: adminToken });
    await req(`/api/admin/orders/${shopId}/qpay`, { token: adminToken });
    const pay1 = await req(`/api/admin/orders/${shopId}/payments`, {
      method: 'POST',
      token: adminToken,
      body: { amount: 1, method: 'CASH', note: 'traffic-1' },
    });
    assert.ok(pay1.status === 201 || pay1.status === 200, pay1.text);
    await req(`/api/admin/orders/${shopId}`, { token: adminToken });
    await req(`/api/admin/orders/${shopId}/payments`, { token: adminToken });
    live.notes.push('admin mutation then detail reload (list deferred in UI)');

    const leaseId = sql(`SELECT id FROM "Order" WHERE code='${lease.code}'`);
    const preview = await req(`/api/leasing/orders/${leaseId}/ready-transfer`, { token: leasingToken });
    assert.equal(preview.status, 200, preview.text);
    live.notes.push(`ready-transfer GET ${preview.status} items=${data(preview).items?.length ?? 0}`);

    const ownedPreview = await req(`/api/leasing/orders/${ownedId}/ready-transfer`, { token: leasingToken });
    live.notes.push(`ready-transfer owned GET ${ownedPreview.status}`);

    const reopen = await req(`/api/orders/${lease.code}`, { token });
    assert.equal(reopen.status, 200);
    live.ok = true;
  } finally {
    await shutdown();
  }
}

const virtual = await measureVirtual();
printTally('ӨМНӨ (хуучин poll + store-every + list refetch + OPTIONS 5s)', virtual.before);
printTally('ДАРАА (poller + store once + deferred list + OPTIONS 600s)', virtual.after);
console.log(
  `\nбууралт: нийт ${virtual.before.total} → ${virtual.after.total}  ` +
    `(GET ${virtual.before.byMethod.GET} → ${virtual.after.byMethod.GET}, ` +
    `OPTIONS ${virtual.before.byMethod.OPTIONS} → ${virtual.after.byMethod.OPTIONS})`,
);
assert.ok(virtual.after.total < virtual.before.total, 'after must be lower');
assert.ok(virtual.after.byMethod.OPTIONS < virtual.before.byMethod.OPTIONS, 'OPTIONS must drop');
assert.ok(virtual.after.byMethod.GET < virtual.before.byMethod.GET, 'GET must drop');

console.log('\n--- амьд localhost + mock ---');
try {
  await runLive();
  for (const note of live.notes) console.log(`PASS ${note}`);
} catch (e) {
  console.error(e);
  fail(e instanceof Error ? e.message : String(e));
}

console.log('\n319 Edge Request-ийг энэ хэмжилт тайлбарлахгүй — 15 мин виртуал сценари + богино амьд урсгал.');
