import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { notFound } from '../../lib/errors.js';
import { profitOf } from '../../lib/money.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, param, query, validate } from '../../middleware/validate.js';
import { buildTimeline, changeOrderStatus } from '../../services/orders.js';
import {
  adminOrderItem,
  batchSummary,
  orderStatusLabel,
  publicDelivery,
} from '../../services/serialize.js';

export const adminOrdersRouter = Router();

const orderStatus = z.enum([
  'NEW',
  'CONFIRMED',
  'IN_BATCH',
  'IN_TRANSIT',
  'ARRIVED',
  'HANDED_OVER',
  'CANCELLED',
]);

const listQuery = z.object({
  status: orderStatus.optional(),
  q: z.string().trim().min(1).max(60).optional(),
  batch: z.string().min(1).optional(),
  fulfilment: z.enum(['PICKUP', 'DELIVERY']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

adminOrdersRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof listQuery>>(req);

    const where: Prisma.OrderWhereInput = {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.batch ? { batchId: q.batch } : {}),
      ...(q.fulfilment ? { fulfilment: q.fulfilment } : {}),
      ...(q.q
        ? {
            OR: [
              { code: { contains: q.q, mode: 'insensitive' } },
              { customer: { phone: { contains: q.q } } },
              { customer: { name: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { customer: true, items: true, batch: true, delivery: true },
      }),
    ]);

    res.json({
      data: orders.map((order) => ({
        id: order.id,
        code: order.code,
        status: order.status,
        statusLabel: orderStatusLabel(order.status),
        customer: {
          id: order.customer.id,
          name: order.customer.name,
          phone: order.customer.phone,
        },
        itemCount: order.items.reduce((sum, i) => sum + i.qty, 0),
        subtotal: order.subtotal,
        paidAmount: order.paidAmount,
        dueAmount: order.dueAmount,
        deliveryFee: order.deliveryFee,
        profit: profitOf(order.items),
        fulfilment: order.fulfilment,
        batch: batchSummary(order.batch),
        createdAt: order.createdAt.toISOString(),
      })),
      meta: { total, page: q.page, pageSize: q.pageSize, pages: Math.ceil(total / q.pageSize) },
    });
  }),
);

adminOrdersRouter.get(
  '/:id',
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        items: { include: { product: true } },
        batch: true,
        delivery: true,
      },
    });
    if (!order) throw notFound('Захиалга олдсонгүй.');

    res.json({ data: adminOrderDetail(order) });
  }),
);

adminOrdersRouter.patch(
  '/:id/status',
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({ status: orderStatus, reason: z.string().trim().max(300).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const { status, reason } = req.body as { status: z.infer<typeof orderStatus>; reason?: string };

    const orderId = param(req, 'id');
    await changeOrderStatus(orderId, status, { actor: actorOf(req), reason });

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        customer: true,
        items: { include: { product: true } },
        batch: true,
        delivery: true,
      },
    });

    res.json({ data: adminOrderDetail(order) });
  }),
);

type OrderDetail = Prisma.OrderGetPayload<{
  include: {
    customer: true;
    items: { include: { product: true } };
    batch: true;
    delivery: true;
  };
}>;

export function adminOrderDetail(order: OrderDetail) {
  return {
    id: order.id,
    code: order.code,
    status: order.status,
    statusLabel: orderStatusLabel(order.status),
    customer: {
      id: order.customer.id,
      name: order.customer.name,
      phone: order.customer.phone,
    },
    items: order.items.map(adminOrderItem),
    subtotal: order.subtotal,
    paidAmount: order.paidAmount,
    dueAmount: order.dueAmount,
    deliveryFee: order.deliveryFee,
    profit: profitOf(order.items),
    fulfilment: order.fulfilment,
    note: order.note,
    batch: batchSummary(order.batch),
    delivery: publicDelivery(order.delivery),
    timeline: buildTimeline(order),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
