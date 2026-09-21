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
 * sender_invoice_no-г идемпотент create гэж үзэхгүй — timeout-ийн дараа POST /invoice дахин явуулахгүй,
 * POST /invoice/list-ээр хайна. payment/check-ийг callback/гараар шалгахад л дуудна.
 */
import { env } from '../../env.js';
import { conflict, isQpayTimeoutError, qpayTimeout } from '../../lib/errors.js';

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

export function qpayAccountForOrder(
  order: boolean | { isLeasing?: boolean | null; payeeKind?: string | null },
): QpayAccountKind {
  if (typeof order === 'boolean') return order ? 'leasing' : 'shop';
  if (order.payeeKind === 'LEASING' || order.isLeasing) return 'leasing';
  return 'shop';
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
  opts?: { timeoutMs?: number },
): Promise<T> {
  const token = await getAccessToken(kind);
  const creds = accountCreds(kind);
  const timeoutMs = opts?.timeoutMs;
  const ac = timeoutMs ? new AbortController() : null;
  const timer = timeoutMs
    ? setTimeout(() => ac!.abort(), timeoutMs)
    : null;
  try {
    const res = await fetch(`${creds.baseUrl}${path}`, {
      ...init,
      signal: ac?.signal ?? init.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[qpay:${kind}]`, path, res.status, body);
      throw conflict(qpayErrorMessage(res.status, body), { qpayStatus: res.status });
    }

    return await readJson<T>(res, path);
  } catch (error) {
    if (isQpayTimeoutError(error) || (ac?.signal.aborted ?? false)) {
      throw qpayTimeout('QPay хариу өгсөнгүй. Нэхэмжлэл үүссэн байж болно.');
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
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

/** POST /v2/invoice — QR + банкны deeplink эндээс ирнэ. Давхардал идемпотент гэж батлагдаагүй. */
export async function createQpayInvoice(
  input: {
    orderCode: string;
    amount: number;
    description?: string;
    /** Тогтвортой дугаар — timeout-оор давхар invoice үүсгэхгүй. */
    senderInvoiceNo?: string;
    timeoutMs?: number;
  },
  kind: QpayAccountKind = 'shop',
): Promise<QpayInvoice> {
  assertReady(kind);
  if (input.amount <= 0) throw conflict('Төлөх дүн 0-ээс их байх ёстой.');

  const creds = accountCreds(kind);
  const senderInvoiceNo =
    input.senderInvoiceNo?.trim() ||
    `${input.orderCode}-${Date.now().toString(36)}${Math.random()
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
    input.timeoutMs ? { timeoutMs: input.timeoutMs } : undefined,
  );

  return mapInvoice(data, input.amount);
}

export type QpayInvoiceListRow = {
  invoiceId: string;
  senderInvoiceNo: string | null;
  amount: number;
  status: string | null;
};

/** POST /v2/invoice/list — sender_invoice_no-оор нэхэмжлэл хайна. Create-ийг орлохгүй. */
export async function listQpayInvoices(
  input: { senderInvoiceNo: string; page?: number; pageLimit?: number },
  kind: QpayAccountKind = 'shop',
): Promise<QpayInvoiceListRow[]> {
  assertReady(kind);
  const sender = input.senderInvoiceNo.trim();
  if (!sender) return [];
  const creds = accountCreds(kind);
  const data = await qpayFetch<{ count?: number; rows?: Record<string, unknown>[] }>(
    '/invoice/list',
    {
      method: 'POST',
      body: JSON.stringify({
        invoice_code: creds.invoiceCode,
        sender_invoice_no: sender,
        offset: {
          page_number: input.page ?? 1,
          page_limit: Math.min(input.pageLimit ?? 20, 100),
        },
      }),
    },
    kind,
  );
  return (data.rows ?? [])
    .map((row) => {
      const invoiceId = String(row.invoice_id ?? row.invoiceId ?? '').trim();
      const amount = Number(row.amount ?? 0);
      return {
        invoiceId,
        senderInvoiceNo: typeof row.sender_invoice_no === 'string' ? row.sender_invoice_no : sender,
        amount: Number.isFinite(amount) ? Math.round(amount) : 0,
        status: typeof row.invoice_status === 'string' ? row.invoice_status : null,
      };
    })
    .filter((row) => row.invoiceId);
}

/** GET /v2/invoice/{id} */
export async function getQpayInvoice(
  invoiceId: string,
  kind: QpayAccountKind = 'shop',
  fallbackAmount = 0,
): Promise<QpayInvoice> {
  assertReady(kind);
  const data = await qpayFetch<Record<string, unknown>>(
    `/invoice/${encodeURIComponent(invoiceId)}`,
    { method: 'GET' },
    kind,
  );
  return mapInvoice(
    {
      invoice_id: String(data.invoice_id ?? data.invoiceId ?? invoiceId),
      qr_text: typeof data.qr_text === 'string' ? data.qr_text : undefined,
      qr_image: typeof data.qr_image === 'string' ? data.qr_image : undefined,
      qPay_shortUrl: typeof data.qPay_shortUrl === 'string' ? data.qPay_shortUrl : undefined,
      qpay_short_url: typeof data.qpay_short_url === 'string' ? data.qpay_short_url : undefined,
      urls: Array.isArray(data.urls)
        ? (data.urls as { name?: string; description?: string; logo?: string; link?: string }[])
        : undefined,
      amount: Number(data.amount ?? fallbackAmount),
    },
    fallbackAmount,
  );
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
