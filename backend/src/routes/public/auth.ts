import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { isProd } from '../../env.js';
import { generateOtp, normalizePhone, PHONE_RE } from '../../lib/code.js';
import { badRequest, tooManyRequests, unauthorized } from '../../lib/errors.js';
import { signCustomerToken } from '../../lib/jwt.js';
import { RateLimiter } from '../../lib/rateLimit.js';
import { asyncHandler, validate } from '../../middleware/validate.js';
import { sms, smsTemplates } from '../../services/sms.js';

export const publicAuthRouter = Router();

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

/** Дугаар тус бүрээр — цагт 5 удаа. Секундын түвшний хязгаар нь OtpCode-оор шалгагдана. */
const phoneHourlyLimiter = new RateLimiter(5, 60 * 60 * 1000);

const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .refine((v) => PHONE_RE.test(v), 'Утасны дугаар буруу байна (8 орон).');

/** POST /api/auth/otp — SMS код илгээнэ. */
publicAuthRouter.post(
  '/otp',
  validate({ body: z.object({ phone: phoneSchema }) }),
  asyncHandler(async (req, res) => {
    const { phone } = req.body as { phone: string };
    const now = new Date();

    const last = await prisma.otpCode.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });

    if (last && now.getTime() - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (now.getTime() - last.createdAt.getTime())) / 1000);
      throw tooManyRequests(`${wait} секундын дараа дахин илгээнэ үү.`, { retryAfterSec: wait });
    }

    const hourly = phoneHourlyLimiter.hit(phone, now.getTime());
    if (!hourly.allowed) {
      throw tooManyRequests('Хэт олон код хүслээ. 1 цагийн дараа оролдоно уу.', {
        retryAfterSec: hourly.retryAfterSec,
      });
    }

    const code = generateOtp();
    await prisma.otpCode.create({
      data: { phone, code, expiresAt: new Date(now.getTime() + OTP_TTL_MS) },
    });

    await sms.send({ phone, text: smsTemplates.otp(code) });

    res.json({
      data: {
        phone,
        expiresInSec: OTP_TTL_MS / 1000,
        resendAfterSec: RESEND_COOLDOWN_MS / 1000,
        // Dev дээр тестлэхэд хялбар байх үүднээс — production-д хэзээ ч буцаахгүй.
        devCode: isProd ? undefined : code,
      },
    });
  }),
);

/** POST /api/auth/verify — код шалгаж JWT олгоно. */
publicAuthRouter.post(
  '/verify',
  validate({
    body: z.object({
      phone: phoneSchema,
      code: z.string().regex(/^\d{4}$/, 'Код 4 оронтой байна.'),
      name: z.string().trim().min(1).max(80).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { phone, code, name } = req.body as { phone: string; code: string; name?: string };
    const now = new Date();

    const otp = await prisma.otpCode.findFirst({
      where: { phone, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) throw badRequest('Код олдсонгүй. Дахин илгээнэ үү.');
    if (otp.attempts >= MAX_ATTEMPTS) {
      throw tooManyRequests('Хэт олон удаа буруу оруулсан тул түр блоклолоо. Шинэ код авна уу.');
    }
    if (otp.expiresAt <= now) throw badRequest('Кодны хугацаа дууссан байна.');

    if (otp.code !== code) {
      await prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw unauthorized('Код буруу байна.');
    }

    const customer = await prisma.$transaction(async (tx) => {
      await tx.otpCode.update({ where: { id: otp.id }, data: { usedAt: now } });
      return tx.customer.upsert({
        where: { phone },
        create: { phone, name: name ?? null },
        update: name ? { name } : {},
      });
    });

    phoneHourlyLimiter.reset(phone);

    res.json({
      data: {
        token: signCustomerToken({ sub: customer.id, phone: customer.phone }),
        customer: { id: customer.id, phone: customer.phone, name: customer.name },
      },
    });
  }),
);
