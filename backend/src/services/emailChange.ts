import { randomInt } from 'node:crypto';
import type { EmailOtp } from '@prisma/client';
import { prisma } from '../prisma.js';
import { badRequest, conflict, tooManyRequests, unauthorized } from '../lib/errors.js';
import { ipLimiters, RateLimiter } from '../lib/rateLimit.js';
import { mailTemplates, sendMail } from './mail.js';

const PURPOSE = 'CHANGE_EMAIL';
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const resendLimiter = new RateLimiter(8, 60 * 60 * 1000);
ipLimiters.push(resendLimiter);

function publicOtp(otp: { email: string; expiresAt: Date }, resendAfterSec = 60) {
  return {
    email: otp.email,
    expiresInSec: Math.max(1, Math.ceil((otp.expiresAt.getTime() - Date.now()) / 1000)),
    resendAfterSec,
  };
}

async function sendCode(email: string, code: string) {
  const template = mailTemplates.verify(code);
  const sent = await sendMail({ to: email, ...template });
  if (!sent.ok) throw badRequest(sent.error ?? 'И-мэйл илгээж чадсангүй.');
}

export function findPendingEmailChange(email: string) {
  return prisma.emailOtp.findFirst({
    where: { email, purpose: PURPOSE, usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

/** Keep the login/recovery address until ownership of the new address is proven. */
export async function issueEmailChange(customer: { id: string; email: string }, email: string) {
  const code = String(randomInt(100_000, 1_000_000));
  await sendCode(email, code);
  const now = new Date();
  const otp = await prisma.$transaction(async (tx) => {
    // Serialize replacement codes and verification for this account.
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Customer" WHERE "id" = ${customer.id} AND "email" = ${customer.email} FOR UPDATE
    `;
    if (!rows.length) throw conflict('И-мэйл өөрчлөгдсөн байна. Дахин оролдоно уу.');
    await tx.emailOtp.updateMany({
      where: { customerId: customer.id, purpose: PURPOSE, usedAt: null },
      data: { usedAt: now },
    });
    return tx.emailOtp.create({
      data: {
        email,
        code,
        purpose: PURPOSE,
        customerId: customer.id,
        previousEmail: customer.email,
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      },
    });
  });
  return publicOtp(otp);
}

export async function resendEmailChange(otp: EmailOtp) {
  if (!otp.customerId || !otp.previousEmail) throw badRequest('Код олдсонгүй. Дахин илгээнэ үү.');
  const customer = await prisma.customer.findUnique({ where: { id: otp.customerId } });
  if (!customer || customer.email !== otp.previousEmail) {
    throw conflict('И-мэйл өөрчлөгдсөн байна. Дахин оролдоно уу.');
  }
  const taken = await prisma.customer.findUnique({ where: { email: otp.email } });
  if (taken) throw conflict('Энэ и-мэйлээр бүртгэл байна.');

  const now = Date.now();
  const remainingCooldown = Math.ceil((RESEND_COOLDOWN_MS - (now - otp.createdAt.getTime())) / 1000);
  if (otp.expiresAt.getTime() > now && otp.attempts < MAX_ATTEMPTS && remainingCooldown > 0) {
    return publicOtp(otp, remainingCooldown);
  }
  const hourly = resendLimiter.hit(otp.customerId, now);
  if (!hourly.allowed) {
    throw tooManyRequests('Хэт олон код хүслээ. 1 цагийн дараа оролдоно уу.', {
      retryAfterSec: hourly.retryAfterSec,
    });
  }
  if (otp.expiresAt.getTime() <= now || otp.attempts >= MAX_ATTEMPTS) {
    return issueEmailChange(customer, otp.email);
  }
  await sendCode(otp.email, otp.code);
  return publicOtp(otp);
}

export async function verifyEmailChange(pending: EmailOtp, code: string) {
  const now = new Date();
  if (!pending.customerId || !pending.previousEmail) throw badRequest('Код олдсонгүй. Дахин илгээнэ үү.');
  if (pending.attempts >= MAX_ATTEMPTS) {
    throw tooManyRequests('Хэт олон удаа буруу оруулсан тул түр блоклолоо. Шинэ код авна уу.');
  }
  if (pending.expiresAt <= now) throw badRequest('Кодны хугацаа дууссан байна.');
  if (pending.code !== code) {
    await prisma.emailOtp.updateMany({
      where: { id: pending.id, usedAt: null, attempts: { lt: MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    throw unauthorized('Код буруу байна.');
  }

  try {
    const customer = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "Customer" WHERE "id" = ${pending.customerId} FOR UPDATE
      `;
      const claimed = await tx.emailOtp.updateMany({
        where: {
          id: pending.id,
          usedAt: null,
          expiresAt: { gt: now },
          attempts: { lt: MAX_ATTEMPTS },
        },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw badRequest('Код хүчингүй болсон. Дахин илгээнэ үү.');

      const taken = await tx.customer.findUnique({ where: { email: pending.email } });
      if (taken) throw conflict('Энэ и-мэйлээр бүртгэл байна.');
      const updated = await tx.customer.updateMany({
        where: { id: pending.customerId!, email: pending.previousEmail! },
        data: { email: pending.email, emailVerifiedAt: now },
      });
      if (updated.count !== 1) throw conflict('И-мэйл өөрчлөгдсөн байна. Дахин оролдоно уу.');

      await tx.emailOtp.updateMany({
        where: { customerId: pending.customerId, purpose: PURPOSE, usedAt: null },
        data: { usedAt: now },
      });
      return tx.customer.findUniqueOrThrow({ where: { id: pending.customerId! } });
    });
    resendLimiter.reset(pending.customerId);
    return customer;
  } catch (error) {
    // A concurrent registration can take the address after the availability check.
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      throw conflict('Энэ и-мэйлээр бүртгэл байна.');
    }
    throw error;
  }
}
