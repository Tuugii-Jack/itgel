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
import { recordPayment } from './payments.js';

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

interface TokenCache {
  access: string;
  refresh: string | null;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;
let authInflight: Promise<string> | null = null;

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

export function isQpayEnabled(): boolean {
  return env.QPAY_ENABLED;
}

export function isQpayReady(): boolean {
  return Boolean(
    env.QPAY_ENABLED &&
      env.QPAY_USERNAME &&
      env.QPAY_PASSWORD &&
      env.QPAY_INVOICE_CODE &&
      env.QPAY_CALLBACK_URL,
  );
}

export function qpayPublicStatus(): { enabled: boolean; ready: boolean } {
  return { enabled: isQpayEnabled(), ready: isQpayReady() };
}

function assertReady(): void {
  if (!isQpayReady()) {
    throw conflict(
      'QPay одоогоор идэвхжээгүй. Дансаар шилжүүлэх сонголтыг ашиглана уу.',
      { code: 'QPAY_NOT_READY' },
    );
  }
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

function storeToken(data: TokenResponse, now = Date.now()): string {
  tokenCache = {
    access: data.access_token,
    refresh: data.refresh_token ?? tokenCache?.refresh ?? null,
    expiresAt: qpayTokenExpiresAtMs(data, now),
  };
  return data.access_token;
}

async function fetchAccessToken(): Promise<string> {
  const basic = Buffer.from(`${env.QPAY_USERNAME}:${env.QPAY_PASSWORD}`).toString('base64');
  const res = await fetch(`${env.QPAY_BASE_URL}/auth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[qpay] auth failed', res.status, body);
    throw conflict(qpayErrorMessage(res.status, body));
  }
  return storeToken(await readJson<TokenResponse>(res, '/auth/token'));
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(`${env.QPAY_BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${refreshToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[qpay] refresh failed', res.status, body);
    throw conflict(qpayErrorMessage(res.status, body));
  }
  return storeToken(await readJson<TokenResponse>(res, '/auth/refresh'));
}

async function getAccessToken(): Promise<string> {
  assertReady();
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.access;
  if (authInflight) return authInflight;

  authInflight = (async () => {
    try {
      if (tokenCache?.refresh) {
        try {
          return await refreshAccessToken(tokenCache.refresh);
        } catch {
          tokenCache = null;
        }
      }
      return await fetchAccessToken();
    } finally {
      authInflight = null;
    }
  })();

  return authInflight;
}

async function qpayFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${env.QPAY_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[qpay]', path, res.status, body);
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
export async function createQpayInvoice(input: {
  orderCode: string;
  amount: number;
  description?: string;
}): Promise<QpayInvoice> {
  assertReady();
  if (input.amount <= 0) throw conflict('Төлөх дүн 0-ээс их байх ёстой.');

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
  }>('/invoice', {
    method: 'POST',
    body: JSON.stringify({
      invoice_code: env.QPAY_INVOICE_CODE,
      sender_invoice_no: senderInvoiceNo,
      invoice_receiver_code: 'terminal',
      invoice_description: input.description ?? `Захиалга ${input.orderCode}`,
      amount: input.amount,
      callback_url: env.QPAY_CALLBACK_URL,
    }),
  });

  return mapInvoice(data, input.amount);
}

/** DELETE /v2/invoice/{invoice_id} */
export async function cancelQpayInvoice(
  invoiceId: string,
  opts?: { silent?: boolean },
): Promise<void> {
  if (!invoiceId) return;
  try {
    await qpayFetch(`/invoice/${encodeURIComponent(invoiceId)}`, { method: 'DELETE' });
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
export async function checkQpayInvoice(invoiceId: string): Promise<QpayCheckResult> {
  assertReady();

  const data = await qpayFetch<{
    count?: number;
    paid_amount?: number;
    rows?: { payment_id?: string; invoice_id?: string }[];
  }>('/payment/check', {
    method: 'POST',
    body: JSON.stringify({
      object_type: 'INVOICE',
      object_id: invoiceId,
      offset: { page_number: 1, page_limit: 10 },
    }),
  });

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
export async function getQpayPayment(paymentId: string): Promise<QpayPaymentDetail> {
  assertReady();
  const data = await qpayFetch<Record<string, unknown>>(
    `/payment/${encodeURIComponent(paymentId)}`,
    { method: 'GET' },
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
export async function listQpayPayments(input: {
  objectType?: string;
  objectId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageLimit?: number;
}): Promise<QpayPaymentList> {
  assertReady();
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
  );
  const rows = (data.rows ?? []).map((row) => mapPaymentDetail(row, String(row.payment_id ?? '')));
  return { count: data.count ?? rows.length, rows };
}

/** DELETE /v2/payment/cancel/{payment_id} */
export async function cancelQpayPayment(paymentId: string): Promise<void> {
  assertReady();
  await qpayFetch(`/payment/cancel/${encodeURIComponent(paymentId)}`, { method: 'DELETE' });
}

/** DELETE /v2/payment/refund/{payment_id} */
export async function refundQpayPayment(paymentId: string): Promise<void> {
  assertReady();
  await qpayFetch(`/payment/refund/${encodeURIComponent(paymentId)}`, { method: 'DELETE' });
}

/** QPay төлбөрийг дэвтэрт бүртгэнэ — давхар webhook/check-д аюулгүй. */
export async function applyQpayPayment(
  orderId: string,
  invoiceId: string,
  amount: number,
  paymentRef?: string,
  actor = 'system:qpay',
): Promise<boolean> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { dueAmount: true, id: true },
  });
  if (!order || order.dueAmount <= 0) return false;

  const payAmount = Math.min(amount, order.dueAmount);
  if (payAmount <= 0) return false;

  const reference = paymentRef ?? `qpay:${invoiceId}`;
  const existing = await prisma.payment.findFirst({
    where: { orderId, reference, kind: 'PAYMENT' },
  });
  if (existing) return false;

  await recordPayment({
    orderId,
    kind: 'PAYMENT',
    amount: payAmount,
    method: 'QPAY',
    reference,
    note: 'QPay автомат бүртгэл',
    actor,
  });

  await audit({
    actor,
    action: 'QPAY_PAID',
    entity: 'Order',
    entityId: orderId,
    after: { invoiceId, amount: payAmount, reference },
  });
  return true;
}

export async function findOrderByQpayInvoice(invoiceId: string) {
  if (!invoiceId) return null;
  return prisma.order.findFirst({
    where: { qpayInvoiceId: invoiceId, deletedAt: null },
    select: {
      id: true,
      code: true,
      dueAmount: true,
      paidAmount: true,
      qpayInvoiceId: true,
      qpayInvoiceAt: true,
    },
  });
}

/** Нэхэмжлэлийг QPay дээр цуцалж, захиалгаас id-г авна. */
export async function cancelStoredQpayInvoice(
  orderId: string,
  actor: string,
): Promise<{ invoiceId: string }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { id: true, code: true, qpayInvoiceId: true },
  });
  if (!order) throw notFound('Захиалга олдсонгүй.');
  if (!order.qpayInvoiceId) throw conflict('QPay нэхэмжлэл алга.');

  await cancelQpayInvoice(order.qpayInvoiceId);

  await prisma.order.update({
    where: { id: order.id },
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
}): Promise<{
  payment: QpayPaymentDetail;
  recorded: boolean;
  orderId: string | null;
  orderCode: string | null;
  ledgerError: string | null;
}> {
  const payment = await getQpayPayment(input.paymentId);
  if (input.mode === 'cancel') await cancelQpayPayment(input.paymentId);
  else await refundQpayPayment(input.paymentId);

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
