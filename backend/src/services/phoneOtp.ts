import type { PhoneOtp, Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { generateOtp, normalizePhone, PHONE_RE } from '../lib/code.js';
import { badRequest, tooManyRequests } from '../lib/errors.js';
import {
  OTP_MAX_ATTEMPTS,
  consumeOtpWithStore,
  prismaOtpWhere,
  throwOtpClaim,
  type OtpClaimStore,
} from '../lib/otpClaim.js';
import { ipLimiters, RateLimiter } from '../lib/rateLimit.js';
import { smsPhoneOf, smsTemplates } from './sms.js';
import { dispatchSms } from './smsDispatch.js';

export const PHONE_OTP_LOGIN = 'LOGIN';
export const PHONE_OTP_CHANGE = 'CHANGE_PHONE';

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

const phoneLimiter = new RateLimiter(5, 60 * 60 * 1000);
/** Дугаар бүрийн 5/цаг дээр нэмж, нэг IP-ээс олон хүн зэрэг нэвтрэхийг зөвшөөрнө. */
const ipLimiter = new RateLimiter(60, 60 * 60 * 1000);
ipLimiters.push(phoneLimiter, ipLimiter);

type Db = Prisma.TransactionClient | typeof prisma;

export function publicPhoneOtp(
  phone: string,
  otp: { expiresAt: Date; createdAt: Date },
  resendAfterSec: number,
  smsStatus?: string,
) {
  const now = Date.now();
  return {
    phone,
    expiresInSec: Math.max(1, Math.ceil((otp.expiresAt.getTime() - now) / 1000)),
    resendAfterSec,
    ...(smsStatus ? { smsStatus } : {}),
  };
}

export function normalizeLoginPhone(input: string): string {
  const phone = smsPhoneOf(input) ?? normalizePhone(input);
  if (!PHONE_RE.test(phone)) throw badRequest('Утасны дугаар буруу байна (8 орон).');
  return phone;
}

export function isPhoneLoginVerified(
  customer: { phone: string | null; phoneVerifiedAt: Date | null } | null | undefined,
): boolean {
  return Boolean(customer?.phone && customer.phoneVerifiedAt);
}

/** Админ/лизинг утас бичихэд нэвтрэх эрхийг хамт тэмдэглэнэ. */
export function staffPhoneFields(phone: string | null | undefined): {
  phone?: string | null;
  phoneVerifiedAt?: Date | null;
} {
  if (phone === undefined) return {};
  if (phone === null) return { phone: null, phoneVerifiedAt: null };
  return { phone, phoneVerifiedAt: new Date() };
}

function phoneOtpStore(
  db: Db,
  phone: string,
  purpose: string,
  customerId?: string,
): OtpClaimStore {
  const owner = customerId ? { customerId } : {};
  return {
    findLatestUnused: () =>
      db.phoneOtp.findFirst({
        where: { phone, purpose, usedAt: null, ...owner },
        orderBy: { createdAt: 'desc' },
      }),
    tryMarkUsed: async (id, code, now) => {
      const result = await db.phoneOtp.updateMany({
        where: { ...prismaOtpWhere(id, now, code), ...owner },
        data: { usedAt: now },
      });
      return result.count === 1;
    },
    tryCountFailure: async (id, now) => {
      const result = await db.phoneOtp.updateMany({
        where: { ...prismaOtpWhere(id, now), ...owner },
        data: { attempts: { increment: 1 } },
      });
      if (result.count !== 1) return null;
      const row = await db.phoneOtp.findUnique({ where: { id }, select: { attempts: true } });
      return row?.attempts ?? null;
    },
  };
}

async function lockPhone(tx: Prisma.TransactionClient, phone: string, purpose: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`phone-otp:${purpose}:${phone}`}))`;
}

async function persistPhoneOtp(
  db: Db,
  data: {
    phone: string;
    code: string;
    purpose: string;
    name?: string | null;
    customerId?: string | null;
    previousPhone?: string | null;
    expiresAt: Date;
    usedAtStamp: Date;
  },
): Promise<PhoneOtp> {
  const write = async (tx: Prisma.TransactionClient) => {
    await lockPhone(tx, data.phone, data.purpose);
    await tx.phoneOtp.updateMany({
      where: {
        usedAt: null,
        ...(data.purpose === PHONE_OTP_CHANGE && data.customerId
          ? { customerId: data.customerId, purpose: data.purpose }
          : { phone: data.phone, purpose: data.purpose }),
      },
      data: { usedAt: data.usedAtStamp },
    });
    return tx.phoneOtp.create({
      data: {
        phone: data.phone,
        code: data.code,
        purpose: data.purpose,
        name: data.name ?? null,
        customerId: data.customerId ?? null,
        previousPhone: data.previousPhone ?? null,
        expiresAt: data.expiresAt,
      },
    });
  };

  if ('$transaction' in db && typeof db.$transaction === 'function') {
    return db.$transaction((tx) => write(tx));
  }
  return write(db as Prisma.TransactionClient);
}

export async function issuePhoneOtp(input: {
  phone: string;
  name?: string;
  ip?: string;
  purpose?: string;
  customerId?: string;
  previousPhone?: string | null;
}) {
  const phone = normalizeLoginPhone(input.phone);
  const purpose = input.purpose ?? PHONE_OTP_LOGIN;
  const now = new Date();
  const name = input.name?.trim() || undefined;

  const last = await prisma.phoneOtp.findFirst({
    where: {
      phone,
      purpose,
      usedAt: null,
      expiresAt: { gt: now },
      ...(input.customerId ? { customerId: input.customerId } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });

  const remainingCooldown = last
    ? Math.ceil((RESEND_COOLDOWN_MS - (now.getTime() - last.createdAt.getTime())) / 1000)
    : 0;

  if (last && remainingCooldown > 0) {
    return publicPhoneOtp(phone, last, remainingCooldown);
  }

  const hourly = phoneLimiter.hit(`${purpose}:${phone}`, now.getTime());
  if (!hourly.allowed) {
    if (last) return publicPhoneOtp(phone, last, RESEND_COOLDOWN_MS / 1000);
    throw tooManyRequests('Хэт олон код хүслээ. 1 цагийн дараа оролдоно уу.', {
      retryAfterSec: hourly.retryAfterSec,
    });
  }

  const ipKey = input.ip?.trim();
  if (ipKey) {
    const ipHit = ipLimiter.hit(ipKey, now.getTime());
    if (!ipHit.allowed) {
      throw tooManyRequests('Хэт олон код хүслээ. Дараа дахин оролдоно уу.', {
        retryAfterSec: ipHit.retryAfterSec,
      });
    }
  }

  const code = generateOtp();
  const otp = await persistPhoneOtp(prisma, {
    phone,
    code,
    purpose,
    name: name ?? last?.name ?? null,
    customerId: input.customerId ?? null,
    previousPhone: input.previousPhone ?? null,
    expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    usedAtStamp: now,
  });

  const { send } = await dispatchSms({
    channel: 'shop',
    purpose: purpose === PHONE_OTP_CHANGE ? 'otp_change' : 'otp_login',
    phone,
    text: smsTemplates.otp(code),
    relatedType: 'phone_otp',
    relatedId: otp.id,
  });

  if (send.status === 'failed' && !send.accepted) {
    throw badRequest(send.error ?? 'SMS илгээж чадсангүй.');
  }

  return {
    ...publicPhoneOtp(phone, otp, RESEND_COOLDOWN_MS / 1000, send.status),
  };
}

async function attachVerifiedPhone(
  tx: Prisma.TransactionClient,
  phone: string,
  displayName: string | null,
  now: Date,
) {
  const existing = await tx.customer.findUnique({ where: { phone } });
  if (existing && isPhoneLoginVerified(existing)) {
    if (!existing.name && displayName) {
      return tx.customer.update({
        where: { id: existing.id },
        data: { name: displayName },
      });
    }
    return existing;
  }

  if (existing) {
    await tx.customer.update({
      where: { id: existing.id },
      data: { phone: null },
    });
  }

  try {
    return await tx.customer.create({
      data: {
        email: null,
        phone,
        phoneVerifiedAt: now,
        name: displayName,
      },
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      const raced = await tx.customer.findUnique({ where: { phone } });
      if (raced && isPhoneLoginVerified(raced)) return raced;
    }
    throw error;
  }
}

export async function consumePhoneOtp(phoneRaw: string, code: string, name?: string) {
  const phone = normalizeLoginPhone(phoneRaw);
  if (!/^\d{6}$/.test(code)) throw badRequest('Код 6 оронтой байна.');

  const now = new Date();
  const store = phoneOtpStore(prisma, phone, PHONE_OTP_LOGIN);
  const pending = await prisma.phoneOtp.findFirst({
    where: { phone, purpose: PHONE_OTP_LOGIN, usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  const result = await consumeOtpWithStore(store, phone, code, now);
  throwOtpClaim(result);
  phoneLimiter.reset(`${PHONE_OTP_LOGIN}:${phone}`);

  const displayName = name?.trim() || pending?.name || null;

  return prisma.$transaction(async (tx) => {
    await lockPhone(tx, phone, PHONE_OTP_LOGIN);
    return attachVerifiedPhone(tx, phone, displayName, now);
  });
}

export async function consumePhoneChangeOtp(phoneRaw: string, code: string, customerId: string) {
  const phone = normalizeLoginPhone(phoneRaw);
  if (!/^\d{6}$/.test(code)) throw badRequest('Код 6 оронтой байна.');
  const now = new Date();
  const store = phoneOtpStore(prisma, phone, PHONE_OTP_CHANGE, customerId);
  const pending = await store.findLatestUnused(phone);
  if (!pending) throw badRequest('Код олдсонгүй. Дахин илгээнэ үү.');
  const result = await consumeOtpWithStore(store, phone, code, now);
  throwOtpClaim(result);
  phoneLimiter.reset(`${PHONE_OTP_CHANGE}:${phone}`);
  return pending;
}

export { OTP_MAX_ATTEMPTS, RESEND_COOLDOWN_MS as PHONE_OTP_RESEND_COOLDOWN_MS };
