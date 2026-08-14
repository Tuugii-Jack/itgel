import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { normalizePhone, PHONE_RE } from '../../lib/code.js';
import { badRequest, conflict, notFound, unauthorized } from '../../lib/errors.js';
import { toIso } from '../../lib/date.js';
import { requireCustomer } from '../../middleware/auth.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import { computeTotals, paymentState } from '../../services/money.js';
import { buildTimeline } from '../../services/orders.js';
import { orderStatusLabel, publicDelivery, publicOrderItem } from '../../services/serialize.js';
import { mailTemplates, sendMail } from '../../services/mail.js';
import { ipLimiters, RateLimiter } from '../../lib/rateLimit.js';
import { randomInt } from 'node:crypto';

export const publicMeRouter = Router();

publicMeRouter.use(requireCustomer);

const BCRYPT_ROUNDS = 10;
const OTP_TTL_MS = 10 * 60 * 1000;
const emailChangeLimiter = new RateLimiter(5, 60 * 60 * 1000);
ipLimiters.push(emailChangeLimiter);

function serializeCustomer(c: {
  id: string;
  email: string;
  phone: string | null;
  name: string | null;
  emailVerifiedAt: Date | null;
  passwordHash: string | null;
  district: string | null;
  khoroo: string | null;
  addressText: string | null;
  notifyPayment: boolean;
  notifyArrival: boolean;
  notifyPromo: boolean;
  createdAt: Date;
}) {
  return {
    id: c.id,
    email: c.email,
    phone: c.phone,
    name: c.name,
    emailVerified: Boolean(c.emailVerifiedAt),
    hasPassword: Boolean(c.passwordHash),
    address: { district: c.district, khoroo: c.khoroo, addressText: c.addressText },
    notifications: {
      payment: c.notifyPayment,
      arrival: c.notifyArrival,
      promo: c.notifyPromo,
    },
    createdAt: c.createdAt.toISOString(),
  };
}

const phoneOptional = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v) => {
    if (v == null || v === '') return null;
    return normalizePhone(v);
  })
  .refine((v) => v === null || v === undefined || PHONE_RE.test(v), 'Утасны дугаар буруу байна (8 орон).');

/** GET /api/me */
publicMeRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({ where: { id: req.auth!.sub } });
    if (!customer) throw notFound('Хэрэглэгч олдсонгүй.');
    res.json({ data: serializeCustomer(customer) });
  }),
);

const patchBody = z.object({
  name: z.string().trim().min(1).max(80).nullable().optional(),
  phone: phoneOptional,
  district: z.string().trim().max(60).nullable().optional(),
  khoroo: z.string().trim().max(30).nullable().optional(),
  addressText: z.string().trim().max(300).nullable().optional(),
  notifyPayment: z.boolean().optional(),
  notifyArrival: z.boolean().optional(),
  notifyPromo: z.boolean().optional(),
});

/** PATCH /api/me — нэр, утас, хаяг, мэдэгдэл (OTPгүй). */
publicMeRouter.patch(
  '/',
  validate({ body: patchBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof patchBody>;
    if (body.phone) {
      const taken = await prisma.customer.findFirst({
        where: { phone: body.phone, NOT: { id: req.auth!.sub } },
      });
      if (taken) throw conflict('Энэ утасны дугаар өөр бүртгэлтэй холбогдсон.');
    }
    const customer = await prisma.customer.update({
      where: { id: req.auth!.sub },
      data: body,
    });
    res.json({ data: serializeCustomer(customer) });
  }),
);

/** POST /api/me/password */
publicMeRouter.post(
  '/password',
  validate({
    body: z.object({
      currentPassword: z.string().min(1).max(100),
      newPassword: z.string().min(6).max(100),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string;
      newPassword: string;
    };
    const customer = await prisma.customer.findUnique({ where: { id: req.auth!.sub } });
    if (!customer) throw notFound('Хэрэглэгч олдсонгүй.');
    if (!customer.passwordHash) throw badRequest('Нууц үг тохируулаагүй байна.');

    const ok = await bcrypt.compare(currentPassword, customer.passwordHash);
    if (!ok) throw unauthorized('Одоогийн нууц үг буруу.');

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const updated = await prisma.customer.update({
      where: { id: customer.id },
      data: { passwordHash },
    });
    res.json({ data: serializeCustomer(updated) });
  }),
);

/** POST /api/me/email/change — шинэ и-мэйл + код илгээнэ; баталгаажуулалт /auth/email/verify. */
publicMeRouter.post(
  '/email/change',
  validate({
    body: z.object({
      email: z.string().trim().email().max(120).transform((v) => v.toLowerCase()),
      password: z.string().min(1).max(100),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const customer = await prisma.customer.findUnique({ where: { id: req.auth!.sub } });
    if (!customer) throw notFound('Хэрэглэгч олдсонгүй.');
    if (!customer.passwordHash) throw badRequest('Нууц үг тохируулаагүй байна.');

    const ok = await bcrypt.compare(password, customer.passwordHash);
    if (!ok) throw unauthorized('Нууц үг буруу.');

    if (email === customer.email) throw badRequest('Шинэ и-мэйл одоогийнтой адил.');
    const taken = await prisma.customer.findUnique({ where: { email } });
    if (taken) throw conflict('Энэ и-мэйлээр бүртгэл байна.');

    const hourly = emailChangeLimiter.hit(customer.id, Date.now());
    if (!hourly.allowed) {
      throw badRequest('Хэт олон удаа оролдлоо. Дараа дахин оролдоно уу.');
    }

    await prisma.customer.update({
      where: { id: customer.id },
      data: { email, emailVerifiedAt: null },
    });

    const code = String(randomInt(100_000, 1_000_000));
    await prisma.emailOtp.create({
      data: {
        email,
        code,
        purpose: 'VERIFY',
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
    const template = mailTemplates.verify(code);
    const sent = await sendMail({
      to: email,
      subject: template.subject,
      text: template.text,
      codeForDev: code,
    });
    if (!sent.ok) throw badRequest(sent.error ?? 'И-мэйл илгээж чадсангүй.');

    res.json({
      data: {
        email,
        expiresInSec: OTP_TTL_MS / 1000,
        resendAfterSec: 60,
        devCode: sent.devCode,
        message: 'Шинэ и-мэйл рүү баталгаажуулах код илгээлээ.',
      },
    });
  }),
);

const ordersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

/** GET /api/me/orders */
publicMeRouter.get(
  '/orders',
  validate({ query: ordersQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof ordersQuery>>(req);
    const where = { customerId: req.auth!.sub, deletedAt: null };

    const [total, spent, activeCount, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.aggregate({
        where: { ...where, status: { not: 'CANCELLED' } },
        _sum: { paidAmount: true, refundedAmount: true },
      }),
      prisma.order.count({
        where: { ...where, status: { notIn: ['HANDED_OVER', 'CANCELLED'] } },
      }),
      prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          items: { include: { product: true } },
          batch: true,
          delivery: true,
        },
      }),
    ]);

    res.json({
      data: orders.map((order) => ({
        code: order.code,
        status: order.status,
        statusLabel: orderStatusLabel(order.status),
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        storageFee: order.storageFee,
        cargoFee: order.cargoFee,
        cargoPayMethod: order.cargoPayMethod === 'CASH' || order.cargoPayMethod === 'QPAY'
          ? order.cargoPayMethod
          : null,
        paidAmount: order.paidAmount,
        refundedAmount: order.refundedAmount,
        dueAmount: order.dueAmount,
        paymentState: paymentState(computeTotals(order)),
        fulfilment: order.fulfilment,
        canChooseFulfilment: order.status === 'ARRIVED' && order.fulfilment === null,
        itemCount: order.items.reduce((sum, i) => sum + i.qty, 0),
        items: order.items.map(publicOrderItem),
        delivery: publicDelivery(order.delivery),
        timeline: buildTimeline(order),
        createdAt: order.createdAt.toISOString(),
        handedOverAt: toIso(order.handedOverAt),
      })),
      meta: {
        total,
        page: q.page,
        pageSize: q.pageSize,
        pages: Math.ceil(total / q.pageSize),
        totalSpent: (spent._sum.paidAmount ?? 0) - (spent._sum.refundedAmount ?? 0),
        activeCount,
      },
    });
  }),
);
