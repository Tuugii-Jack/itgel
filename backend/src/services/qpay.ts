/**
 * QPay v2 — зөвхөн merchant.qpay.mn-ийн нийтэлсэн endpoint:
 *   POST /v2/auth/token
 *   POST /v2/auth/refresh
 *   POST /v2/invoice
 *   DELETE /v2/invoice/{invoice_id}
 *   GET /v2/payment/{payment_id}
 *   POST /v2/payment/check
 *   POST /v2/payment/list
 *   DELETE /v2/payment/cancel/{payment_id}
 *   DELETE /v2/payment/refund/{payment_id}
 *
 * Токеныг хугацаа дуусахаас өмнө дахин дахин авахгүй (refresh ашиглана).
 * sender_invoice_no давтахгүй. payment/check-ийг callback/гараар шалгахад л дуудна.
 */
import { env } from '../env.js';
import { audit } from '../lib/audit.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { prisma } from '../prisma.js';
import { lockOrder } from '../lib/orderLock.js';
import { confirmLeasingIfFeePaid, recordPayment, recordPaymentWithTotals } from './payments.js';

export interface QpayBankLink {
  name: string;
  description: string;
  logo: string | null;
  link: string;
}

export interface QpayInvoice {
  invoiceId: string;
  qrText: string;
  qrImage: string | null;
  shortUrl: string | null;
  urls: QpayBankLink[];
  amount: number;
}

export interface QpayCheckResult {
  paid: boolean;
  paidAmount: number;
  paymentIds: string[];
  invoiceId?: string;
}

export type QpayAccountKind = 'shop' | 'leasing';

interface TokenCache {
  access: string;
  refresh: string | null;
  expiresAt: number;
}

interface AccountState {
  cache: TokenCache | null;
  inflight: Promise<string> | null;
}

const accounts: Record<QpayAccountKind, AccountState> = {
  shop: { cache: null, inflight: null },
  leasing: { cache: null, inflight: null },
};

function accountCreds(kind: QpayAccountKind): {
  username: string;
  password: string;
  invoiceCode: string;
  callbackUrl: string;
  baseUrl: string;
} {
  if (kind === 'leasing') {
    return {
      username: env.LEASING_QPAY_CLIENT_ID ?? '',
      password: env.LEASING_QPAY_CLIENT_SECRET ?? '',
      invoiceCode: env.LEASING_QPAY_INVOICE_CODE ?? '',
      callbackUrl: env.LEASING_QPAY_CALLBACK_URL ?? '',
      baseUrl: env.LEASING_QPAY_BASE_URL ?? env.QPAY_BASE_URL,
    };
  }
  return {
    username: env.QPAY_USERNAME ?? '',
    password: env.QPAY_PASSWORD ?? '',
    invoiceCode: env.QPAY_INVOICE_CODE ?? '',
    callbackUrl: env.QPAY_CALLBACK_URL ?? '',
    baseUrl: env.QPAY_BASE_URL,
  };
}

export function qpayAccountForOrder(isLeasing: boolean): QpayAccountKind {
  return isLeasing ? 'leasing' : 'shop';
}

/** QPay `expires_in` заримдаа секунд, заримдаа unix timestamp буцаадаг. */
export function qpayTokenExpiresAtMs(
  data: { access_token: string; expires_in?: number },
  now = Date.now(),
): number {
  const expIn = data.expires_in;
  if (typeof expIn === 'number' && Number.isFinite(expIn) && expIn > 0) {
    if (expIn > 1_000_000_000) return expIn * 1000;
    return now + expIn * 1000;
  }
  const payload = decodeJwtPayload(data.access_token);
  if (typeof payload?.exp === 'number') return payload.exp * 1000;
  return now + 10 * 60 * 1000;
}

function decodeJwtPayload(token: string): { exp?: number } | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString()) as { exp?: number };
  } catch {
    return null;
  }
}

function qpayErrorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown };
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message;
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error;
  } catch {
    /* ignore */
  }
  return `QPay алдаа (${status}). Дахин оролдоно уу.`;
}

async function readJson<T>(res: Response, path: string): Promise<T> {
  const text = await res.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    console.error('[qpay] invalid json', path, text.slice(0, 300));
    throw conflict('QPay хариу буруу ирлээ. Дахин оролдоно уу.');
  }
}

export function isQpayEnabled(kind: QpayAccountKind = 'shop'): boolean {
  return kind === 'leasing' ? env.LEASING_QPAY_ENABLED : env.QPAY_ENABLED;
}

export function isQpayReady(kind: QpayAccountKind = 'shop'): boolean {
  const creds = accountCreds(kind);
  return Boolean(
    isQpayEnabled(kind) &&
      creds.username &&
      creds.password &&
      creds.invoiceCode &&
      creds.callbackUrl,
  );
}

export function qpayPublicStatus(): { enabled: boolean; ready: boolean } {
  return { enabled: isQpayEnabled('shop'), ready: isQpayReady('shop') };
}

export function leasingQpayPublicStatus(): { enabled: boolean; ready: boolean } {
  return { enabled: isQpayEnabled('leasing'), ready: isQpayReady('leasing') };
}

function assertReady(kind: QpayAccountKind = 'shop'): void {
  if (!isQpayReady(kind)) {
    throw conflict(
      kind === 'leasing'
        ? 'Лизингийн QPay одоогоор идэвхжээгүй.'
        : 'QPay одоогоор идэвхжээгүй. Дансаар шилжүүлэх сонголтыг ашиглана уу.',
      { code: 'QPAY_NOT_READY' },
    );
  }
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

function storeToken(
  kind: QpayAccountKind,
  data: TokenResponse,
  now = Date.now(),
): string {
  const state = accounts[kind];
  state.cache = {
    access: data.access_token,
    refresh: data.refresh_token ?? state.cache?.refresh ?? null,
    expiresAt: qpayTokenExpiresAtMs(data, now),
  };
  return data.access_token;
}

async function fetchAccessToken(kind: QpayAccountKind): Promise<string> {
  const creds = accountCreds(kind);
  const basic = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
  const res = await fetch(`${creds.baseUrl}/auth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[qpay:${kind}] auth failed`, res.status, body);
    throw conflict(qpayErrorMessage(res.status, body));
  }
  return storeToken(kind, await readJson<TokenResponse>(res, '/auth/token'));
}

async function refreshAccessToken(kind: QpayAccountKind, refreshToken: string): Promise<string> {
  const creds = accountCreds(kind);
  const res = await fetch(`${creds.baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${refreshToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[qpay:${kind}] refresh failed`, res.status, body);
    throw conflict(qpayErrorMessage(res.status, body));
  }
  return storeToken(kind, await readJson<TokenResponse>(res, '/auth/refresh'));
}

async function getAccessToken(kind: QpayAccountKind): Promise<string> {
  assertReady(kind);
  const state = accounts[kind];
  const now = Date.now();
  if (state.cache && state.cache.expiresAt > now + 60_000) return state.cache.access;
  if (state.inflight) return state.inflight;

  state.inflight = (async () => {
    try {
      if (state.cache?.refresh) {
        try {
          return await refreshAccessToken(kind, state.cache.refresh);
        } catch {
          state.cache = null;
        }
      }
      return await fetchAccessToken(kind);
    } finally {
      state.inflight = null;
    }
  })();

  return state.inflight;
}

async function qpayFetch<T>(
  path: string,
  init: RequestInit = {},
  kind: QpayAccountKind = 'shop',
): Promise<T> {
  const token = await getAccessToken(kind);
  const creds = accountCreds(kind);
  const res = await fetch(`${creds.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[qpay:${kind}]`, path, res.status, body);
    throw conflict(qpayErrorMessage(res.status, body));
  }

  return readJson<T>(res, path);
}

function mapInvoice(
  data: {
    invoice_id: string;
    qr_text?: string;
    qr_image?: string;
    qPay_shortUrl?: string;
    qpay_short_url?: string;
    urls?: { name?: string; description?: string; logo?: string; link?: string }[];
    amount?: number;
  },
  fallbackAmount: number,
): QpayInvoice {
  return {
    invoiceId: data.invoice_id,
    qrText: data.qr_text ?? '',
    qrImage: data.qr_image ?? null,
    shortUrl: data.qPay_shortUrl ?? data.qpay_short_url ?? null,
    urls: (data.urls ?? []).map((u) => ({
      name: u.name ?? '',
      description: u.description ?? '',
      logo: u.logo?.trim() ? u.logo : null,
      link: u.link ?? '',
    })),
    amount: Math.round(Number(data.amount ?? fallbackAmount)),
  };
}

/** POST /v2/invoice — QR + банкны deeplink эндээс ирнэ. sender_invoice_no давтахгүй. */
export async function createQpayInvoice(
  input: {
    orderCode: string;
    amount: number;
    description?: string;
  },
  kind: QpayAccountKind = 'shop',
): Promise<QpayInvoice> {
  assertReady(kind);
  if (input.amount <= 0) throw conflict('Төлөх дүн 0-ээс их байх ёстой.');

  const creds = accountCreds(kind);
  const senderInvoiceNo = `${input.orderCode}-${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;

  const data = await qpayFetch<{
    invoice_id: string;
    qr_text?: string;
    qr_image?: string;
    qPay_shortUrl?: string;
    qpay_short_url?: string;
    urls?: { name?: string; description?: string; logo?: string; link?: string }[];
    amount?: number;
  }>(
    '/invoice',
    {
      method: 'POST',
      body: JSON.stringify({
        invoice_code: creds.invoiceCode,
        sender_invoice_no: senderInvoiceNo,
        invoice_receiver_code: 'terminal',
        invoice_description: input.description ?? `Захиалга ${input.orderCode}`,
        amount: input.amount,
        callback_url: creds.callbackUrl,
      }),
    },
    kind,
  );

  return mapInvoice(data, input.amount);
}

/** DELETE /v2/invoice/{invoice_id} */
export async function cancelQpayInvoice(
  invoiceId: string,
  opts?: { silent?: boolean; kind?: QpayAccountKind },
): Promise<void> {
  if (!invoiceId) return;
  try {
    await qpayFetch(
      `/invoice/${encodeURIComponent(invoiceId)}`,
      { method: 'DELETE' },
      opts?.kind ?? 'shop',
    );
  } catch (e) {
    if (opts?.silent) return;
    throw e;
  }
}

/** QPay-ийн start_date / end_date — `yyyy-MM-dd HH:mm:ss`. */
export function toQpayDateTime(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed} 00:00:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return trimmed;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** POST /v2/payment/check — зөвхөн callback-ийн дараа эсвэл хэрэглэгч гараар шалгахад. */
export async function checkQpayInvoice(
  invoiceId: string,
  kind: QpayAccountKind = 'shop',
): Promise<QpayCheckResult> {
  assertReady(kind);

  const data = await qpayFetch<{
    count?: number;
    paid_amount?: number;
    rows?: { payment_id?: string; invoice_id?: string }[];
  }>(
    '/payment/check',
    {
      method: 'POST',
      body: JSON.stringify({
        object_type: 'INVOICE',
        object_id: invoiceId,
        offset: { page_number: 1, page_limit: 10 },
      }),
    },
    kind,
  );

  const rows = data.rows ?? [];
  const paidAmount = Math.round(Number(data.paid_amount ?? 0));
  return {
    paid: (data.count ?? 0) > 0 || paidAmount > 0,
    paidAmount,
    paymentIds: rows.map((r) => r.payment_id).filter((id): id is string => Boolean(id)),
    invoiceId: rows.find((r) => r.invoice_id)?.invoice_id,
  };
}

/** GET /v2/payment/{payment_id} */
export async function getQpayPayment(
  paymentId: string,
  kind: QpayAccountKind = 'shop',
): Promise<QpayPaymentDetail> {
  assertReady(kind);
  const data = await qpayFetch<Record<string, unknown>>(
    `/payment/${encodeURIComponent(paymentId)}`,
    { method: 'GET' },
    kind,
  );
  return mapPaymentDetail(data, paymentId);
}

export interface QpayPaymentDetail {
  paymentId: string;
  invoiceId: string | null;
  status: string | null;
  amount: number;
  currency: string | null;
  wallet: string | null;
  type: string | null;
  date: string | null;
}

export interface QpayPaymentList {
  count: number;
  rows: QpayPaymentDetail[];
}

function mapPaymentDetail(data: Record<string, unknown>, fallbackId: string): QpayPaymentDetail {
  const amount = Number(data.payment_amount ?? data.paid_amount ?? 0);
  return {
    paymentId: String(data.payment_id ?? fallbackId),
    invoiceId: typeof data.invoice_id === 'string' ? data.invoice_id : typeof data.object_id === 'string' ? data.object_id : null,
    status: typeof data.payment_status === 'string' ? data.payment_status : null,
    amount: Number.isFinite(amount) ? Math.round(amount) : 0,
    currency: typeof data.payment_currency === 'string' ? data.payment_currency : null,
    wallet: typeof data.payment_wallet === 'string' ? data.payment_wallet : null,
    type: typeof data.payment_type === 'string' ? data.payment_type : null,
    date: typeof data.payment_date === 'string' ? data.payment_date : typeof data.created_date === 'string' ? data.created_date : null,
  };
}

/** POST /v2/payment/list */
export async function listQpayPayments(
  input: {
    objectType?: string;
    objectId?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageLimit?: number;
  },
  kind: QpayAccountKind = 'shop',
): Promise<QpayPaymentList> {
  assertReady(kind);
  const body: Record<string, unknown> = {
    offset: {
      page_number: input.page ?? 1,
      page_limit: Math.min(input.pageLimit ?? 20, 100),
    },
  };
  if (input.objectType) body.object_type = input.objectType;
  if (input.objectId) {
    body.object_id = input.objectId;
    if (!input.objectType) body.object_type = 'INVOICE';
  }
  if (input.startDate) body.start_date = toQpayDateTime(input.startDate);
  if (input.endDate) body.end_date = toQpayDateTime(input.endDate);

  const data = await qpayFetch<{ count?: number; rows?: Record<string, unknown>[] }>(
    '/payment/list',
    { method: 'POST', body: JSON.stringify(body) },
    kind,
  );
  const rows = (data.rows ?? []).map((row) => mapPaymentDetail(row, String(row.payment_id ?? '')));
  return { count: data.count ?? rows.length, rows };
}

/** DELETE /v2/payment/cancel/{payment_id} */
export async function cancelQpayPayment(
  paymentId: string,
  kind: QpayAccountKind = 'shop',
): Promise<void> {
  assertReady(kind);
  await qpayFetch(
    `/payment/cancel/${encodeURIComponent(paymentId)}`,
    { method: 'DELETE' },
    kind,
  );
}

/** DELETE /v2/payment/refund/{payment_id} */
export async function refundQpayPayment(
  paymentId: string,
  kind: QpayAccountKind = 'shop',
): Promise<void> {
  assertReady(kind);
  await qpayFetch(
    `/payment/refund/${encodeURIComponent(paymentId)}`,
    { method: 'DELETE' },
    kind,
  );
}

/** Keep invoice ownership after replacement, cancellation, or a payment-method switch. */
export async function rememberQpayInvoice(
  orderId: string,
  invoiceId: string,
  account: QpayAccountKind,
  client: Pick<typeof prisma, 'qpayInvoice'> = prisma,
): Promise<void> {
  const invoice = await client.qpayInvoice.upsert({
    where: { id: invoiceId },
    create: { id: invoiceId, orderId, account },
    update: {},
  });
  if (invoice.orderId !== orderId || invoice.account !== account) {
    throw conflict('QPay нэхэмжлэл өөр захиалга эсвэл данстай холбогдсон байна.');
  }
}

/** amount is QPay's cumulative paid amount for this invoice, never the order balance. */
export async function applyQpayPayment(
  orderId: string,
  invoiceId: string,
  amount: number,
  paymentRef?: string,
  actor = 'system:qpay',
): Promise<boolean> {
  if (!Number.isSafeInteger(amount) || amount <= 0) return false;
  const recorded = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: { id: true, isLeasing: true },
    });
    if (!order) return false;
    const invoice = await tx.qpayInvoice.findUnique({ where: { id: invoiceId } });
    if (invoice && invoice.orderId !== orderId) throw conflict('QPay нэхэмжлэлийн захиалга зөрсөн.');
    if (!invoice) await rememberQpayInvoice(orderId, invoiceId, qpayAccountForOrder(order.isLeasing), tx);

    // Associate legacy records before calculating the already recorded cumulative amount.
    const reference = paymentRef ?? `qpay:${invoiceId}`;
    await tx.payment.updateMany({
      where: {
        orderId, kind: 'PAYMENT', method: 'QPAY', qpayInvoiceId: null,
        reference: { in: [...new Set([reference, `qpay:${invoiceId}`])] },
      },
      data: { qpayInvoiceId: invoiceId },
    });
    const previous = await tx.payment.aggregate({
      where: { orderId, kind: 'PAYMENT', qpayInvoiceId: invoiceId },
      _sum: { amount: true },
    });
    const payAmount = amount - (previous._sum.amount ?? 0);
    if (payAmount <= 0) return false;

    await recordPaymentWithTotals(tx, {
      orderId, kind: 'PAYMENT', amount: payAmount, method: 'QPAY',
      reference, qpayInvoiceId: invoiceId, note: 'QPay автомат бүртгэл', actor,
    });
    await audit({
      actor, action: 'QPAY_PAID', entity: 'Order', entityId: orderId,
      after: { invoiceId, amount: payAmount, reference },
    }, tx);
    return true;
  });
  if (recorded) await confirmLeasingIfFeePaid(orderId, actor);
  return recorded;
}

export async function findOrderByQpayInvoice(invoiceId: string) {
  if (!invoiceId) return null;
  const select = {
      id: true,
      code: true,
      dueAmount: true,
      paidAmount: true,
      qpayInvoiceId: true,
      qpayInvoiceAt: true,
      isLeasing: true,
      deletedAt: true,
    } as const;
  const invoice = await prisma.qpayInvoice.findUnique({
    where: { id: invoiceId },
    include: { order: { select } },
  });
  if (invoice) {
    if (invoice.order.deletedAt) return null;
    return { ...invoice.order, qpayAccount: invoice.account as QpayAccountKind };
  }
  const order = await prisma.order.findFirst({
    where: { qpayInvoiceId: invoiceId, deletedAt: null }, select,
  });
  return order ? { ...order, qpayAccount: qpayAccountForOrder(order.isLeasing) } : null;
}

/** Нэхэмжлэлийг QPay дээр цуцалж, захиалгаас id-г авна. */
export async function cancelStoredQpayInvoice(
  orderId: string,
  actor: string,
): Promise<{ invoiceId: string }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { id: true, code: true, qpayInvoiceId: true, isLeasing: true },
  });
  if (!order) throw notFound('Захиалга олдсонгүй.');
  if (!order.qpayInvoiceId) throw conflict('QPay нэхэмжлэл алга.');

  await rememberQpayInvoice(order.id, order.qpayInvoiceId, qpayAccountForOrder(order.isLeasing));
  await cancelQpayInvoice(order.qpayInvoiceId, {
    kind: qpayAccountForOrder(order.isLeasing),
  });

  await prisma.order.updateMany({
    where: { id: order.id, qpayInvoiceId: order.qpayInvoiceId },
    data: { qpayInvoiceId: null, qpayInvoiceAt: null },
  });

  await audit({
    actor,
    action: 'QPAY_INVOICE_CANCELLED',
    entity: 'Order',
    entityId: order.id,
    after: { code: order.code, invoiceId: order.qpayInvoiceId },
  });

  return { invoiceId: order.qpayInvoiceId };
}

/**
 * QPay дээрх төлбөрийг буцаасны дараа дэвтэрт REFUND бичнэ.
 * QPay амжилттай болсны дараа дуудна — дэвтрийн алдааг 500 болгохгүй.
 */
export async function recordQpayRefund(input: {
  invoiceId: string | null;
  paymentId: string;
  amount: number;
  actor: string;
  note: string;
}): Promise<{ orderId: string | null; orderCode: string | null; recorded: boolean; error: string | null }> {
  if (!input.invoiceId) {
    return { orderId: null, orderCode: null, recorded: false, error: null };
  }

  const order = await findOrderByQpayInvoice(input.invoiceId);
  if (!order) {
    return { orderId: null, orderCode: null, recorded: false, error: null };
  }

  const reference = `qpay-refund:${input.paymentId}`;
  const existing = await prisma.payment.findFirst({
    where: { orderId: order.id, reference, kind: 'REFUND' },
  });
  if (existing) {
    return { orderId: order.id, orderCode: order.code, recorded: false, error: null };
  }

  const amount = Math.round(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { orderId: order.id, orderCode: order.code, recorded: false, error: null };
  }

  try {
    await recordPayment({
      orderId: order.id,
      kind: 'REFUND',
      amount,
      method: 'QPAY',
      reference,
      note: input.note,
      actor: input.actor,
    });
    return { orderId: order.id, orderCode: order.code, recorded: true, error: null };
  } catch (e) {
    const message = e instanceof AppError ? e.message : 'Дэвтэрт буцаалт бичиж чадсангүй.';
    return { orderId: order.id, orderCode: order.code, recorded: false, error: message };
  }
}

/** QPay дээр төлбөр цуцлах/буцаах, олдвол дэвтэрт REFUND бичнэ. */
export async function reverseQpayPayment(input: {
  paymentId: string;
  mode: 'cancel' | 'refund';
  actor: string;
  kind?: QpayAccountKind;
}): Promise<{
  payment: QpayPaymentDetail;
  recorded: boolean;
  orderId: string | null;
  orderCode: string | null;
  ledgerError: string | null;
}> {
  const kind = input.kind ?? 'shop';
  const payment = await getQpayPayment(input.paymentId, kind);
  if (input.mode === 'cancel') await cancelQpayPayment(input.paymentId, kind);
  else await refundQpayPayment(input.paymentId, kind);

  const ledger = await recordQpayRefund({
    invoiceId: payment.invoiceId,
    paymentId: input.paymentId,
    amount: payment.amount,
    actor: input.actor,
    note: input.mode === 'cancel' ? 'QPay төлбөр цуцалсан' : 'QPay буцаалт',
  });

  return {
    payment,
    recorded: ledger.recorded,
    orderId: ledger.orderId,
    orderCode: ledger.orderCode,
    ledgerError: ledger.error,
  };
}
