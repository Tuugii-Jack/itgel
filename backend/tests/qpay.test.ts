import { describe, expect, it } from 'vitest';
import { qpayTokenExpiresAtMs, toQpayDateTime } from '../src/services/qpay.js';

function fakeJwt(exp: number): string {
  const payload = Buffer.from(JSON.stringify({ exp }), 'utf8').toString('base64url');
  return `hdr.${payload}.sig`;
}

describe('qpayTokenExpiresAtMs', () => {
  const now = 1_700_000_000_000;

  it('unix timestamp expires_in-ийг шууд ашиглана', () => {
    const exp = 1_786_791_105;
    expect(qpayTokenExpiresAtMs({ access_token: 'x', expires_in: exp }, now)).toBe(exp * 1000);
  });

  it('секундээр ирсэн expires_in-ийг now дээр нэмнэ', () => {
    expect(qpayTokenExpiresAtMs({ access_token: 'x', expires_in: 600 }, now)).toBe(now + 600_000);
  });

  it('expires_in байхгүй бол JWT exp уншина', () => {
    const exp = 1_700_000_600;
    expect(qpayTokenExpiresAtMs({ access_token: fakeJwt(exp) }, now)).toBe(exp * 1000);
  });
});

describe('toQpayDateTime', () => {
  it('огноог QPay формат руу хөрвүүлнэ', () => {
    expect(toQpayDateTime('2026-08-01')).toBe('2026-08-01 00:00:00');
    expect(toQpayDateTime('2026-08-01 12:30:00')).toBe('2026-08-01 12:30:00');
  });
});
