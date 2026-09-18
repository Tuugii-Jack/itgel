#!/usr/bin/env node
/**
 * Тусгаарласан локал API дээрх төгсгөл-хүртэл урсгал.
 * Production DB / жинхэнэ QPay / CallPro руу явуулахыг хориглоно.
 *
 *   ISOLATED_API=http://127.0.0.1:4010 \
 *   DATABASE_URL=postgresql://itgel:itgel@127.0.0.1:5432/itgel \
 *   node tests/e2e/isolated-flows.mjs
 */
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createOtpWorkspace } from './otpWorkspace.mjs';

const API = (process.env.ISOLATED_API ?? '').replace(/\/$/, '');
const DB = process.env.DATABASE_URL ?? '';

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!API) fail('ISOLATED_API заагаагүй.');
if (/:(4001)\b/.test(API)) fail('4001 нь cloud .env-ийн порт — ашиглахгүй.');
if (!/localhost|127\.0\.0\.1/.test(DB)) fail(`DATABASE_URL локал биш: ${DB.replace(/:[^@]+@/, ':***@')}`);
if (!/localhost|127\.0\.0\.1/.test(API)) fail(`ISOLATED_API локал биш: ${API}`);

async function req(path, { method = 'GET', token, body, raw, idempotencyKey, forwardedFor } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  if (forwardedFor) headers['X-Forwarded-For'] = forwardedFor;
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
    throw new Error(`data алга (${res.status}): ${res.text.slice(0, 300)}`);
  }
  return res.json.data;
}

function sql(query) {
  return execFileSync(
    'docker',
    ['exec', 'itgel-db', 'psql', '-U', 'itgel', '-d', 'itgel', '-At', '-c', query],
    { encoding: 'utf8' },
  ).trim();
}

const workspaceOtp = createOtpWorkspace({ req, sql, data });

const phone = `8${String(Date.now()).slice(-7)}`;
const results = [];

function pass(name, detail = '') {
  results.push(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
  console.log(results.at(-1));
}

const health = await req('/health');
assert.equal(health.status, 200);
assert.equal(health.json.ok, true);
pass('health');

const store = data(await req('/api/store'));
assert.equal(store.qpay?.enabled, false, 'QPay идэвхтэй хэвээр — isolation амжилтгүй');
assert.equal(store.qpay?.ready, false);
pass('store QPay disabled');

const callback = await req('/api/orders/qpay/callback', {
  method: 'POST',
  body: { invoice_id: 'isolated-old-invoice', payment_id: 'p1' },
  raw: true,
});
assert.equal(callback.status, 503);
assert.equal(callback.text, 'RETRY');
const callback2 = await req('/api/orders/qpay/callback', {
  method: 'POST',
  body: { invoice_id: 'isolated-old-invoice', payment_id: 'p1' },
  raw: true,
});
assert.equal(callback2.status, 503);
assert.equal(callback2.text, 'RETRY');
pass('QPay callback short-circuit when disabled (double POST)');

const closedLogin = await req('/api/admin/auth/login', {
  method: 'POST',
  body: { email: 'admin@itgel.mn', password: 'admin123', role: 'ADMIN' },
});
assert.equal(closedLogin.status, 401, closedLogin.text);
pass('old admin password login closed');

const adminSession = await workspaceOtp.workspaceLogin('admin@itgel.mn', '99000001');
const adminToken = adminSession.token;
assert.equal(adminSession.user.role, 'ADMIN');
pass('ADMIN phone OTP login');

const leasingSession = await workspaceOtp.workspaceLogin('leasing@itgel.mn', '99000002');
const leasingToken = leasingSession.token;
assert.equal(leasingSession.user.role, 'LEASING');
pass('LEASING phone OTP login');

const staffEmail = `staffiso${phone}@itgel.mn`;
const staffCreate = await req('/api/admin/staff', {
  method: 'POST',
  token: adminToken,
  body: { email: staffEmail, name: 'Isolated Staff', password: 'staff123', role: 'STAFF' },
});
if (staffCreate.status !== 201 && staffCreate.status !== 200) {
  throw new Error(`staff create ${staffCreate.status}: ${staffCreate.text}`);
}
const staffPhone = `77${phone.slice(-6)}`;
const staffSession = await workspaceOtp.workspaceLogin(staffEmail, staffPhone);
const staffToken = staffSession.token;
assert.equal(staffSession.user.role, 'STAFF');
pass('STAFF create+OTP login');

const inactiveEmail = `inact${phone}@itgel.mn`;
const inactivePhone = `76${phone.slice(-6)}`;
const inactiveCreate = await req('/api/admin/staff', {
  method: 'POST',
  token: adminToken,
  body: { email: inactiveEmail, name: 'Inactive Staff', password: 'staff123', role: 'STAFF' },
});
assert.ok([200, 201].includes(inactiveCreate.status), inactiveCreate.text);
const inactiveId = data(inactiveCreate).id;
const inactiveSession = await workspaceOtp.workspaceLogin(inactiveEmail, inactivePhone);
assert.ok(inactiveSession.token);
const deactivated = await req(`/api/admin/staff/${inactiveId}`, {
  method: 'PATCH',
  token: adminToken,
  body: { isActive: false },
});
assert.equal(deactivated.status, 200, deactivated.text);
const stale = await req('/api/admin/orders?pageSize=1', { token: inactiveSession.token });
assert.equal(stale.status, 401);
const inactiveAgain = await workspaceOtp.otpVerify(inactivePhone, 'Inactive');
assert.equal(inactiveAgain.workspace, null);
pass('inactive admin has no privileged session');

const expiredPhone = `75${phone.slice(-6)}`;
const expiredOtp = await req('/api/auth/otp', { method: 'POST', body: { phone: expiredPhone, name: 'Expired' } });
assert.equal(expiredOtp.status, 200, expiredOtp.text);
sql(
  `UPDATE "PhoneOtp" SET "expiresAt"=NOW() - interval '1 minute' WHERE phone='${expiredPhone}' AND purpose='LOGIN' AND "usedAt" IS NULL`,
);
const expiredVerify = await req('/api/auth/verify', {
  method: 'POST',
  body: { phone: expiredPhone, code: workspaceOtp.latestLoginOtp(expiredPhone) },
});
assert.ok(expiredVerify.status === 400 || expiredVerify.status === 401, expiredVerify.text);
pass('expired OTP rejected');

const staffProducts = await req('/api/admin/products', { token: staffToken });
assert.equal(staffProducts.status, 403, 'STAFF бараа бичих/харах портал');
const staffOrdersGet = await req('/api/admin/orders?pageSize=1', { token: staffToken });
assert.equal(staffOrdersGet.status, 200);
pass('STAFF 403 on products, GET orders allowed');

const leasingOnAdmin = await req('/api/admin/orders?pageSize=1', { token: leasingToken });
assert.equal(leasingOnAdmin.status, 403);
const adminOnLeasing = await req('/api/leasing/orders?pageSize=1', { token: adminToken });
assert.equal(adminOnLeasing.status, 403);
pass('cross-portal 403');

const otp = await req('/api/auth/otp', { method: 'POST', body: { phone, name: 'Isolated User' } });
assert.equal(otp.status, 200, otp.text);
assert.notEqual(data(otp).smsStatus, 'delivered', 'queued/pending must not look delivered');
const code = sql(
  `SELECT code FROM "PhoneOtp" WHERE phone='${phone}' AND purpose='LOGIN' ORDER BY "createdAt" DESC LIMIT 1`,
);
assert.match(code, /^\d{6}$/);
const dispatchCount1 = Number(
  sql(`SELECT count(*) FROM "SmsDispatch" WHERE phone='${phone}' AND purpose='otp_login'`),
);
assert.equal(dispatchCount1, 1, 'OTP persist-then-send creates one SmsDispatch');
const otpAgain = await req('/api/auth/otp', { method: 'POST', body: { phone, name: 'Isolated User' } });
assert.equal(otpAgain.status, 200, otpAgain.text);
const dispatchCount2 = Number(
  sql(`SELECT count(*) FROM "SmsDispatch" WHERE phone='${phone}' AND purpose='otp_login'`),
);
assert.equal(dispatchCount2, 1, 'cooldown OTP must not send a second SMS');
const verify = await req('/api/auth/verify', {
  method: 'POST',
  body: { phone, code, role: 'ADMIN', adminId: 'adm-1', redirect: '/workspace' },
});
const customerToken = data(verify).token;
assert.ok(customerToken);
assert.equal(data(verify).workspace, null);
const spoofAdmin = await req('/api/admin/orders?pageSize=1', { token: customerToken });
assert.equal(spoofAdmin.status, 401);
const reused = await req('/api/auth/verify', { method: 'POST', body: { phone, code } });
assert.ok(reused.status === 400 || reused.status === 401, reused.text);
pass('customer phone OTP (local PhoneOtp, console SMS, no double-send)');

const products = data(await req('/api/products?type=ready&pageSize=50'));
const shopReady = products.find((p) => p.ownerKind !== 'LEASING' && !p.options?.length && p.stock >= 4);
const shopSkuReady = products.find(
  (p) =>
    p.ownerKind !== 'LEASING' &&
    Array.isArray(p.skuStocks) &&
    p.skuStocks.some((s) => s.stock > 0),
);
const leaseReady = products.find((p) => p.ownerKind === 'LEASING' && p.stock > 0);
assert.ok(shopReady, 'shop ready product');
assert.ok(leaseReady, 'leasing ready product');

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
  const size = product.sizes?.[0];
  const color = product.colors?.[0];
  return {
    productId: product.id,
    qty,
    ...(Object.keys(selections).length ? { selections } : {}),
    ...(size ? { size } : {}),
    ...(color ? { color } : {}),
  };
}

function skuKey(selections) {
  return Object.keys(selections)
    .sort((a, b) => a.localeCompare(b, 'mn'))
    .map((k) => `${k}=${selections[k]}`)
    .join('|');
}

const shopHoldBefore = {
  stock: Number(sql(`SELECT stock FROM "ProductRound" WHERE id='${shopReady.id}'`)),
  reserved: Number(sql(`SELECT reserved FROM "ProductRound" WHERE id='${shopReady.id}'`)),
  available: Number(sql(`SELECT available FROM "ProductRound" WHERE id='${shopReady.id}'`)),
};
const shopOrder = await req('/api/orders', {
  method: 'POST',
  token: customerToken,
  idempotencyKey: randomUUID(),
  body: { name: 'Isolated User', items: [lineOf(shopReady)] },
});
assert.equal(shopOrder.status, 201, shopOrder.text);
const shopCreated = data(shopOrder);
assert.equal(shopCreated.payeeKind, 'SHOP');
assert.equal(shopCreated.isLeasing, false);
assert.equal(shopCreated.splitOrders?.length ?? 0, 0);
const shopHoldAfter = {
  stock: Number(sql(`SELECT stock FROM "ProductRound" WHERE id='${shopReady.id}'`)),
  reserved: Number(sql(`SELECT reserved FROM "ProductRound" WHERE id='${shopReady.id}'`)),
  available: Number(sql(`SELECT available FROM "ProductRound" WHERE id='${shopReady.id}'`)),
};
assert.equal(shopHoldAfter.stock, shopHoldBefore.stock);
assert.equal(shopHoldAfter.reserved, shopHoldBefore.reserved + 1);
assert.equal(shopHoldAfter.available, shopHoldBefore.available - 1);
pass('shop order create + reserve not consume', shopCreated.code);

const cancelProduct = shopSkuReady ?? shopReady;
const cancelLine = lineOf(cancelProduct);
const cancelHoldBefore = {
  stock: Number(sql(`SELECT stock FROM "ProductRound" WHERE id='${cancelProduct.id}'`)),
  reserved: Number(sql(`SELECT reserved FROM "ProductRound" WHERE id='${cancelProduct.id}'`)),
  available: Number(sql(`SELECT available FROM "ProductRound" WHERE id='${cancelProduct.id}'`)),
};
const skuBefore = cancelLine.selections
  ? Number(
      sql(
        `SELECT available FROM "RoundSkuStock" WHERE "roundId"='${cancelProduct.id}' AND "skuKey"='${skuKey(cancelLine.selections)}'`,
      ) || '0',
    )
  : null;
const cancelOrderRes = await req('/api/orders', {
  method: 'POST',
  token: customerToken,
  idempotencyKey: randomUUID(),
  body: { name: 'Isolated User', items: [cancelLine] },
});
assert.equal(cancelOrderRes.status, 201, cancelOrderRes.text);
const cancelCreated = data(cancelOrderRes);
const cancelHoldAfterCreate = {
  stock: Number(sql(`SELECT stock FROM "ProductRound" WHERE id='${cancelProduct.id}'`)),
  reserved: Number(sql(`SELECT reserved FROM "ProductRound" WHERE id='${cancelProduct.id}'`)),
  available: Number(sql(`SELECT available FROM "ProductRound" WHERE id='${cancelProduct.id}'`)),
};
assert.equal(cancelHoldAfterCreate.stock, cancelHoldBefore.stock);
assert.equal(cancelHoldAfterCreate.reserved, cancelHoldBefore.reserved + 1);
assert.equal(cancelHoldAfterCreate.available, cancelHoldBefore.available - 1);
if (skuBefore != null) {
  const skuAfterCreate = Number(
    sql(
      `SELECT available FROM "RoundSkuStock" WHERE "roundId"='${cancelProduct.id}' AND "skuKey"='${skuKey(cancelLine.selections)}'`,
    ),
  );
  assert.equal(skuAfterCreate, skuBefore - 1);
}
pass('cancel-target order + reserve not consume', cancelCreated.code);

const mixed = await req('/api/orders', {
  method: 'POST',
  token: customerToken,
  idempotencyKey: randomUUID(),
  body: {
    name: 'Isolated User',
    leasing: true,
    items: [lineOf(shopReady), lineOf(leaseReady)],
  },
});
assert.equal(mixed.status, 201, mixed.text);
const mixedMain = data(mixed);
const mixedExtra = mixedMain.splitOrders ?? [];
assert.equal(mixedExtra.length, 1, 'mixed cart should split into 2 orders');
const mixedOrders = [mixedMain, mixedExtra[0]];
const shopSplit = mixedOrders.find((o) => o.payeeKind === 'LEASING' && o.isLeasing === true);
const leaseSplit = mixedOrders.find((o) => o.payeeKind === 'LEASING' && o.isLeasing === false);
assert.ok(shopSplit, 'shop items + leasing flag → payee LEASING isLeasing true');
assert.ok(leaseSplit, 'leasing-owned items → resale payee LEASING isLeasing false');
pass('mixed cart SHOP/LEASING split', `${shopSplit.code} + ${leaseSplit.code}`);

const shopRow = data(
  await req(`/api/admin/orders?q=${shopCreated.code}&pageSize=5`, { token: adminToken }),
)[0];
assert.ok(shopRow?.id);
const due = shopRow.dueAmount;
const paid = await req(`/api/admin/orders/${shopRow.id}/payments`, {
  method: 'POST',
  token: adminToken,
  body: { amount: due, method: 'CASH', reference: 'ISO' },
});
assert.equal(paid.status, 201, paid.text);
assert.equal(data(paid).totals.dueAmount, 0);
pass('payment zeros due', shopCreated.code);

async function patchStatus(orderId, status) {
  const res = await req(`/api/admin/orders/${orderId}/status`, {
    method: 'PATCH',
    token: adminToken,
    body: { status, reason: 'iso-e2e' },
  });
  assert.ok([200, 201].includes(res.status), `${status} ${res.text}`);
}

let shopStatus = data(await req(`/api/admin/orders/${shopRow.id}`, { token: adminToken })).status;
if (shopStatus === 'NEW') {
  await patchStatus(shopRow.id, 'CONFIRMED');
  shopStatus = data(await req(`/api/admin/orders/${shopRow.id}`, { token: adminToken })).status;
}
assert.equal(shopStatus, 'ARRIVED', `ready order should auto-arrive after confirm, got ${shopStatus}`);

const lookupOwn = await req(`/api/admin/handover/lookup?code=${shopCreated.code}`, {
  token: staffToken,
});
assert.equal(lookupOwn.status, 200, lookupOwn.text);
const foundOwn = data(lookupOwn);
const pickableIds = foundOwn.pickableItemIds ?? [];
assert.ok(pickableIds.length > 0, 'paid ready order should be pickable after ARRIVED');
const partial = await req('/api/admin/handover/partial', {
  method: 'POST',
  token: staffToken,
  body: { itemIds: [pickableIds[0]], collectedAmount: 0, method: 'CASH' },
});
assert.ok([200, 201].includes(partial.status), partial.text);
pass('partial handover of isolated order', shopCreated.code);

const refund = await req(`/api/admin/orders/${shopRow.id}/payments/refunds`, {
  method: 'POST',
  token: adminToken,
  body: { amount: Math.min(1000, due), method: 'CASH', note: 'iso-refund' },
});
assert.equal(refund.status, 201, refund.text);
assert.ok(data(refund).totals.refundedAmount > 0);
assert.ok(data(refund).totals.dueAmount > 0);
pass('refund restores due', shopCreated.code);

const shopId = sql(`SELECT id FROM "Order" WHERE code='${shopCreated.code}'`);
const shopSplitId = sql(`SELECT id FROM "Order" WHERE code='${shopSplit.code}'`);
const leaseSplitId = sql(`SELECT id FROM "Order" WHERE code='${leaseSplit.code}'`);
const cancelId = sql(`SELECT id FROM "Order" WHERE code='${cancelCreated.code}'`);

const leasingSeesShop = await req(`/api/leasing/orders/${shopId}`, { token: leasingToken });
assert.equal(leasingSeesShop.status, 404);
const leasingSeesHold = await req(`/api/leasing/orders/${shopSplitId}`, { token: leasingToken });
assert.equal(leasingSeesHold.status, 404, 'unpaid NEW installment is fee-hold');
const leasingSeesResale = await req(`/api/leasing/orders/${leaseSplitId}`, { token: leasingToken });
assert.equal(leasingSeesResale.status, 200, leasingSeesResale.text);
pass('LEASING cannot read shop-only or fee-hold; can read resale');

const leasingList = data(
  await req(
    '/api/leasing/orders?goods=resale&q=' + encodeURIComponent(leaseSplit.code) + '&pageSize=5',
    { token: leasingToken },
  ),
);
assert.ok(leasingList.some((o) => o.code === leaseSplit.code));

const shopProductId = sql(`SELECT "productId" FROM "ProductRound" WHERE id='${shopReady.id}'`);
const leasingShopProduct = await req(`/api/leasing/products/${shopProductId}`, {
  token: leasingToken,
});
assert.equal(leasingShopProduct.status, 404);
const leasingProducts = data(await req('/api/leasing/products?pageSize=20', { token: leasingToken }));
assert.ok(leasingProducts.every((p) => p.ownerKind === 'LEASING'));
pass('LEASING products are owner-scoped');

const resaleTransfer = await req(`/api/leasing/orders/${leaseSplitId}/ready-transfer`, {
  method: 'POST',
  token: leasingToken,
  body: {
    reason: 'isolated-e2e',
    lines: [{ orderItemId: 'x', qty: 1, resaleUnitPrice: 1 }],
  },
});
assert.equal(resaleTransfer.status, 409, 'resale (isLeasing=false) cannot ready-transfer');

const xferOrderId = sql(
  `SELECT o.id FROM "Order" o JOIN "OrderItem" i ON i."orderId"=o.id WHERE o."isLeasing"=true AND o."deletedAt" IS NULL AND NOT (o.status='NEW' AND o."paidAmount"=0) AND i."cancelledAt" IS NULL AND i."handedOverAt" IS NULL AND i."transferredAt" IS NULL AND i.qty>0 ORDER BY o."createdAt" DESC LIMIT 1`,
);
assert.ok(xferOrderId, 'need a non-fee-hold leasing installment with a live line');
const transferGet = await req(`/api/leasing/orders/${xferOrderId}/ready-transfer`, {
  token: leasingToken,
});
assert.equal(transferGet.status, 200, transferGet.text);
const eligible = (data(transferGet).items ?? []).filter((i) => i.eligible);
assert.ok(eligible.length > 0, 'installment should have a transferable line');
const transferLine = {
  orderItemId: eligible[0].id,
  qty: eligible[0].availableQty,
  resaleUnitPrice: eligible[0].unitPrice,
};
const transferBody = { reason: 'isolated-e2e', lines: [transferLine] };
const first = await req(`/api/leasing/orders/${xferOrderId}/ready-transfer`, {
  method: 'POST',
  token: leasingToken,
  body: transferBody,
});
assert.ok([200, 201].includes(first.status), first.text);
const second = await req(`/api/leasing/orders/${xferOrderId}/ready-transfer`, {
  method: 'POST',
  token: leasingToken,
  body: transferBody,
});
assert.ok([409, 400].includes(second.status), `double transfer ${second.status} ${second.text}`);
pass('ready-transfer + double-transfer guard', String(second.status));

const cancelDetail = data(await req(`/api/admin/orders/${cancelId}`, { token: adminToken }));
const live = (cancelDetail.items ?? []).find((i) => !i.cancelled);
assert.ok(live, 'cancel-target still has a live item');
const roundId = live.roundId ?? cancelProduct.id;
const stockBeforeCancel = Number(sql(`SELECT stock FROM "ProductRound" WHERE id='${roundId}'`));
const availableBeforeCancel = Number(sql(`SELECT available FROM "ProductRound" WHERE id='${roundId}'`));
const reservedBeforeCancel = Number(sql(`SELECT reserved FROM "ProductRound" WHERE id='${roundId}'`));
const skuAvailBeforeCancel =
  cancelLine.selections
    ? Number(
        sql(
          `SELECT available FROM "RoundSkuStock" WHERE "roundId"='${roundId}' AND "skuKey"='${skuKey(cancelLine.selections)}'`,
        ) || '0',
      )
    : null;
const cancelled = await req(`/api/admin/orders/${cancelId}/payments/items/${live.id}/cancel`, {
  method: 'POST',
  token: adminToken,
  body: { reason: 'iso-cancel', refund: false },
});
assert.equal(cancelled.status, 200, cancelled.text);
const stockAfterCancel = Number(sql(`SELECT stock FROM "ProductRound" WHERE id='${roundId}'`));
const availableAfterCancel = Number(sql(`SELECT available FROM "ProductRound" WHERE id='${roundId}'`));
const reservedAfterCancel = Number(sql(`SELECT reserved FROM "ProductRound" WHERE id='${roundId}'`));
assert.equal(stockAfterCancel, stockBeforeCancel);
assert.equal(availableAfterCancel, availableBeforeCancel + live.qty);
assert.equal(reservedAfterCancel, reservedBeforeCancel - live.qty);
if (skuAvailBeforeCancel != null) {
  const skuAfterCancel = Number(
    sql(
      `SELECT available FROM "RoundSkuStock" WHERE "roundId"='${roundId}' AND "skuKey"='${skuKey(cancelLine.selections)}'`,
    ),
  );
  assert.equal(skuAfterCancel, skuAvailBeforeCancel + live.qty);
}
pass('cancel releases reserved available', `${availableBeforeCancel}→${availableAfterCancel}`);

const batches = data(await req('/api/admin/batches?pageSize=20', { token: adminToken }));
assert.ok(Array.isArray(batches));

const closedAt = new Date(Date.now() - 86400000).toISOString();
const newRoundRes = await req(`/api/admin/products/${shopProductId}/rounds`, {
  method: 'POST',
  token: adminToken,
  body: {
    closeAt: closedAt,
    status: 'CLOSED',
    sellPrice: shopReady.price || 1000,
    stock: 0,
    skuStocks: [],
    optionPrices: [],
    note: 'iso-e2e-arrival',
  },
});
assert.equal(newRoundRes.status, 201, newRoundRes.text);
const newRound = (data(newRoundRes).rounds ?? []).find((r) => r.note === 'iso-e2e-arrival');
assert.ok(newRound?.id, 'closed round for isolated batch');
const customerId = sql(`SELECT "customerId" FROM "Order" WHERE code='${shopCreated.code}'`);
const preorder = await req('/api/admin/orders', {
  method: 'POST',
  token: adminToken,
  body: {
    customerId,
    name: 'Isolated User',
    status: 'CONFIRMED',
    markPaid: true,
    items: [{ productId: newRound.id, qty: 2 }],
  },
});
assert.equal(preorder.status, 201, preorder.text);
const isoBatch = await req('/api/admin/batches', {
  method: 'POST',
  token: adminToken,
  body: { name: `ISO-E2E ${phone}` },
});
assert.equal(isoBatch.status, 201, isoBatch.text);
const isoBatchId = data(isoBatch).id;
const linked = await req(`/api/admin/batches/${isoBatchId}/products`, {
  method: 'POST',
  token: adminToken,
  body: { roundId: newRound.id },
});
assert.ok([200, 201].includes(linked.status), linked.text);
const wave1 = await req(`/api/admin/batches/${isoBatchId}/arrivals`, {
  method: 'POST',
  token: adminToken,
  body: { lines: [{ roundId: newRound.id, selections: {}, arrivedQty: 1 }] },
});
assert.equal(wave1.status, 200, wave1.text);
assert.equal(data(wave1).allocated, 1);
const wave1again = await req(`/api/admin/batches/${isoBatchId}/arrivals`, {
  method: 'POST',
  token: adminToken,
  body: { lines: [{ roundId: newRound.id, selections: {}, arrivedQty: 1 }] },
});
assert.equal(wave1again.status, 200, wave1again.text);
assert.equal(data(wave1again).allocated, 0);
const wave2 = await req(`/api/admin/batches/${isoBatchId}/arrivals`, {
  method: 'POST',
  token: adminToken,
  body: { lines: [{ roundId: newRound.id, selections: {}, arrivedQty: 2 }] },
});
assert.equal(wave2.status, 200, wave2.text);
assert.equal(data(wave2).allocated, 1);
pass('batch arrival partial + idempotent + remainder', data(isoBatch).name);

const dupKey = randomUUID();
const doubleOrder = await Promise.all([
  req('/api/orders', {
    method: 'POST',
    token: customerToken,
    idempotencyKey: dupKey,
    forwardedFor: '127.0.0.81',
    body: { name: 'Isolated User', items: [lineOf(shopReady)] },
  }),
  req('/api/orders', {
    method: 'POST',
    token: customerToken,
    idempotencyKey: dupKey,
    forwardedFor: '127.0.0.82',
    body: { name: 'Isolated User', items: [lineOf(shopReady)] },
  }),
]);
assert.equal(doubleOrder.filter((r) => r.status === 201).length, 2, doubleOrder.map((r) => r.text).join(' | '));
assert.equal(data(doubleOrder[0]).code, data(doubleOrder[1]).code);
pass('double submit same key returns one order', data(doubleOrder[0]).code);

const cronSecret = process.env.CRON_SECRET ?? '';
assert.ok(cronSecret.length >= 8, 'isolated CRON_SECRET required');
const beforePoll = Number(sql(`SELECT count(*) FROM "SmsDispatch"`));
const cronDenied = await req('/api/cron/sms-delivery');
assert.equal(cronDenied.status, 401, cronDenied.text);
const cronWrong = await req('/api/cron/sms-delivery', { token: 'wrong-secret' });
assert.equal(cronWrong.status, 401, cronWrong.text);
const cronOk = await req('/api/cron/sms-delivery', { token: cronSecret });
assert.equal(cronOk.status, 200, cronOk.text);
assert.equal(typeof data(cronOk).checked, 'number');
const afterPoll = Number(sql(`SELECT count(*) FROM "SmsDispatch"`));
assert.equal(afterPoll, beforePoll, 'delivery poll must not insert/resend SMS');
pass('cron sms-delivery auth + no resend');

console.log('\nIsolated API flows:', results.length);
for (const row of results) console.log(' ', row);
