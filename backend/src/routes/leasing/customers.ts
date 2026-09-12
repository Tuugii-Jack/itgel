import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { normalizePhone, PHONE_RE } from '../../lib/code.js';
import { conflict, notFound } from '../../lib/errors.js';
import { toIso } from '../../lib/date.js';
import { serializeLeasing, LEASING_STAFF_ORDER_WHERE } from '../../lib/leasing.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import { orderStatusLabel, publicOrderItem } from '../../services/serialize.js';
import { currentLeasingPayGaps } from '../../services/settings.js';

export const leasingCustomersRouter = Router();

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
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    return normalizePhone(v);
  })
  .refine((v) => v === null || v === undefined || PHONE_RE.test(v), 'Утасны дугаар буруу.');

function serializeCustomer(customer: {
  id: string;
  email: string;
  phone: string | null;
  name: string | null;
  emailVerifiedAt: Date | null;
  district: string | null;
  khoroo: string | null;
  addressText: string | null;
  createdAt: Date;
}) {
  return {
    id: customer.id,
    email: customer.email,
    phone: customer.phone,
    name: customer.name,
    emailVerified: Boolean(customer.emailVerifiedAt),
    address: {
      district: customer.district,
      khoroo: customer.khoroo,
      addressText: customer.addressText,
    },
    createdAt: customer.createdAt.toISOString(),
  };
}

const leasingCustomerWhere: Prisma.CustomerWhereInput = {
  orders: {
    some: {
      ...LEASING_STAFF_ORDER_WHERE,
      deletedAt: null,
    },
  },
};

const listQuery = z.object({
  q: z.string().trim().min(1).max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

leasingCustomersRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof listQuery>>(req);
    const search: Prisma.CustomerWhereInput = q.q
      ? {
          OR: [
            { phone: { contains: q.q } },
            { email: { contains: q.q, mode: 'insensitive' } },
            { name: { contains: q.q, mode: 'insensitive' } },
          ],
        }
      : {};

    const where: Prisma.CustomerWhereInput = { AND: [leasingCustomerWhere, search] };

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
            ...LEASING_STAFF_ORDER_WHERE,
            deletedAt: null,
            status: { not: 'CANCELLED' },
          },
          _count: { _all: true },
          _sum: { subtotal: true, dueAmount: true },
        })
      : [];
    const byCustomer = new Map(stats.map((row) => [row.customerId, row]));

    res.json({
      data: customers.map((customer) => {
        const row = byCustomer.get(customer.id);
        return {
          ...serializeCustomer(customer),
          orderCount: row?._count._all ?? 0,
          totalSpent: row?._sum.subtotal ?? 0,
          dueAmount: row?._sum.dueAmount ?? 0,
        };
      }),
      meta: { total, page: q.page, pageSize: q.pageSize, pages: Math.ceil(total / q.pageSize) },
    });
  }),
);

leasingCustomersRouter.get(
  '/:id',
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, ...leasingCustomerWhere },
      include: {
        orders: {
          where: { ...LEASING_STAFF_ORDER_WHERE, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          include: { items: true, delivery: true },
        },
      },
    });
    if (!customer) throw notFound('Хэрэглэгч олдсонгүй.');

    const active = customer.orders.filter((o) => o.status !== 'CANCELLED');
    const gaps = await currentLeasingPayGaps();

    res.json({
      data: {
        ...serializeCustomer(customer),
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
          ...serializeLeasing(order, gaps),
          items: order.items.map((item) => publicOrderItem(item)),
          createdAt: order.createdAt.toISOString(),
        })),
      },
    });
  }),
);

leasingCustomersRouter.patch(
  '/:id',
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({
      email: emailSchema.optional(),
      name: z.string().trim().min(1).max(80).nullable().optional(),
      phone: phoneOptional,
      district: z.string().trim().max(60).nullable().optional(),
      khoroo: z.string().trim().max(30).nullable().optional(),
      addressText: z.string().trim().max(300).nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const existing = await prisma.customer.findFirst({
      where: { id, ...leasingCustomerWhere },
    });
    if (!existing) throw notFound('Хэрэглэгч олдсонгүй.');

    const body = req.body as {
      email?: string;
      name?: string | null;
      phone?: string | null;
      district?: string | null;
      khoroo?: string | null;
      addressText?: string | null;
    };

    if (body.email && body.email !== existing.email) {
      const taken = await prisma.customer.findUnique({ where: { email: body.email } });
      if (taken) throw conflict('Энэ и-мэйлээр бүртгэл байна.');
    }
    if (body.phone && body.phone !== existing.phone) {
      const phoneTaken = await prisma.customer.findFirst({
        where: { phone: body.phone, NOT: { id } },
      });
      if (phoneTaken) throw conflict('Энэ утас өөр бүртгэлтэй.');
    }

    const updated = await prisma.customer.update({
      where: { id },
      data: {
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.district !== undefined ? { district: body.district } : {}),
        ...(body.khoroo !== undefined ? { khoroo: body.khoroo } : {}),
        ...(body.addressText !== undefined ? { addressText: body.addressText } : {}),
      },
    });

    res.json({ data: serializeCustomer(updated) });
  }),
);
