import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { notFound } from '../../lib/errors.js';
import { toIso } from '../../lib/date.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import { orderStatusLabel, publicOrderItem } from '../../services/serialize.js';

export const adminCustomersRouter = Router();

const listQuery = z.object({
  q: z.string().trim().min(1).max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** GET /customers — захиалгын тоо, нийт зарцуулалт, сүүлд захиалсан огноо. */
adminCustomersRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof listQuery>>(req);

    const where: Prisma.CustomerWhereInput = q.q
      ? {
          OR: [
            { phone: { contains: q.q } },
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

    // Захиалгын тоо, дүнг DB дээр нэгтгэнэ — хэрэглэгч бүрийн бүх
    // захиалгыг хариунд багтаавал идэвхтэй хэрэглэгчдэд хариу томордог.
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
          id: customer.id,
          phone: customer.phone,
          name: customer.name,
          orderCount: s?._count._all ?? 0,
          totalSpent: s?._sum.subtotal ?? 0,
          lastOrderAt: toIso(s?._max.createdAt ?? null),
          createdAt: customer.createdAt.toISOString(),
        };
      }),
      meta: { total, page: q.page, pageSize: q.pageSize, pages: Math.ceil(total / q.pageSize) },
    });
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
        id: customer.id,
        phone: customer.phone,
        name: customer.name,
        createdAt: customer.createdAt.toISOString(),
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
          items: order.items.map(publicOrderItem),
          createdAt: order.createdAt.toISOString(),
        })),
      },
    });
  }),
);
