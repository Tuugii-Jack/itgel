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
import { smsPhoneOf, smsTemplates } from './sms.js';
import { dispatchSms } from './smsDispatch.js';

export const PHONE_OTP_LOGIN = 'LOGIN';
export const PHONE_OTP_CHANGE = 'CHANGE_PHONE';
export const PHONE_OTP_ADMIN_PHONE = 'ADMIN_PHONE';

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_PHONE_HOUR_LIMIT = 5;
const OTP_IP_HOUR_LIMIT = 60;

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

type Db = Prisma.TransactionClient | typeof prisma;

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

async function lockOtpIssue(tx: Prisma.TransactionClient, phone: string, purpose: string, ip?: string | null) {
  if (ip) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`phone-otp-ip:${purpose}:${ip}`}))`;
  }
  await lockPhone(tx, phone, purpose);
}

async function persistPhoneOtp(
  tx: Prisma.TransactionClient,
  data: {
    phone: string;
    code: string;
    purpose: string;
    name?: string | null;
    customerId?: string | null;
    adminUserId?: string | null;
    previousPhone?: string | null;
    ip?: string | null;
    expiresAt: Date;
    usedAtStamp: Date;
  },
): Promise<PhoneOtp> {
  await tx.phoneOtp.updateMany({
    where: {
      usedAt: null,
      ...(data.purpose === PHONE_OTP_CHANGE && data.customerId
        ? { customerId: data.customerId, purpose: data.purpose }
        : data.purpose === PHONE_OTP_ADMIN_PHONE && data.adminUserId
          ? { adminUserId: data.adminUserId, purpose: data.purpose }
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
      adminUserId: data.adminUserId ?? null,
      previousPhone: data.previousPhone ?? null,
      ip: data.ip ?? null,
      expiresAt: data.expiresAt,
    },
  });
}

export async function issuePhoneOtp(input: {
  phone: string;
  name?: string;
  ip?: string;
  purpose?: string;
  customerId?: string;
  adminUserId?: string;
  previousPhone?: string | null;
}) {
  const phone = normalizeLoginPhone(input.phone);
  const purpose = input.purpose ?? PHONE_OTP_LOGIN;
  const now = new Date();
  const name = input.name?.trim() || undefined;
  const ip = input.ip?.trim() || null;

  const issued = await prisma.$transaction(async (tx) => {
    await lockOtpIssue(tx, phone, purpose, ip);

    const last = await tx.phoneOtp.findFirst({
      where: {
        phone,
        purpose,
        usedAt: null,
        expiresAt: { gt: now },
        ...(input.customerId ? { customerId: input.customerId } : {}),
        ...(input.adminUserId ? { adminUserId: input.adminUserId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    const remainingCooldown = last
      ? Math.ceil((RESEND_COOLDOWN_MS - (now.getTime() - last.createdAt.getTime())) / 1000)
      : 0;

    if (last && remainingCooldown > 0) {
      return { kind: 'reuse' as const, otp: last, resendAfterSec: remainingCooldown };
    }

    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const phoneHour = await tx.phoneOtp.count({
      where: { phone, purpose, createdAt: { gte: hourAgo } },
    });
    if (phoneHour >= OTP_PHONE_HOUR_LIMIT) {
      if (last) return { kind: 'reuse' as const, otp: last, resendAfterSec: RESEND_COOLDOWN_MS / 1000 };
      throw tooManyRequests('Хэт олон код хүслээ. 1 цагийн дараа оролдоно уу.', {
        retryAfterSec: 3600,
      });
    }

    if (ip) {
      const ipHour = await tx.phoneOtp.count({
        where: { ip, purpose, createdAt: { gte: hourAgo } },
      });
      if (ipHour >= OTP_IP_HOUR_LIMIT) {
        throw tooManyRequests('Хэт олон код хүслээ. Дараа дахин оролдоно уу.', {
          retryAfterSec: 3600,
        });
      }
    }

    const code = generateOtp();
    const otp = await persistPhoneOtp(tx, {
      phone,
      code,
      purpose,
      name: name ?? last?.name ?? null,
      customerId: input.customerId ?? null,
      adminUserId: input.adminUserId ?? null,
      previousPhone: input.previousPhone ?? null,
      ip,
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      usedAtStamp: now,
    });
    return { kind: 'created' as const, otp };
  });

  if (issued.kind === 'reuse') {
    return publicPhoneOtp(phone, issued.otp, issued.resendAfterSec);
  }

  const { send } = await dispatchSms({
    channel: 'shop',
    purpose: purpose === PHONE_OTP_CHANGE ? 'otp_change' : 'otp_login',
    phone,
    text: smsTemplates.otp(issued.otp.code),
    relatedType: 'phone_otp',
    relatedId: issued.otp.id,
  });

  if (send.status === 'failed' && !send.accepted) {
    throw badRequest(send.error ?? 'SMS илгээж чадсангүй.');
  }

  return {
    ...publicPhoneOtp(phone, issued.otp, RESEND_COOLDOWN_MS / 1000, send.status),
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
  return pending;
}

export { OTP_MAX_ATTEMPTS, RESEND_COOLDOWN_MS as PHONE_OTP_RESEND_COOLDOWN_MS };
