import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { profitOf } from '../../lib/money.js';
import { serializeLeasing, leasingGoodsWhere, buildLeasingPayPlan, LEASING_STAFF_ORDER_WHERE } from '../../lib/leasing.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, param, query, validate } from '../../middleware/validate.js';
import { adminPaymentsRouter } from '../admin/payments.js';
import { adminOrderQpayRouter } from '../admin/orderQpay.js';
import { adminOrderDetail } from '../admin/orders.js';
import {
  computeTotals,
  confirmThreshold,
  fullyPaid,
  loadOrderTotals,
  paymentState,
} from '../../services/money.js';
import { buildTimeline, changeOrderStatus, revertOrderStatus } from '../../services/orders.js';
import { batchSummary, orderStatusLabel } from '../../services/serialize.js';
import { syncOrderStorageFee } from '../../services/storageFee.js';
import { getSettingsCached, leasingPayGapsOf } from '../../services/settings.js';

export const leasingOrdersRouter = Router();

leasingOrdersRouter.use(
  '/:id/payments',
  asyncHandler(async (req, _res, next) => {
    await assertLeasingOrder(param(req, 'id'));
    next();
  }),
  adminPaymentsRouter,
);
leasingOrdersRouter.use(
  '/:id/qpay',
  asyncHandler(async (req, _res, next) => {
    await assertLeasingOrder(param(req, 'id'));
    next();
  }),
  adminOrderQpayRouter,
);

async function assertLeasingOrder(id: string) {
  const order = await prisma.order.findFirst({
    where: { id, isLeasing: true },
    select: { id: true },
  });
  if (!order) throw notFound('Захиалга олдсонгүй.');
  return order;
}

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
  q: z.string().trim().min(1).max(60).optional(),
  deleted: z.coerce.boolean().optional(),
  goods: z
    .enum([
      'all',
      'arrived',
      'not_arrived',
      'arrived_unpaid',
      'arrived_paid',
      'pay_due_today',
      'pay_overdue',
    ])
    .optional()
    .default('arrived_unpaid'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

leasingOrdersRouter.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const where: Prisma.OrderWhereInput = { ...LEASING_STAFF_ORDER_WHERE, deletedAt: null };
    const arrived = leasingGoodsWhere('arrived') as Prisma.OrderWhereInput;
    const notArrived = leasingGoodsWhere('not_arrived') as Prisma.OrderWhereInput;
    const gaps = leasingPayGapsOf(await getSettingsCached());
    const [total, notArrivedCount, arrivedUnpaid, arrivedPaid, open] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.count({ where: { ...where, ...notArrived } }),
      prisma.order.count({
        where: { ...where, ...arrived, dueAmount: { gt: 0 } },
      }),
      prisma.order.count({
        where: { ...where, ...arrived, dueAmount: { lte: 0 } },
      }),
      prisma.order.findMany({
        where: { ...where, status: { not: 'CANCELLED' }, dueAmount: { gt: 0 } },
        select: {
          createdAt: true,
          subtotal: true,
          leasingFee: true,
          paidAmount: true,
          refundedAmount: true,
          isLeasing: true,
        },
      }),
    ]);
    let payDueToday = 0;
    let payOverdue = 0;
    for (const order of open) {
      const plan = buildLeasingPayPlan({ ...order, payGaps: gaps });
      if (plan?.dueToday) payDueToday += 1;
      if (plan?.overdue) payOverdue += 1;
    }
    res.json({
      data: {
        total,
        notArrived: notArrivedCount,
        arrivedUnpaid,
        arrivedPaid,
        payDueToday,
        payOverdue,
      },
    });
  }),
);

leasingOrdersRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof listQuery>>(req);
    const gaps = leasingPayGapsOf(await getSettingsCached());
    const scheduleFilter = q.goods === 'pay_due_today' || q.goods === 'pay_overdue';

    const where: Prisma.OrderWhereInput = {
      ...LEASING_STAFF_ORDER_WHERE,
      deletedAt: q.deleted ? { not: null } : null,
      ...(scheduleFilter
        ? { status: { not: 'CANCELLED' }, dueAmount: { gt: 0 } }
        : (leasingGoodsWhere(
            q.goods as 'all' | 'arrived' | 'not_arrived' | 'arrived_unpaid' | 'arrived_paid',
          ) as Prisma.OrderWhereInput)),
      ...(q.q
        ? {
            OR: [
              { code: { contains: q.q, mode: 'insensitive' } },
              { customer: { phone: { contains: q.q } } },
              { customer: { name: { contains: q.q, mode: 'insensitive' } } },
              { customer: { email: { contains: q.q.toLowerCase(), mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const include = {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      items: {
        select: { qty: true, unitPrice: true, costPriceSnapshot: true, cancelledAt: true },
      },
      batch: true,
    } as const;

    let orders = await prisma.order.findMany({
      where,
      orderBy: q.deleted ? { deletedAt: 'desc' } : { createdAt: 'desc' },
      include,
      ...(scheduleFilter ? {} : { skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    });
    let total = scheduleFilter ? orders.length : await prisma.order.count({ where });
    if (scheduleFilter) {
      orders = orders.filter((order) => {
        const plan = buildLeasingPayPlan({ ...order, payGaps: gaps });
        if (q.goods === 'pay_due_today') return Boolean(plan?.dueToday);
        return Boolean(plan?.overdue);
      });
      total = orders.length;
      orders = orders.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    }

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
          email: order.customer.email,
        },
        itemCount: order.items
          .filter((i) => i.cancelledAt === null)
          .reduce((sum, i) => sum + i.qty, 0),
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        storageFee: order.storageFee,
        cargoFee: order.cargoFee,
        paidAmount: order.paidAmount,
        refundedAmount: order.refundedAmount,
        dueAmount: order.dueAmount,
        paymentState: paymentState(computeTotals(order)),
        ...serializeLeasing(order, gaps),
        paymentClaimedAt: order.paymentClaimedAt?.toISOString() ?? null,
        profit: profitOf(order.items.filter((i) => i.cancelledAt === null)),
        fulfilment: order.fulfilment,
        batch: batchSummary(order.batch),
        createdAt: order.createdAt.toISOString(),
        deletedAt: order.deletedAt?.toISOString() ?? null,
      })),
      meta: { total, page: q.page, pageSize: q.pageSize, pages: Math.ceil(total / q.pageSize) },
    });
  }),
);

leasingOrdersRouter.get(
  '/:id',
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const orderId = param(req, 'id');
    await assertLeasingOrder(orderId);
    await syncOrderStorageFee(orderId);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        items: { include: { product: true } },
        batch: true,
        delivery: true,
      },
    });
    if (!order) throw notFound('Захиалга олдсонгүй.');
    const gaps = leasingPayGapsOf(await getSettingsCached());

    res.json({ data: { ...adminOrderDetail(order, gaps), timeline: buildTimeline(order) } });
  }),
);

leasingOrdersRouter.patch(
  '/:id/status',
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({
      status: orderStatus,
      reason: z.string().trim().max(300).optional(),
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
    await assertLeasingOrder(orderId);

    if (status === 'CONFIRMED' && !force) {
      const totals = await loadOrderTotals(orderId);
      if (!fullyPaid(totals)) {
        const need = confirmThreshold(totals);
        throw conflict(
          `Лизингийн шимтгэл ороогүй байна. ${need}₮-с ${totals.netPaid}₮ орсон. Төлбөрийг эхлээд бүртгэнэ үү.`,
          {
            subtotal: totals.subtotal,
            leasingFee: totals.leasingFee,
            netPaid: totals.netPaid,
            missing: need - totals.netPaid,
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

    res.json({
      data: adminOrderDetail(order, leasingPayGapsOf(await getSettingsCached())),
    });
  }),
);

leasingOrdersRouter.post(
  '/:id/status/revert',
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({ reason: z.string().trim().max(300).optional() }).optional(),
  }),
  asyncHandler(async (req, res) => {
    const orderId = param(req, 'id');
    await assertLeasingOrder(orderId);
    const reason =
      req.body && typeof req.body === 'object' && 'reason' in req.body
        ? (req.body as { reason?: string }).reason
        : undefined;

    await revertOrderStatus(orderId, { actor: actorOf(req), reason });

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        customer: true,
        items: { include: { product: true } },
        batch: true,
        delivery: true,
      },
    });

    res.json({
      data: adminOrderDetail(order, leasingPayGapsOf(await getSettingsCached())),
    });
  }),
);

leasingOrdersRouter.post(
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

    const orders = await prisma.order.findMany({
      where: { id: { in: ids }, isLeasing: true },
      select: {
        id: true,
        code: true,
        subtotal: true,
        deliveryFee: true,
        paidAmount: true,
        refundedAmount: true,
        leasingFee: true,
      },
    });
    const byId = new Map(orders.map((o) => [o.id, o]));

    const succeeded: string[] = [];
    const failed: { id: string; code?: string; message: string }[] = [];

    for (const id of ids) {
      const order = byId.get(id);
      if (!order) {
        failed.push({ id, message: 'Захиалга олдсонгүй.' });
        continue;
      }
      try {
        if (status === 'CONFIRMED' && !force) {
          const totals = computeTotals(order);
          if (!fullyPaid(totals)) {
            throw conflict(`Төлбөр дутуу: ${confirmThreshold(totals) - totals.netPaid}₮ ороогүй байна.`);
          }
        }
        await changeOrderStatus(id, status, { actor, reason });
        succeeded.push(id);
      } catch (error) {
        failed.push({
          id,
          code: order.code,
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
