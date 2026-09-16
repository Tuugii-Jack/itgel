import { badRequest, tooManyRequests, unauthorized } from './errors.js';

/** OTP оролдлого — зэрэг хүсэлтэд UPDATE … WHERE нөхцөлөөр хязгаарлана. */
export const OTP_MAX_ATTEMPTS = 5;

export type OtpClaimRow = {
  id: string;
  code: string;
  usedAt: Date | null;
  attempts: number;
  expiresAt: Date;
};

export type OtpClaimResult = 'ok' | 'missing' | 'expired' | 'locked' | 'wrong';

/**
 * Өгөгдлийн сангийн мөртэй ижил нөхцөл:
 * usedAt IS NULL AND attempts < MAX AND expiresAt > now AND (code match → usedAt, else attempts++).
 */
export type OtpClaimStore = {
  findLatestUnused: (key: string) => Promise<OtpClaimRow | null>;
  tryMarkUsed: (id: string, code: string, now: Date) => Promise<boolean>;
  tryCountFailure: (id: string, now: Date) => Promise<number | null>;
};

export async function consumeOtpWithStore(
  store: OtpClaimStore,
  key: string,
  code: string,
  now = new Date(),
): Promise<OtpClaimResult> {
  const otp = await store.findLatestUnused(key);
  if (!otp) return 'missing';
  if (otp.attempts >= OTP_MAX_ATTEMPTS) return 'locked';
  if (otp.expiresAt <= now) return 'expired';

  if (otp.code === code) {
    const claimed = await store.tryMarkUsed(otp.id, code, now);
    return claimed ? 'ok' : 'missing';
  }

  const next = await store.tryCountFailure(otp.id, now);
  if (next === null) {
    return otp.attempts + 1 >= OTP_MAX_ATTEMPTS ? 'locked' : 'missing';
  }
  return 'wrong';
}

export function throwOtpClaim(result: OtpClaimResult): void {
  if (result === 'ok') return;
  if (result === 'locked') {
    throw tooManyRequests('Хэт олон удаа буруу оруулсан тул түр блоклолоо. Шинэ код авна уу.');
  }
  if (result === 'expired') throw badRequest('Кодны хугацаа дууссан байна.');
  if (result === 'wrong') throw unauthorized('Код буруу байна.');
  throw badRequest('Код олдсонгүй. Дахин илгээнэ үү.');
}

/** Prisma updateMany-тай ижил: нөхцөл биелэх үед л бичнэ. */
export function prismaOtpWhere(id: string, now: Date, code?: string) {
  return {
    id,
    usedAt: null,
    attempts: { lt: OTP_MAX_ATTEMPTS },
    expiresAt: { gt: now },
    ...(code != null ? { code } : {}),
  };
}
