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

export const publicAuthRouter = Router();

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
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
  email: string;
  phone: string | null;
  name: string | null;
  emailVerifiedAt: Date | null;
  passwordHash: string | null;
}) {
  return {
    id: c.id,
    email: c.email,
    phone: c.phone,
    name: c.name,
    emailVerified: Boolean(c.emailVerifiedAt),
    hasPassword: Boolean(c.passwordHash),
  };
}

async function issueEmailOtp(email: string, purpose: 'VERIFY' | 'RESET') {
  const now = new Date();
  const last = await prisma.emailOtp.findFirst({
    where: { email, purpose },
    orderBy: { createdAt: 'desc' },
  });
  if (last && now.getTime() - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil(
      (RESEND_COOLDOWN_MS - (now.getTime() - last.createdAt.getTime())) / 1000,
    );
    throw tooManyRequests(`${wait} секундын дараа дахин илгээнэ үү.`, { retryAfterSec: wait });
  }

  const hourly = emailLimiter.hit(`${purpose}:${email}`, now.getTime());
  if (!hourly.allowed) {
    throw tooManyRequests('Хэт олон код хүслээ. 1 цагийн дараа оролдоно уу.', {
      retryAfterSec: hourly.retryAfterSec,
    });
  }

  const code = generateEmailCode();
  await prisma.emailOtp.create({
    data: { email, code, purpose, expiresAt: new Date(now.getTime() + OTP_TTL_MS) },
  });

  const template = purpose === 'VERIFY' ? mailTemplates.verify(code) : mailTemplates.reset(code);
  const sent = await sendMail({
    to: email,
    subject: template.subject,
    text: template.text,
    codeForDev: code,
  });
  if (!sent.ok) throw badRequest(sent.error ?? 'И-мэйл илгээж чадсангүй.');

  return {
    email,
    expiresInSec: OTP_TTL_MS / 1000,
    resendAfterSec: RESEND_COOLDOWN_MS / 1000,
    devCode: sent.devCode,
  };
}

async function consumeEmailOtp(email: string, purpose: 'VERIFY' | 'RESET', code: string) {
  const now = new Date();
  const otp = await prisma.emailOtp.findFirst({
    where: { email, purpose, usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp) throw badRequest('Код олдсонгүй. Дахин илгээнэ үү.');
  if (otp.attempts >= MAX_ATTEMPTS) {
    throw tooManyRequests('Хэт олон удаа буруу оруулсан тул түр блоклолоо. Шинэ код авна уу.');
  }
  if (otp.expiresAt <= now) throw badRequest('Кодны хугацаа дууссан байна.');
  if (otp.code !== code) {
    await prisma.emailOtp.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    throw unauthorized('Код буруу байна.');
  }
  await prisma.emailOtp.update({ where: { id: otp.id }, data: { usedAt: now } });
  emailLimiter.reset(`${purpose}:${email}`);
}

const phoneRequired = z
  .string()
  .trim()
  .transform(normalizePhone)
  .refine((v) => PHONE_RE.test(v), 'Утасны дугаар буруу байна (8 орон).');

/** POST /api/auth/register — шууд нэвтэрнэ. И-мэйл код илгээхгүй. */
publicAuthRouter.post(
  '/register',
  validate({
    body: z.object({
      email: emailSchema,
      password: passwordSchema,
      phone: phoneRequired,
      name: z.string().trim().min(1).max(80).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      email: string;
      password: string;
      name?: string;
      phone: string;
    };

    const existing = await prisma.customer.findUnique({ where: { email: body.email } });
    if (existing) throw conflict('Энэ и-мэйлээр бүртгэл байна.');

    const phoneTaken = await prisma.customer.findFirst({ where: { phone: body.phone } });
    if (phoneTaken) throw conflict('Энэ утасны дугаар өөр бүртгэлтэй холбогдсон.');

    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
    const customer = await prisma.customer.create({
      data: {
        email: body.email,
        passwordHash,
        name: body.name ?? null,
        phone: body.phone,
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
    await consumeEmailOtp(email, 'VERIFY', code);

    const customer = await prisma.customer.update({
      where: { email },
      data: { emailVerifiedAt: new Date() },
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

/** POST /api/auth/email/resend */
publicAuthRouter.post(
  '/email/resend',
  validate({ body: z.object({ email: emailSchema }) }),
  asyncHandler(async (req, res) => {
    const { email } = req.body as { email: string };
    const customer = await prisma.customer.findUnique({ where: { email } });
    if (!customer) throw badRequest('Бүртгэл олдсонгүй.');
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

// Хуучин утасны OTP — идэвхгүй.
publicAuthRouter.post('/otp', (_req, res) => {
  res.status(410).json({ error: { message: 'Утасны OTP нэвтрэлт хаагдсан. И-мэйлээр нэвтэрнэ үү.' } });
});
publicAuthRouter.post('/verify', (_req, res) => {
  res.status(410).json({ error: { message: 'Утасны OTP нэвтрэлт хаагдсан. И-мэйлээр нэвтэрнэ үү.' } });
});
