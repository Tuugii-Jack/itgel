import { describe, expect, it } from 'vitest';
import {
  canonicalCheckoutPayload,
  hashCheckoutPayload,
  isUniqueConstraintError,
  readCheckoutIdempotencyKey,
} from '../src/lib/checkoutIdempotency.js';

const items = [
  { productId: 'b', qty: 1, selections: { Өнгө: 'Хар', Хэмжээ: 'M' } },
  { productId: 'a', qty: 2, size: 'L' },
];

describe('checkout idempotency payload', () => {
  it('hashes the same cart regardless of item order or selection key order', () => {
    const left = hashCheckoutPayload({
      name: 'Батаа',
      note: 'note',
      leasing: false,
      items,
    });
    const right = hashCheckoutPayload({
      name: 'Батаа',
      note: 'note',
      leasing: false,
      items: [
        { productId: 'a', qty: 2, size: 'L' },
        { productId: 'b', qty: 1, selections: { Хэмжээ: 'M', Өнгө: 'Хар' } },
      ],
    });
    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
  });

  it('treats a new purchase of the same goods as a different payload when qty changes', () => {
    const base = { name: 'Батаа', items: [{ productId: 'a', qty: 1 }] };
    expect(hashCheckoutPayload(base)).not.toBe(
      hashCheckoutPayload({ ...base, items: [{ productId: 'a', qty: 2 }] }),
    );
    expect(hashCheckoutPayload(base)).not.toBe(hashCheckoutPayload({ ...base, leasing: true }));
  });

  it('does not put the idempotency key into the payload hash', () => {
    const hashed = hashCheckoutPayload({
      name: 'Батаа',
      items: [{ productId: 'a', qty: 1 }],
    });
    const canonical = JSON.stringify(
      canonicalCheckoutPayload({ name: 'Батаа', items: [{ productId: 'a', qty: 1 }] }),
    );
    expect(canonical).not.toContain('idempotency');
    expect(hashed).toHaveLength(64);
  });
});

describe('checkout idempotency key', () => {
  it('accepts a UUID from the header and ignores a blank body key', () => {
    expect(readCheckoutIdempotencyKey('11111111-1111-4111-8111-111111111111', '')).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(readCheckoutIdempotencyKey(undefined, undefined)).toBe(null);
  });

  it('rejects a short or unsafe key', () => {
    expect(() => readCheckoutIdempotencyKey('short')).toThrow(/Idempotency-Key/);
    expect(() => readCheckoutIdempotencyKey('bad key with space!!!!')).toThrow(/Idempotency-Key/);
  });

  it('recognizes a wrapped Prisma unique violation', () => {
    expect(isUniqueConstraintError({ code: 'P2002' })).toBe(true);
    expect(isUniqueConstraintError({ cause: { code: 'P2002' } })).toBe(true);
    expect(isUniqueConstraintError({ code: 'P2003' })).toBe(false);
  });
});
