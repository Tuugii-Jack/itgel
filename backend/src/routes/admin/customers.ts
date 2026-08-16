import { Router } from 'express';
import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { normalizePhone, PHONE_RE } from '../../lib/code.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { toIso } from '../../lib/date.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import { orderStatusLabel, publicOrderItem } from '../../services/serialize.js';

export const adminCustomersRouter = Router();

const BCRYPT_ROUNDS = 10;

const emailSchema = z
  .string()
  .trim()
  .email()
  .max(120)
  .transform((v) => v.toLowerCase());

const phoneOptional = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v) => {
    if (v == null || v === '') return null;
    return normalizePhone(v);
  })
  .refine((v) => v === null || v === undefined || PHONE_RE.test(v), 'Утасны дугаар буруу.');

function serializeAdminCustomer(customer: {
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
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  defaultPayoutBank: boolean;
  createdAt: Date;
}) {
  return {
    id: customer.id,
    email: customer.email,
    phone: customer.phone,
    name: customer.name,
    emailVerified: Boolean(customer.emailVerifiedAt),
    hasPassword: Boolean(customer.passwordHash),
    address: {
      district: customer.district,
      khoroo: customer.khoroo,
      addressText: customer.addressText,
    },
    notifications: {
      payment: customer.notifyPayment,
      arrival: customer.notifyArrival,
      promo: customer.notifyPromo,
    },
    bank: {
      name: customer.bankName,
      accountNumber: customer.bankAccountNumber,
      accountName: customer.bankAccountName,
      defaultPayout: customer.defaultPayoutBank,
    },
    createdAt: customer.createdAt.toISOString(),
  };
}

const listQuery = z.object({
  q: z.string().trim().min(1).max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

adminCustomersRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof listQuery>>(req);

    const where: Prisma.CustomerWhereInput = q.q
      ? {
          OR: [
            { phone: { contains: q.q } },
            { email: { contains: q.q, mode: 'insensitive' } },
            { name: { contains: q.q, mode: 'insensitive' } },
          ],
        }
      : {};

    const [total, customers] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);

    const stats = customers.length
      ? await prisma.order.groupBy({
          by: ['customerId'],
          where: {
            customerId: { in: customers.map((c) => c.id) },
            deletedAt: null,
            status: { not: 'CANCELLED' },
          },
          _count: { _all: true },
          _sum: { subtotal: true },
          _max: { createdAt: true },
        })
      : [];
    const statsById = new Map(stats.map((s) => [s.customerId, s]));

    res.json({
      data: customers.map((customer) => {
        const s = statsById.get(customer.id);
        return {
          ...serializeAdminCustomer(customer),
          orderCount: s?._count._all ?? 0,
          totalSpent: s?._sum.subtotal ?? 0,
          lastOrderAt: toIso(s?._max.createdAt ?? null),
        };
      }),
      meta: { total, page: q.page, pageSize: q.pageSize, pages: Math.ceil(total / q.pageSize) },
    });
  }),
);

adminCustomersRouter.post(
  '/',
  validate({
    body: z.object({
      email: emailSchema,
      name: z.string().trim().min(1).max(80).nullable().optional(),
      phone: phoneOptional,
      password: z.string().min(6).max(100).optional(),
      emailVerified: z.boolean().optional(),
      district: z.string().trim().max(60).nullable().optional(),
      khoroo: z.string().trim().max(30).nullable().optional(),
      addressText: z.string().trim().max(300).nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      email: string;
      name?: string | null;
      phone?: string | null;
      password?: string;
      emailVerified?: boolean;
      district?: string | null;
      khoroo?: string | null;
      addressText?: string | null;
    };

    const exists = await prisma.customer.findUnique({ where: { email: body.email } });
    if (exists) throw conflict('Энэ и-мэйлээр бүртгэл байна.');
    if (body.phone) {
      const phoneTaken = await prisma.customer.findFirst({ where: { phone: body.phone } });
      if (phoneTaken) throw conflict('Энэ утас өөр бүртгэлтэй.');
    }

    const customer = await prisma.customer.create({
      data: {
        email: body.email,
        name: body.name ?? null,
        phone: body.phone ?? null,
        passwordHash: body.password ? await bcrypt.hash(body.password, BCRYPT_ROUNDS) : null,
        emailVerifiedAt: body.emailVerified === false ? null : new Date(),
        district: body.district ?? null,
        khoroo: body.khoroo ?? null,
        addressText: body.addressText ?? null,
      },
    });

    res.status(201).json({ data: serializeAdminCustomer(customer) });
  }),
);

adminCustomersRouter.get(
  '/:id',
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        orders: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          include: { items: true, delivery: true },
        },
      },
    });
    if (!customer) throw notFound('Хэрэглэгч олдсонгүй.');

    const active = customer.orders.filter((o) => o.status !== 'CANCELLED');

    res.json({
      data: {
        ...serializeAdminCustomer(customer),
        stats: {
          orderCount: active.length,
          totalSpent: active.reduce((sum, o) => sum + o.subtotal, 0),
          handedOver: customer.orders.filter((o) => o.status === 'HANDED_OVER').length,
          cancelled: customer.orders.filter((o) => o.status === 'CANCELLED').length,
          lastOrderAt: toIso(customer.orders[0]?.createdAt ?? null),
        },
        orders: customer.orders.map((order) => ({
          id: order.id,
          code: order.code,
          status: order.status,
          statusLabel: orderStatusLabel(order.status),
          subtotal: order.subtotal,
          dueAmount: order.dueAmount,
          fulfilment: order.fulfilment,
          items: order.items.map((item) => publicOrderItem(item)),
          createdAt: order.createdAt.toISOString(),
        })),
      },
    });
  }),
);

adminCustomersRouter.patch(
  '/:id',
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({
      email: emailSchema.optional(),
      name: z.string().trim().min(1).max(80).nullable().optional(),
      phone: phoneOptional,
      password: z.string().min(6).max(100).optional(),
      emailVerified: z.boolean().optional(),
      district: z.string().trim().max(60).nullable().optional(),
      khoroo: z.string().trim().max(30).nullable().optional(),
      addressText: z.string().trim().max(300).nullable().optional(),
      notifyPayment: z.boolean().optional(),
      notifyArrival: z.boolean().optional(),
      notifyPromo: z.boolean().optional(),
      bankName: z.string().trim().max(80).nullable().optional(),
      bankAccountNumber: z.string().trim().max(40).nullable().optional(),
      bankAccountName: z.string().trim().max(80).nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const body = req.body as {
      email?: string;
      name?: string | null;
      phone?: string | null;
      password?: string;
      emailVerified?: boolean;
      district?: string | null;
      khoroo?: string | null;
      addressText?: string | null;
      notifyPayment?: boolean;
      notifyArrival?: boolean;
      notifyPromo?: boolean;
      bankName?: string | null;
      bankAccountNumber?: string | null;
      bankAccountName?: string | null;
    };

    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) throw notFound('Хэрэглэгч олдсонгүй.');

    if (body.email && body.email !== existing.email) {
      const taken = await prisma.customer.findUnique({ where: { email: body.email } });
      if (taken) throw conflict('Энэ и-мэйлээр бүртгэл байна.');
    }
    if (body.phone) {
      const phoneTaken = await prisma.customer.findFirst({
        where: { phone: body.phone, NOT: { id } },
      });
      if (phoneTaken) throw conflict('Энэ утас өөр бүртгэлтэй.');
    }

    if (
      body.password === undefined &&
      body.email === undefined &&
      body.name === undefined &&
      body.phone === undefined &&
      body.emailVerified === undefined &&
      body.district === undefined &&
      body.khoroo === undefined &&
      body.addressText === undefined &&
      body.notifyPayment === undefined &&
      body.notifyArrival === undefined &&
      body.notifyPromo === undefined &&
      body.bankName === undefined &&
      body.bankAccountNumber === undefined &&
      body.bankAccountName === undefined
    ) {
      throw badRequest('Өөрчлөх талбар алга.');
    }

    const customer = await prisma.customer.update({
      where: { id },
      data: {
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.district !== undefined ? { district: body.district } : {}),
        ...(body.khoroo !== undefined ? { khoroo: body.khoroo } : {}),
        ...(body.addressText !== undefined ? { addressText: body.addressText } : {}),
        ...(body.notifyPayment !== undefined ? { notifyPayment: body.notifyPayment } : {}),
        ...(body.notifyArrival !== undefined ? { notifyArrival: body.notifyArrival } : {}),
        ...(body.notifyPromo !== undefined ? { notifyPromo: body.notifyPromo } : {}),
        ...(body.bankName !== undefined ? { bankName: body.bankName ?? "" } : {}),
        ...(body.bankAccountNumber !== undefined
          ? { bankAccountNumber: body.bankAccountNumber ?? "" }
          : {}),
        ...(body.bankAccountName !== undefined
          ? { bankAccountName: body.bankAccountName ?? "" }
          : {}),
        ...(body.password !== undefined
          ? { passwordHash: await bcrypt.hash(body.password, BCRYPT_ROUNDS) }
          : {}),
        ...(body.emailVerified !== undefined
          ? { emailVerifiedAt: body.emailVerified ? new Date() : null }
          : {}),
      },
    });

    res.json({ data: serializeAdminCustomer(customer) });
  }),
);
