/**
 * QPay v2 — зөвхөн merchant.qpay.mn-ийн нийтэлсэн endpoint:
 *   POST /v2/auth/token
 *   POST /v2/auth/refresh
 *   POST /v2/invoice
 *   DELETE /v2/invoice/{invoice_id}
 *   GET /v2/payment/{payment_id}
 *   POST /v2/payment/check
 *
 * Токеныг хугацаа дуусахаас өмнө дахин дахин авахгүй (refresh ашиглана).
 * sender_invoice_no давтахгүй. payment/check-ийг callback-ийн дараа л дуудна.
 */
import { env } from '../env.js';
import { conflict } from '../lib/errors.js';

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
export async function cancelQpayInvoice(invoiceId: string): Promise<void> {
  if (!invoiceId) return;
  try {
    await qpayFetch(`/invoice/${encodeURIComponent(invoiceId)}`, { method: 'DELETE' });
  } catch {
    /* цуцлагдсан / олдоогүй */
  }
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

/** GET /v2/payment/{payment_id} — callback зөвхөн payment_id илгээсэн үед. */
export async function getQpayPayment(paymentId: string): Promise<{
  invoiceId: string | null;
  paidAmount: number;
  paymentId: string;
}> {
  assertReady();
  const data = await qpayFetch<{
    payment_id?: string;
    invoice_id?: string;
    payment_amount?: string | number;
    paid_amount?: string | number;
  }>(`/payment/${encodeURIComponent(paymentId)}`, { method: 'GET' });

  return {
    invoiceId: data.invoice_id ?? null,
    paidAmount: Math.round(Number(data.payment_amount ?? data.paid_amount ?? 0)),
    paymentId: data.payment_id ?? paymentId,
  };
}
