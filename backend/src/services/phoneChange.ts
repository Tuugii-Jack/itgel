import type { Customer } from '@prisma/client';
import { prisma } from '../prisma.js';
import { badRequest, conflict, tooManyRequests } from '../lib/errors.js';
import { ipLimiters, RateLimiter } from '../lib/rateLimit.js';
import {
  PHONE_OTP_CHANGE,
  PHONE_OTP_RESEND_COOLDOWN_MS,
  consumePhoneChangeOtp,
  isPhoneLoginVerified,
  issuePhoneOtp,
  normalizeLoginPhone,
} from './phoneOtp.js';

const changeLimiter = new RateLimiter(5, 60 * 60 * 1000);
ipLimiters.push(changeLimiter);

function publicChange(phone: string, otp: { expiresInSec: number; resendAfterSec: number; smsStatus?: string }) {
  return {
    phone,
    expiresInSec: otp.expiresInSec,
    resendAfterSec: otp.resendAfterSec,
    smsStatus: otp.smsStatus,
  };
}

export async function issuePhoneChange(customer: Customer, phoneRaw: string, ip?: string) {
  const phone = normalizeLoginPhone(phoneRaw);
  if (phone === customer.phone) throw badRequest('Шинэ дугаар одоогийнтой адил.');

  const holder = await prisma.customer.findUnique({ where: { phone } });
  if (holder && holder.id !== customer.id && isPhoneLoginVerified(holder)) {
    throw conflict('Энэ утасны дугаар өөр бүртгэлтэй холбогдсон.');
  }

  const hourly = changeLimiter.hit(customer.id, Date.now());
  if (!hourly.allowed) {
    throw tooManyRequests('Хэт олон код хүслээ. 1 цагийн дараа оролдоно уу.', {
      retryAfterSec: hourly.retryAfterSec,
    });
  }

  const otp = await issuePhoneOtp({
    phone,
    purpose: PHONE_OTP_CHANGE,
    customerId: customer.id,
    previousPhone: customer.phone,
    ip,
  });
  return publicChange(phone, otp);
}

export async function resendPhoneChange(customer: Customer, phoneRaw: string, ip?: string) {
  const phone = normalizeLoginPhone(phoneRaw);
  const last = await prisma.phoneOtp.findFirst({
    where: {
      phone,
      purpose: PHONE_OTP_CHANGE,
      customerId: customer.id,
      usedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!last) throw badRequest('Код олдсонгүй. Дахин илгээнэ үү.');
  if (last.previousPhone !== customer.phone) {
    throw conflict('Утас өөрчлөгдсөн байна. Дахин оролдоно уу.');
  }
  const remaining = Math.ceil(
    (PHONE_OTP_RESEND_COOLDOWN_MS - (Date.now() - last.createdAt.getTime())) / 1000,
  );
  if (last.expiresAt.getTime() > Date.now() && remaining > 0) {
    return publicChange(phone, {
      expiresInSec: Math.max(1, Math.ceil((last.expiresAt.getTime() - Date.now()) / 1000)),
      resendAfterSec: remaining,
    });
  }
  return issuePhoneChange(customer, phone, ip);
}

export async function verifyPhoneChange(customer: Customer, phoneRaw: string, code: string) {
  const phone = normalizeLoginPhone(phoneRaw);
  await consumePhoneChangeOtp(phone, code, customer.id);

  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`phone-change:${customer.id}`}))`;
      const live = await tx.customer.findUnique({ where: { id: customer.id } });
      if (!live) throw badRequest('Хэрэглэгч олдсонгүй.');

      const holder = await tx.customer.findUnique({ where: { phone } });
      if (holder && holder.id !== live.id) {
        if (isPhoneLoginVerified(holder)) throw conflict('Энэ утасны дугаар өөр бүртгэлтэй холбогдсон.');
        await tx.customer.update({
          where: { id: holder.id },
          data: { phone: null },
        });
      }

      const updated = await tx.customer.update({
        where: { id: live.id },
        data: { phone, phoneVerifiedAt: now },
      });

      await tx.phoneOtp.updateMany({
        where: { customerId: live.id, purpose: PHONE_OTP_CHANGE, usedAt: null },
        data: { usedAt: now },
      });
      changeLimiter.reset(live.id);
      return updated;
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      throw conflict('Энэ утасны дугаар өөр бүртгэлтэй холбогдсон.');
    }
    throw error;
  }
}
