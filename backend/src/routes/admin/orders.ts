import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { profitOf } from '../../lib/money.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, param, query, validate } from '../../middleware/validate.js';
import { adminPaymentsRouter } from './payments.js';
import {
  computeTotals,
  fullyPaid,
  loadOrderTotals,
  PAYMENT_STATE_LABEL,
  paymentState,
} from '../../services/money.js';
import { buildTimeline, changeOrderStatus } from '../../services/orders.js';
import {
  adminOrderItem,
  batchSummary,
  orderStatusLabel,
  publicDelivery,
} from '../../services/serialize.js';

export const adminOrdersRouter = Router();

// /api/admin/orders/:id/payments — төлбөр, буцаалт, мөр цуцлах
adminOrdersRouter.use('/:id/payments', adminPaymentsRouter);

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
        itemCount: order.items.filter((i) => i.cancelledAt === null).reduce((sum, i) => sum + i.qty, 0),
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        paidAmount: order.paidAmount,
        refundedAmount: order.refundedAmount,
        dueAmount: order.dueAmount,
        paymentState: paymentState(computeTotals(order)),
        profit: profitOf(order.items.filter((i) => i.cancelledAt === null)),
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
    body: z.object({
      status: orderStatus,
      reason: z.string().trim().max(300).optional(),
      /** Төлбөрийн шалгалтыг алгасах (бэлнээр авсан гэх мэт). */
      force: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { status, reason, force } = req.body as {
      status: z.infer<typeof orderStatus>;
      reason?: string;
      force?: boolean;
    };

    const orderId = param(req, 'id');

    // Төлбөр бүрэн ороогүй захиалгыг баталгаажуулахаас сэргийлнэ.
    // Мөнгө бэлнээр авсан гэх мэт тохиолдолд `force: true` -ээр давна.
    if (status === 'CONFIRMED' && !force) {
      const totals = await loadOrderTotals(orderId);
      if (!fullyPaid(totals)) {
        throw conflict(
          `Төлбөр бүрэн ороогүй байна. ${totals.subtotal}₮-с ${totals.netPaid}₮ орсон. ` +
            'Төлбөрийг эхлээд бүртгэнэ үү.',
          {
            subtotal: totals.subtotal,
            netPaid: totals.netPaid,
            missing: totals.subtotal - totals.netPaid,
          },
        );
      }
    }

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

/**
 * POST /orders/bulk-status — олон захиалгын төлвийг нэг хүсэлтээр солино.
 *
 * Захиалга бүрийг тусад нь боловсруулж, амжилттай ба алдаатайг тусад нь
 * буцаана. Нэг захиалга дээрх алдаа бусдыг зогсоохгүй.
 */
adminOrdersRouter.post(
  '/bulk-status',
  validate({
    body: z.object({
      ids: z.array(z.string().min(1)).min(1).max(200),
      status: orderStatus,
      reason: z.string().trim().max(300).optional(),
      force: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { ids, status, reason, force } = req.body as {
      ids: string[];
      status: z.infer<typeof orderStatus>;
      reason?: string;
      force?: boolean;
    };
    const actor = actorOf(req);

    const succeeded: string[] = [];
    const failed: { id: string; code?: string; message: string }[] = [];

    for (const id of ids) {
      try {
        if (status === 'CONFIRMED' && !force) {
          const totals = await loadOrderTotals(id);
          if (!fullyPaid(totals)) {
            throw conflict(`Төлбөр дутуу: ${totals.subtotal - totals.netPaid}₮ ороогүй байна.`);
          }
        }
        await changeOrderStatus(id, status, { actor, reason });
        succeeded.push(id);
      } catch (error) {
        const order = await prisma.order.findUnique({
          where: { id },
          select: { code: true },
        });
        failed.push({
          id,
          code: order?.code,
          message: error instanceof AppError ? error.message : 'Тодорхойгүй алдаа.',
        });
      }
    }

    res.json({
      data: {
        requested: ids.length,
        succeeded: succeeded.length,
        failed,
        status,
      },
    });
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
  // Цуцлагдсан мөр ашгийн тооцоонд ордоггүй.
  const activeItems = order.items.filter((i) => i.cancelledAt === null);
  const totals = computeTotals(order);
  const state = paymentState(totals);

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
    deliveryFee: order.deliveryFee,
    paidAmount: order.paidAmount,
    refundedAmount: order.refundedAmount,
    dueAmount: order.dueAmount,
    total: totals.total,
    netPaid: totals.netPaid,
    paymentState: state,
    paymentStateLabel: PAYMENT_STATE_LABEL[state],
    profit: profitOf(activeItems),
    fulfilment: order.fulfilment,
    note: order.note,
    batch: batchSummary(order.batch),
    delivery: publicDelivery(order.delivery),
    timeline: buildTimeline(order),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
