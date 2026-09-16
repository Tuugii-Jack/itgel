import { describe, expect, it } from 'vitest';
import {
  OTP_MAX_ATTEMPTS,
  consumeOtpWithStore,
  type OtpClaimRow,
  type OtpClaimStore,
} from '../src/lib/otpClaim.js';

/**
 * Postgres `UPDATE … WHERE usedAt IS NULL AND attempts < 5` гэсэн
 * мөрийн нөхцөлийг JS дээр нэг урсгалд атомар CAS гэж загварчилна.
 * Await-ийн дараа шалгах/бичих хооронд yield хийхгүй — энгийн mock count=1 биш.
 */
function yieldTick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function createCasStore(initial: OtpClaimRow): OtpClaimStore & { snap: () => OtpClaimRow } {
  let row: OtpClaimRow = { ...initial };
  return {
    snap: () => ({ ...row }),
    async findLatestUnused() {
      await yieldTick();
      return row.usedAt ? null : { ...row };
    },
    async tryMarkUsed(id, code, now) {
      await yieldTick();
      if (
        row.id !== id ||
        row.usedAt ||
        row.attempts >= OTP_MAX_ATTEMPTS ||
        row.expiresAt <= now ||
        row.code !== code
      ) {
        return false;
      }
      row = { ...row, usedAt: now };
      return true;
    },
    async tryCountFailure(id, now) {
      await yieldTick();
      if (
        row.id !== id ||
        row.usedAt ||
        row.attempts >= OTP_MAX_ATTEMPTS ||
        row.expiresAt <= now
      ) {
        return null;
      }
      row = { ...row, attempts: row.attempts + 1 };
      return row.attempts;
    },
  };
}

function freshRow(): OtpClaimRow {
  return {
    id: 'otp-1',
    code: '123456',
    usedAt: null,
    attempts: 0,
    expiresAt: new Date(Date.now() + 60_000),
  };
}

describe('OTP зэрэг хүсэлт (CAS store)', () => {
  it('зөв кодыг зэрэг олон хүсэлт нэг л удаа амжилттай гэж үзнэ', async () => {
    const store = createCasStore(freshRow());
    const results = await Promise.all(
      Array.from({ length: 40 }, () => consumeOtpWithStore(store, '99112233', '123456')),
    );
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(store.snap().usedAt).toBeInstanceOf(Date);
    expect(results.filter((r) => r !== 'ok').every((r) => r === 'missing')).toBe(true);
  });

  it('буруу кодын зэрэг оролдлого 5-аас хэтрэхгүй', async () => {
    const store = createCasStore(freshRow());
    const results = await Promise.all(
      Array.from({ length: 40 }, () => consumeOtpWithStore(store, '99112233', '000000')),
    );
    expect(store.snap().attempts).toBe(OTP_MAX_ATTEMPTS);
    expect(store.snap().usedAt).toBeNull();
    expect(results.filter((r) => r === 'wrong')).toHaveLength(OTP_MAX_ATTEMPTS);
    expect(results.filter((r) => r === 'wrong' || r === 'locked' || r === 'missing')).toHaveLength(40);
  });

  it('5 буруу оролдлогын дараа зөв код ч түгжигдэнэ', async () => {
    const store = createCasStore(freshRow());
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      expect(await consumeOtpWithStore(store, '99112233', '000000')).toBe('wrong');
    }
    expect(await consumeOtpWithStore(store, '99112233', '123456')).toBe('locked');
    expect(store.snap().attempts).toBe(OTP_MAX_ATTEMPTS);
    expect(store.snap().usedAt).toBeNull();
  });

  it('амжилттай баталгаажуулалтын дараа ижил код дахин хэрэглэгдэхгүй', async () => {
    const store = createCasStore(freshRow());
    expect(await consumeOtpWithStore(store, '99112233', '123456')).toBe('ok');
    expect(await consumeOtpWithStore(store, '99112233', '123456')).toBe('missing');
  });
});
