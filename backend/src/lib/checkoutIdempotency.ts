import { createHash } from 'node:crypto';
import { AppError, badRequest, conflict } from './errors.js';

const KEY_RE = /^[A-Za-z0-9._:-]+$/;

export type CheckoutItemPayload = {
  productId: string;
  qty: number;
  selections?: Record<string, string>;
  size?: string;
  color?: string;
};

export type CheckoutPayload = {
  name?: string;
  note?: string;
  leasing?: boolean;
  items: CheckoutItemPayload[];
};

function sortRecord(value: Record<string, string> | undefined): Record<string, string> {
  if (!value) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([k, v]) => [k.trim(), v.trim()] as const)
      .filter(([k, v]) => k && v)
      .sort(([a], [b]) => a.localeCompare(b, 'en')),
  );
}

/** Ижил сагс өөр дараалалтай ирэхэд ижил hash гаргана. */
export function canonicalCheckoutPayload(body: CheckoutPayload): unknown {
  const items = body.items.map((item) => ({
    productId: item.productId,
    qty: item.qty,
    selections: sortRecord(item.selections),
    size: item.size?.trim() || null,
    color: item.color?.trim() || null,
  }));
  items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
  return {
    leasing: Boolean(body.leasing),
    note: body.note?.trim() || null,
    name: body.name?.trim() || null,
    items,
  };
}

export function hashCheckoutPayload(body: CheckoutPayload): string {
  return createHash('sha256').update(JSON.stringify(canonicalCheckoutPayload(body))).digest('hex');
}

export function readCheckoutIdempotencyKey(
  header: string | string[] | undefined,
  bodyKey?: string,
): string | null {
  const fromHeader = Array.isArray(header) ? header[0] : header;
  const raw = (fromHeader ?? bodyKey ?? '').trim();
  if (!raw) return null;
  if (raw.length < 8 || raw.length > 128 || !KEY_RE.test(raw)) {
    throw badRequest('Idempotency-Key буруу байна.');
  }
  return raw;
}

export function isUniqueConstraintError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && (current as { code: unknown }).code === 'P2002') return true;
    current = 'cause' in current ? (current as { cause: unknown }).cause : null;
  }
  return false;
}

export function idempotencyKeyReused(): AppError {
  return conflict('Энэ Idempotency-Key өөр захиалгад аль хэдийн ашиглагдсан.', {
    code: 'IDEMPOTENCY_KEY_REUSED',
  });
}

export function idempotencyInFlight(): AppError {
  return new AppError(
    503,
    'RETRY',
    'Захиалга хадгалагдаж байна. Дахин оролдоно уу.',
  );
}
