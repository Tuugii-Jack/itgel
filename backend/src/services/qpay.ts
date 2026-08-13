/**
 * QPay v2 клиент — https://merchant.qpay.mn/v2
 *
 * Credential ирэхэд `.env`-д QPAY_* бөглөөд `QPAY_ENABLED=true` хийнэ.
 * Одоогоор тохируулаагүй бол `isQpayReady()` false буцаана — UI stub харуулна.
 */
import { env } from '../env.js';
import { conflict } from '../lib/errors.js';

export interface QpayInvoice {
  invoiceId: string;
  qrText: string;
  qrImage: string | null;
  shortUrl: string | null;
  urls: { name: string; description: string; link: string }[];
  amount: number;
}

export interface QpayCheckResult {
  paid: boolean;
  paidAmount: number;
  paymentIds: string[];
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

/** Feature flag асаалттай эсэх (UI дээр сонголт харуулах). */
export function isQpayEnabled(): boolean {
  return env.QPAY_ENABLED;
}

/** Жинхэнэ API дуудах бүх credential бэлэн эсэх. */
export function isQpayReady(): boolean {
  return Boolean(
    env.QPAY_ENABLED &&
      env.QPAY_USERNAME &&
      env.QPAY_PASSWORD &&
      env.QPAY_INVOICE_CODE &&
      env.QPAY_CALLBACK_URL,
  );
}

export function qpayPublicStatus(): {
  enabled: boolean;
  ready: boolean;
} {
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

async function getAccessToken(): Promise<string> {
  assertReady();
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 30_000) {
    return tokenCache.token;
  }

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
    throw conflict('QPay нэвтрэлт амжилтгүй. Тохиргоогоо шалгана уу.');
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  tokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
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
    throw conflict(`QPay алдаа (${res.status}). Дахин оролдоно уу.`);
  }

  return (await res.json()) as T;
}

function mapInvoice(
  data: {
    invoice_id: string;
    qr_text?: string;
    qr_image?: string;
    qPay_shortUrl?: string;
    qpay_short_url?: string;
    urls?: { name: string; description: string; link: string }[];
    amount?: number;
  },
  fallbackAmount: number,
): QpayInvoice {
  return {
    invoiceId: data.invoice_id,
    qrText: data.qr_text ?? '',
    qrImage: data.qr_image ?? null,
    shortUrl: data.qPay_shortUrl ?? data.qpay_short_url ?? null,
    urls: data.urls ?? [],
    amount: Math.round(Number(data.amount ?? fallbackAmount)),
  };
}

/** Өмнө үүсгэсэн нэхэмжлэлийг QPay-ээс авна. */
export async function getQpayInvoice(
  invoiceId: string,
  amount: number,
): Promise<QpayInvoice> {
  assertReady();
  const data = await qpayFetch<{
    invoice_id: string;
    qr_text?: string;
    qr_image?: string;
    qPay_shortUrl?: string;
    qpay_short_url?: string;
    urls?: { name: string; description: string; link: string }[];
    amount?: number;
  }>(`/invoice/${encodeURIComponent(invoiceId)}`, { method: 'GET' });
  return mapInvoice(data, amount);
}

/**
 * Захиалгад QPay нэхэмжлэл үүсгэнэ.
 * `sender_invoice_no` = захиалгын код (давхардахгүй байх ёстой).
 */
export async function createQpayInvoice(input: {
  orderCode: string;
  amount: number;
  description?: string;
}): Promise<QpayInvoice> {
  assertReady();
  if (input.amount <= 0) throw conflict('Төлөх дүн 0-ээс их байх ёстой.');

  const data = await qpayFetch<{
    invoice_id: string;
    qr_text?: string;
    qr_image?: string;
    qPay_shortUrl?: string;
    qpay_short_url?: string;
    urls?: { name: string; description: string; link: string }[];
    amount?: number;
  }>('/invoice', {
    method: 'POST',
    body: JSON.stringify({
      invoice_code: env.QPAY_INVOICE_CODE,
      sender_invoice_no: input.orderCode,
      invoice_receiver_code: 'terminal',
      invoice_description: input.description ?? `Захиалга ${input.orderCode}`,
      amount: input.amount,
      callback_url: env.QPAY_CALLBACK_URL,
    }),
  });

  return mapInvoice(data, input.amount);
}

/** Нэхэмжлэлийн төлбөр орсон эсэхийг QPay-ээс шалгана. */
export async function checkQpayInvoice(invoiceId: string): Promise<QpayCheckResult> {
  assertReady();

  const data = await qpayFetch<{
    count?: number;
    paid_amount?: number;
    rows?: { payment_id?: string }[];
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
  };
}
