import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { normalizePhone, PHONE_RE } from '../../lib/code.js';
import { badRequest, conflict, tooManyRequests, unauthorized } from '../../lib/errors.js';
import { signCustomerToken } from '../../lib/jwt.js';
import { ipLimiters, RateLimiter } from '../../lib/rateLimit.js';
import { asyncHandler, validate } from '../../middleware/validate.js';
import { mailTemplates, sendMail } from '../../services/mail.js';
import { findPendingEmailChange, resendEmailChange, verifyEmailChange } from '../../services/emailChange.js';
import { consumePhoneOtp, isPhoneLoginVerified, issuePhoneOtp } from '../../services/phoneOtp.js';
import {
  consumeOtpWithStore,
  prismaOtpWhere,
  throwOtpClaim,
  type OtpClaimStore,
} from '../../lib/otpClaim.js';

export const publicAuthRouter = Router();

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const BCRYPT_ROUNDS = 10;

const emailLimiter = new RateLimiter(8, 60 * 60 * 1000);
ipLimiters.push(emailLimiter);

const emailSchema = z
  .string()
  .trim()
  .email('И-мэйл буруу байна.')
  .max(120)
  .transform((v) => v.toLowerCase());

const passwordSchema = z
  .string()
  .min(6, 'Нууц үг дор хаяж 6 тэмдэгт.')
  .max(100);

function generateEmailCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

function publicCustomer(c: {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  emailVerifiedAt: Date | null;
  passwordHash: string | null;
}) {
  return {
    id: c.id,
    email: c.email,
    phone: c.phone,
    name: c.name?.trim() || null,
    emailVerified: Boolean(c.emailVerifiedAt),
    hasPassword: Boolean(c.passwordHash),
  };
}

async function issueEmailOtp(email: string, purpose: 'VERIFY' | 'RESET') {
  const now = new Date();
  const last = await prisma.emailOtp.findFirst({
    where: { email, purpose, usedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
  });

  const sendCode = async (code: string) => {
    const template = purpose === 'VERIFY' ? mailTemplates.verify(code) : mailTemplates.reset(code);
    const sent = await sendMail({
      to: email,
      subject: template.subject,
      text: template.text,
      html: template.html,
    });
    if (!sent.ok) throw badRequest(sent.error ?? 'И-мэйл илгээж чадсангүй.');
  };

  const remainingCooldown = last
    ? Math.ceil((RESEND_COOLDOWN_MS - (now.getTime() - last.createdAt.getTime())) / 1000)
    : 0;

  const publicOtp = (otp: { expiresAt: Date; createdAt: Date }, resendAfterSec: number) => ({
    email,
    expiresInSec: Math.max(1, Math.ceil((otp.expiresAt.getTime() - now.getTime()) / 1000)),
    resendAfterSec,
  });

  // Хэт ойрхон дахин дарахад алдаа өгөхгүй, шинэ и-мэйл илгээхгүй.
  if (last && remainingCooldown > 0) {
    return publicOtp(last, remainingCooldown);
  }

  const hourly = emailLimiter.hit(`${purpose}:${email}`, now.getTime());
  if (!hourly.allowed) {
    if (last) return publicOtp(last, RESEND_COOLDOWN_MS / 1000);
    throw tooManyRequests('Хэт олон код хүслээ. 1 цагийн дараа оролдоно уу.', {
      retryAfterSec: hourly.retryAfterSec,
    });
  }

  if (last) {
    await sendCode(last.code);
    return publicOtp(last, RESEND_COOLDOWN_MS / 1000);
  }

  const code = generateEmailCode();
  await sendCode(code);
  const created = await prisma.emailOtp.create({
    data: { email, code, purpose, expiresAt: new Date(now.getTime() + OTP_TTL_MS) },
  });

  return publicOtp(created, RESEND_COOLDOWN_MS / 1000);
}

async function consumeEmailOtp(email: string, purpose: 'VERIFY' | 'RESET', code: string) {
  const now = new Date();
  const store: OtpClaimStore = {
    findLatestUnused: () =>
      prisma.emailOtp.findFirst({
        where: { email, purpose, usedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
    tryMarkUsed: async (id, claimed, at) => {
      const result = await prisma.emailOtp.updateMany({
        where: prismaOtpWhere(id, at, claimed),
        data: { usedAt: at },
      });
      return result.count === 1;
    },
    tryCountFailure: async (id, at) => {
      const result = await prisma.emailOtp.updateMany({
        where: prismaOtpWhere(id, at),
        data: { attempts: { increment: 1 } },
      });
      if (result.count !== 1) return null;
      const row = await prisma.emailOtp.findUnique({ where: { id }, select: { attempts: true } });
      return row?.attempts ?? null;
    },
  };
  const result = await consumeOtpWithStore(store, email, code, now);
  throwOtpClaim(result);
  emailLimiter.reset(`${purpose}:${email}`);
}

const phoneRequired = z
  .string()
  .trim()
  .transform(normalizePhone)
  .refine((v) => PHONE_RE.test(v), 'Утасны дугаар буруу байна (8 орон).');

/** POST /api/auth/register — и-мэйл+нууц үг. Утас нэвтрэх эрх болохгүй (OTP-оор баталгаажуулна). */
publicAuthRouter.post(
  '/register',
  validate({
    body: z.object({
      email: emailSchema,
      password: passwordSchema,
      phone: phoneRequired.optional(),
      name: z.string().trim().min(1).max(80).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      email: string;
      password: string;
      name?: string;
    };

    const existing = await prisma.customer.findUnique({ where: { email: body.email } });
    if (existing) throw conflict('Энэ и-мэйлээр бүртгэл байна.');

    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
    const customer = await prisma.customer.create({
      data: {
        email: body.email,
        passwordHash,
        name: body.name ?? null,
        // Утас нэвтрэх эрх биш — OTP-оор баталгаажуулаагүй дугаарыг энд хадгалахгүй.
        phone: null,
        phoneVerifiedAt: null,
        emailVerifiedAt: new Date(),
      },
    });

    res.status(201).json({
      data: {
        token: signCustomerToken({
          sub: customer.id,
          email: customer.email,
          phone: customer.phone,
        }),
        customer: publicCustomer(customer),
      },
    });
  }),
);

/** POST /api/auth/email/verify */
publicAuthRouter.post(
  '/email/verify',
  validate({
    body: z.object({
      email: emailSchema,
      code: z.string().regex(/^\d{6}$/, 'Код 6 оронтой байна.'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { email, code } = req.body as { email: string; code: string };
    // An abandoned change request must not shadow a later registration at this address.
    const existingCustomer = await prisma.customer.findUnique({ where: { email } });
    const pendingChange = existingCustomer ? null : await findPendingEmailChange(email);
    const customer = pendingChange
      ? await verifyEmailChange(pendingChange, code)
      : await (async () => {
          await consumeEmailOtp(email, 'VERIFY', code);
          return prisma.customer.update({
            where: { email },
            data: { emailVerifiedAt: new Date() },
          });
        })();

    res.json({
      data: {
        token: signCustomerToken({
          sub: customer.id,
          email: customer.email,
          phone: customer.phone,
        }),
        customer: publicCustomer(customer),
      },
    });
  }),
);

/** POST /api/auth/email/resend */
publicAuthRouter.post(
  '/email/resend',
  validate({ body: z.object({ email: emailSchema }) }),
  asyncHandler(async (req, res) => {
    const { email } = req.body as { email: string };
    const customer = await prisma.customer.findUnique({ where: { email } });
    if (!customer) {
      const pendingChange = await findPendingEmailChange(email);
      if (!pendingChange) throw badRequest('Бүртгэл олдсонгүй.');
      res.json({ data: await resendEmailChange(pendingChange) });
      return;
    }
    if (customer.emailVerifiedAt) throw badRequest('И-мэйл аль хэдийн баталгаажсан.');

    const otp = await issueEmailOtp(email, 'VERIFY');
    res.json({ data: otp });
  }),
);

/** POST /api/auth/login — и-мэйл эсвэл утас + нууц үг. */
publicAuthRouter.post(
  '/login',
  validate({
    body: z
      .object({
        password: z.string().min(1).max(100),
        /** И-мэйл (уламжлалт). */
        email: emailSchema.optional(),
        /** Утас (8 орон). */
        phone: z
          .string()
          .trim()
          .optional()
          .transform((v) => (v ? normalizePhone(v) : undefined))
          .refine((v) => v === undefined || PHONE_RE.test(v), 'Утасны дугаар буруу.'),
        /**
         * Нэг талбар — и-мэйл эсвэл утас.
         * `email`/`phone`-той зэрэг өгвөл `login` давамгайлна.
         */
        login: z.string().trim().min(1).max(120).optional(),
      })
      .superRefine((body, ctx) => {
        if (!body.login && !body.email && !body.phone) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'И-мэйл эсвэл утас оруулна уу.',
            path: ['login'],
          });
        }
      }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      password: string;
      email?: string;
      phone?: string;
      login?: string;
    };

    let customer = null as Awaited<ReturnType<typeof prisma.customer.findUnique>> | null;

    const raw = body.login?.trim();
    if (raw) {
      const asPhone = normalizePhone(raw);
      if (PHONE_RE.test(asPhone) && !raw.includes('@')) {
        customer = await prisma.customer.findUnique({ where: { phone: asPhone } });
      } else {
        customer = await prisma.customer.findUnique({
          where: { email: raw.toLowerCase() },
        });
      }
    } else if (body.phone) {
      customer = await prisma.customer.findUnique({ where: { phone: body.phone } });
    } else if (body.email) {
      customer = await prisma.customer.findUnique({ where: { email: body.email } });
    }

    if (!customer?.passwordHash) throw unauthorized('Нэвтрэх мэдээлэл эсвэл нууц үг буруу.');

    const loggedInByPhone = Boolean(
      (raw && PHONE_RE.test(normalizePhone(raw)) && !raw.includes('@')) || body.phone,
    );
    if (loggedInByPhone && !isPhoneLoginVerified(customer)) {
      throw unauthorized('Нэвтрэх мэдээлэл эсвэл нууц үг буруу.');
    }

    const ok = await bcrypt.compare(body.password, customer.passwordHash);
    if (!ok) throw unauthorized('Нэвтрэх мэдээлэл эсвэл нууц үг буруу.');

    res.json({
      data: {
        token: signCustomerToken({
          sub: customer.id,
          email: customer.email,
          phone: customer.phone,
        }),
        customer: publicCustomer(customer),
      },
    });
  }),
);

/** POST /api/auth/password/forgot */
publicAuthRouter.post(
  '/password/forgot',
  validate({ body: z.object({ email: emailSchema }) }),
  asyncHandler(async (req, res) => {
    const { email } = req.body as { email: string };
    const customer = await prisma.customer.findUnique({ where: { email } });
    // Бүртгэл байхгүйг нууна — enumeration-аас сэргийлнэ.
    if (customer) {
      const otp = await issueEmailOtp(email, 'RESET');
      res.json({ data: { ...otp, message: 'Сэргээх код илгээлээ.' } });
      return;
    }
    res.json({
      data: {
        email,
        expiresInSec: OTP_TTL_MS / 1000,
        resendAfterSec: RESEND_COOLDOWN_MS / 1000,
        message: 'Сэргээх код илгээлээ.',
      },
    });
  }),
);

/** POST /api/auth/password/reset */
publicAuthRouter.post(
  '/password/reset',
  validate({
    body: z.object({
      email: emailSchema,
      code: z.string().regex(/^\d{6}$/, 'Код 6 оронтой байна.'),
      password: passwordSchema,
    }),
  }),
  asyncHandler(async (req, res) => {
    const { email, code, password } = req.body as {
      email: string;
      code: string;
      password: string;
    };
    await consumeEmailOtp(email, 'RESET', code);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const customer = await prisma.customer.update({
      where: { email },
      data: {
        passwordHash,
        // Reset амжилттай бол и-мэйлийг баталгаажсан гэж үзнэ.
        emailVerifiedAt: new Date(),
      },
    });

    res.json({
      data: {
        token: signCustomerToken({
          sub: customer.id,
          email: customer.email,
          phone: customer.phone,
        }),
        customer: publicCustomer(customer),
      },
    });
  }),
);

/** POST /api/auth/otp — утас руу 6 оронтой код. Хэрэглэгч кодыг баталгаажуулсны дараа үүснэ. */
publicAuthRouter.post(
  '/otp',
  validate({
    body: z.object({
      phone: phoneRequired,
      name: z.string().trim().min(1).max(80).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { phone: string; name?: string };
    const otp = await issuePhoneOtp({
      phone: body.phone,
      name: body.name,
      ip: req.ip,
    });
    res.json({ data: otp });
  }),
);

/** POST /api/auth/verify — код шалгаад нэвтрүүлнэ / бүртгэнэ. */
publicAuthRouter.post(
  '/verify',
  validate({
    body: z.object({
      phone: phoneRequired,
      code: z.string().regex(/^\d{6}$/, 'Код 6 оронтой байна.'),
      name: z.string().trim().min(1).max(80).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { phone: string; code: string; name?: string };
    const customer = await consumePhoneOtp(body.phone, body.code, body.name);
    res.json({
      data: {
        token: signCustomerToken({
          sub: customer.id,
          email: customer.email,
          phone: customer.phone,
        }),
        customer: publicCustomer(customer),
      },
    });
  }),
);
