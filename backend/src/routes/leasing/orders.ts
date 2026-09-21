import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { profitOf, leasingPayeeSums } from '../../lib/money.js';
import { serializeLeasing, leasingGoodsWhere, buildLeasingPayPlan, LEASING_STAFF_ORDER_WHERE, LEASING_INSTALLMENT_WHERE, SMS_TEMPLATE_MAX } from '../../lib/leasing.js';
import {
  assertCanMutateScopedLeasingOrder,
  leasingVisibleOrderWhere,
  ownLeasingResaleItems,
  scopedLeasingListMoney,
  type LeasingAuth,
} from '../../lib/leasingAccess.js';
import { isOwnerRole } from '../../lib/adminRoles.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, param, query, validate } from '../../middleware/validate.js';
import { adminPaymentsRouter } from '../admin/payments.js';
import { adminOrderQpayRouter } from '../admin/orderQpay.js';
import { assertLeasingOrderAccess, assertLeasingOrderMutation, resolveReadyTransferOwner } from '../../modules/leasing/guards.js';
import {
  arrivedUnpaidReminderText,
  assertSendSmsText,
  payReminderPreview,
  reminderTemplateOf,
  scheduleReminderText,
} from '../../modules/leasing/orderSms.js';
import { adminOrderDetail } from '../../modules/orders/adminDetail.js';
import {
  computeTotals,
  confirmThreshold,
  fullyPaid,
  loadOrderTotals,
  PAYMENT_STATE_LABEL,
  paymentState,
} from '../../services/money.js';
import { buildTimeline, changeOrderStatus, revertOrderStatus } from '../../services/orders.js';
import { batchSummary, orderStatusLabel } from '../../services/serialize.js';
import { syncOrderStorageFee } from '../../services/storageFee.js';
import { getSettingsCached, invalidateSettingsCache, leasingPayGapsOf } from '../../services/settings.js';
import { stripSmsUrls } from '../../services/sms.js';
import { dispatchSms } from '../../services/smsDispatch.js';
import {
  executeReadyTransfer,
  loadTransferPreview,
  serializeTransferPreview,
  transferAvailability,
} from '../../services/readyTransfer.js';
import { attachItgelToItems } from '../../services/itgelSettlement.js';
import { selectionsOf } from '../../lib/options.js';

export const leasingOrdersRouter = Router();

leasingOrdersRouter.use(
  '/:id/payments',
  asyncHandler(async (req, _res, next) => {
    await assertLeasingOrderAccess(param(req, 'id'), req.auth!);
    next();
  }),
  adminPaymentsRouter,
);
leasingOrdersRouter.use(
  '/:id/qpay',
  asyncHandler(async (req, _res, next) => {
    await assertLeasingOrderAccess(param(req, 'id'), req.auth!);
    next();
  }),
  adminOrderQpayRouter,
);

const orderStatus = z.enum([
  'NEW',
  'CONFIRMED',
  'IN_BATCH',
  'IN_TRANSIT',
  'ARRIVED',
  'HANDED_OVER',
  'CANCELLED',
]);

function leasingLedgerAmounts(
  order: {
    paidAmount: number;
    refundedAmount: number;
    payments?: Array<{ kind: string; payeeKind: string | null; amount: number }>;
  },
): { paidAmount: number; refundedAmount: number } {
  if (!order.payments || order.payments.length === 0) {
    return { paidAmount: order.paidAmount, refundedAmount: order.refundedAmount };
  }
  const sums = leasingPayeeSums(order.payments);
  return { paidAmount: sums.paid, refundedAmount: sums.refunded };
}

function overlayLeasingMoney(
  auth: LeasingAuth,
  order: {
    isLeasing?: boolean | null;
    payeeKind?: string | null;
    subtotal: number;
    paidAmount: number;
    refundedAmount: number;
    dueAmount: number;
    items: Array<{
      id?: string;
      cancelledAt: Date | string | null;
      qty: number;
      unitPrice: number;
      costPriceSnapshot?: number;
      round?: { ownerKind?: string | null; ownerAdminId?: string | null } | null;
    }>;
    payments?: Array<{ kind: string; payeeKind: string | null; amount: number }>;
  },
) {
  const liveItems = order.items.filter((item) => item.cancelledAt === null);
  const ledger = leasingLedgerAmounts(order);
  return scopedLeasingListMoney(auth, order, order.items, {
    itemCount: liveItems.reduce((sum, item) => sum + item.qty, 0),
    subtotal: order.subtotal,
    paidAmount: ledger.paidAmount,
    refundedAmount: ledger.refundedAmount,
    dueAmount: order.dueAmount,
    profit: profitOf(liveItems),
  });
}

function filterLeasingDetailItems<T extends { id: string }>(
  auth: LeasingAuth,
  mixed: boolean,
  items: T[],
  rawItems: Array<{ id: string; cancelledAt?: Date | string | null; round?: { ownerKind?: string | null; ownerAdminId?: string | null } | null }>,
): T[] {
  if (!mixed || isOwnerRole(auth.role)) return items;
  const ownIds = new Set(
    ownLeasingResaleItems(rawItems, auth.sub, { includeCancelled: true }).map((item) => item.id),
  );
  return items.filter((item) => ownIds.has(item.id));
}

const leasingOrderDetailInclude = {
  customer: true,
  items: { include: { product: true, round: true } },
  payments: { select: { kind: true, payeeKind: true, amount: true } },
  batch: true,
  delivery: true,
} as const;

async function scopedLeasingOrderResponse(auth: LeasingAuth, orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: leasingOrderDetailInclude,
  });
  const gaps = leasingPayGapsOf(await getSettingsCached());
  const detail = adminOrderDetail(order, gaps);
  const scoped = overlayLeasingMoney(auth, order);
  const items = filterLeasingDetailItems(
    auth,
    scoped.mixedOwnership,
    await attachItgelToItems(detail.items, order.id),
    order.items,
  );
  const totals = computeTotals({
    ...order,
    subtotal: scoped.subtotal,
    paidAmount: scoped.paidAmount,
    refundedAmount: scoped.refundedAmount,
  });
  const state = paymentState({ ...totals, dueAmount: scoped.dueAmount });
  return {
    ...detail,
    timeline: buildTimeline(order),
    items,
    mixedOwnership: scoped.mixedOwnership,
    attributedMoney: scoped.attributedMoney,
    subtotal: scoped.subtotal,
    paidAmount: scoped.paidAmount,
    refundedAmount: scoped.refundedAmount,
    dueAmount: scoped.dueAmount,
    unallocatedPaid: scoped.unallocatedPaid,
    unallocatedRefunded: scoped.unallocatedRefunded,
    profit: scoped.profit,
    netPaid: scoped.paidAmount - scoped.refundedAmount,
    total: totals.total,
    paymentState: state,
    paymentStateLabel: PAYMENT_STATE_LABEL[state],
  };
}

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
      'resale',
    ])
    .optional()
    .default('arrived_unpaid'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

leasingOrdersRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const scoped = leasingVisibleOrderWhere(req.auth!);
    const where: Prisma.OrderWhereInput = { AND: [scoped, { deletedAt: null }] };
    const arrived = leasingGoodsWhere('arrived') as Prisma.OrderWhereInput;
    const notArrived = leasingGoodsWhere('not_arrived') as Prisma.OrderWhereInput;
    const gaps = leasingPayGapsOf(await getSettingsCached());
    const [total, notArrivedCount, arrivedUnpaid, arrivedPaid, resaleCount, open] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.count({ where: { ...where, ...notArrived } }),
      prisma.order.count({
        where: { ...where, ...arrived, dueAmount: { gt: 0 } },
      }),
      prisma.order.count({
        where: { ...where, ...arrived, dueAmount: { lte: 0 } },
      }),
      prisma.order.count({
        where: { AND: [scoped, { deletedAt: null, payeeKind: 'LEASING', isLeasing: false }] },
      }),
      prisma.order.findMany({
        where: {
          AND: [scoped, LEASING_INSTALLMENT_WHERE, { deletedAt: null, status: { not: 'CANCELLED' }, dueAmount: { gt: 0 }, debtClosedAt: null }],
        },
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
        resaleCount,
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
      AND: [
        leasingVisibleOrderWhere(req.auth!),
        q.goods === 'resale' ? { payeeKind: 'LEASING', isLeasing: false } : LEASING_STAFF_ORDER_WHERE,
        { deletedAt: q.deleted ? { not: null } : null },
        q.goods === 'resale'
          ? {}
          : scheduleFilter
            ? { status: { not: 'CANCELLED' }, dueAmount: { gt: 0 }, debtClosedAt: null }
            : (leasingGoodsWhere(
                q.goods as 'all' | 'arrived' | 'not_arrived' | 'arrived_unpaid' | 'arrived_paid',
              ) as Prisma.OrderWhereInput),
        q.q
          ? {
              OR: [
                { code: { contains: q.q, mode: 'insensitive' } },
                { customer: { phone: { contains: q.q } } },
                { customer: { name: { contains: q.q, mode: 'insensitive' } } },
                { customer: { email: { contains: q.q.toLowerCase(), mode: 'insensitive' } } },
              ],
            }
          : {},
      ],
    };

    const include = {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      items: {
        select: {
          id: true,
          qty: true,
          unitPrice: true,
          costPriceSnapshot: true,
          cancelledAt: true,
          round: { select: { ownerKind: true, ownerAdminId: true } },
        },
      },
      payments: { select: { kind: true, payeeKind: true, amount: true } },
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
      data: orders.map((order) => {
        const scoped = overlayLeasingMoney(req.auth!, order);
        const totals = computeTotals({
          ...order,
          subtotal: scoped.subtotal,
          paidAmount: scoped.paidAmount,
          refundedAmount: scoped.refundedAmount,
        });
        const state = paymentState({ ...totals, dueAmount: scoped.dueAmount });
        return {
        id: order.id,
        code: order.code,
        status: order.status,
        statusLabel: orderStatusLabel(order.status),
        customer: {
          id: order.customer.id,
            name: order.customer.name?.trim() || null,
          phone: order.customer.phone,
          email: order.customer.email,
        },
        itemCount: scoped.itemCount,
        subtotal: scoped.subtotal,
        deliveryFee: order.deliveryFee,
        storageFee: order.storageFee,
        cargoFee: order.cargoFee,
        paidAmount: scoped.paidAmount,
        refundedAmount: scoped.refundedAmount,
        dueAmount: scoped.dueAmount,
        unallocatedPaid: scoped.unallocatedPaid,
        unallocatedRefunded: scoped.unallocatedRefunded,
        attributedMoney: scoped.attributedMoney,
        paymentState: state,
        payeeKind: (order as { payeeKind?: string }).payeeKind,
        isResale: order.payeeKind === 'LEASING' && !order.isLeasing,
        mixedOwnership: scoped.mixedOwnership,
        ...serializeLeasing(order, gaps),
        paymentClaimedAt: order.paymentClaimedAt?.toISOString() ?? null,
        profit: scoped.profit,
        fulfilment: order.fulfilment,
        batch: batchSummary(order.batch),
        createdAt: order.createdAt.toISOString(),
        deletedAt: order.deletedAt?.toISOString() ?? null,
      };
      }),
      meta: { total, page: q.page, pageSize: q.pageSize, pages: Math.ceil(total / q.pageSize) },
    });
  }),
);

leasingOrdersRouter.get(
  '/:id',
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const orderId = param(req, 'id');
    await assertLeasingOrderAccess(orderId, req.auth!);
    await syncOrderStorageFee(orderId);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        items: {
          include: {
            product: true,
            round: true,
          },
        },
        payments: { select: { kind: true, payeeKind: true, amount: true } },
        batch: true,
        delivery: true,
      },
    });
    if (!order) throw notFound('Захиалга олдсонгүй.');
    const gaps = leasingPayGapsOf(await getSettingsCached());
    const detail = adminOrderDetail(order, gaps);
    const scoped = overlayLeasingMoney(req.auth!, order);
    let items = await attachItgelToItems(detail.items, order.id);
    items = filterLeasingDetailItems(req.auth!, scoped.mixedOwnership, items, order.items);
    const totals = computeTotals({
      ...order,
      subtotal: scoped.subtotal,
      paidAmount: scoped.paidAmount,
      refundedAmount: scoped.refundedAmount,
    });
    const state = paymentState({ ...totals, dueAmount: scoped.dueAmount });
    res.json({
      data: {
        ...detail,
        timeline: buildTimeline(order),
        items,
        mixedOwnership: scoped.mixedOwnership,
        attributedMoney: scoped.attributedMoney,
        subtotal: scoped.subtotal,
        paidAmount: scoped.paidAmount,
        refundedAmount: scoped.refundedAmount,
        dueAmount: scoped.dueAmount,
        unallocatedPaid: scoped.unallocatedPaid,
        unallocatedRefunded: scoped.unallocatedRefunded,
        profit: scoped.profit,
        netPaid: scoped.paidAmount - scoped.refundedAmount,
        total: totals.total,
        paymentState: state,
        paymentStateLabel: PAYMENT_STATE_LABEL[state],
      },
    });
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
    await assertLeasingOrderMutation(orderId, req.auth!);

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
    res.json({ data: await scopedLeasingOrderResponse(req.auth!, orderId) });
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
    await assertLeasingOrderMutation(orderId, req.auth!);
    const reason =
      req.body && typeof req.body === 'object' && 'reason' in req.body
        ? (req.body as { reason?: string }).reason
        : undefined;

    await revertOrderStatus(orderId, { actor: actorOf(req), reason });
    res.json({ data: await scopedLeasingOrderResponse(req.auth!, orderId) });
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
      where: { id: { in: ids }, AND: [leasingVisibleOrderWhere(req.auth!)] },
      select: {
        id: true,
        code: true,
        subtotal: true,
        deliveryFee: true,
        paidAmount: true,
        refundedAmount: true,
        leasingFee: true,
        isLeasing: true,
        payeeKind: true,
        items: {
          select: { cancelledAt: true, round: { select: { ownerKind: true, ownerAdminId: true } } },
        },
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
        assertCanMutateScopedLeasingOrder(order, order.items, req.auth!);
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

type ScheduleSmsKind = 'due_today' | 'overdue' | 'arrived_unpaid';

/**
 * POST /orders/sms-reminders — өнөөдөр төлөгдөөгүй, хуваарь хоцорсон, ирсэн·төлөөгүй бүгдэд.
 * `/:id`-ээс өмнө бүртгэнэ.
 */
leasingOrdersRouter.post(
  '/sms-reminders',
  validate({
    body: z.object({
      kind: z.enum(['due_today', 'overdue', 'arrived_unpaid']),
      orderIds: z.array(z.string().min(1).max(80)).min(1).max(500),
      template: z.string().max(SMS_TEMPLATE_MAX).optional(),
      overrides: z
        .array(
          z.object({
            orderId: z.string().min(1).max(80),
            text: z.string().min(1).max(400),
          }),
        )
        .max(500)
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { kind, orderIds, template: templateOverride, overrides } = req.body as {
      kind: ScheduleSmsKind;
      orderIds: string[];
      template?: string;
      overrides?: { orderId: string; text: string }[];
    };
    const ids = [...new Set(orderIds)];
    const settings = await getSettingsCached();
    const gaps = leasingPayGapsOf(settings);
    const template = reminderTemplateOf(kind, templateOverride, settings);
    const saved = templateOverride?.trim();
    if (saved) {
      await prisma.setting.update({
        where: { id: 1 },
        data:
          kind === 'due_today'
            ? { leasingSmsDueToday: saved }
            : kind === 'overdue'
              ? { leasingSmsOverdue: saved }
              : { leasingSmsArrivedUnpaid: saved },
      });
      invalidateSettingsCache();
    }
    const where: Prisma.OrderWhereInput =
      kind === 'arrived_unpaid'
        ? {
            AND: [
              leasingVisibleOrderWhere(req.auth!),
              LEASING_INSTALLMENT_WHERE,
              {
                deletedAt: null,
                debtClosedAt: null,
                id: { in: ids },
                ...(leasingGoodsWhere('arrived_unpaid') as Prisma.OrderWhereInput),
              },
            ],
          }
        : {
            AND: [
              leasingVisibleOrderWhere(req.auth!),
              LEASING_INSTALLMENT_WHERE,
              {
                deletedAt: null,
                debtClosedAt: null,
                id: { in: ids },
                status: { not: 'CANCELLED' },
                dueAmount: { gt: 0 },
              },
            ],
          };
    const orders = await prisma.order.findMany({
      where,
      select: {
        id: true,
        code: true,
        createdAt: true,
        subtotal: true,
        leasingFee: true,
        paidAmount: true,
        refundedAmount: true,
        dueAmount: true,
        isLeasing: true,
        customer: { select: { name: true, phone: true } },
      },
    });

    const overrideById = new Map(
      (overrides ?? []).map((row) => [row.orderId, row.text] as const),
    );
    const sent: string[] = [];
    const skipped: string[] = [];
    const failed: { orderId: string; code: string; error: string }[] = [];
    let pending = 0;
    let delivered = 0;
    let unknown = 0;

    for (const order of orders) {
      const overrideRaw = overrideById.get(order.id);
      let text: string | null = null;
      if (overrideRaw != null) {
        try {
          text = assertSendSmsText(overrideRaw);
        } catch (error) {
          failed.push({
            orderId: order.id,
            code: order.code,
            error: error instanceof AppError ? error.message : 'Мессеж буруу.',
          });
          continue;
        }
      } else {
        const filled =
          kind === 'arrived_unpaid'
            ? arrivedUnpaidReminderText(order.customer.name, order.dueAmount, template)
            : scheduleReminderText(
                kind,
                order.customer.name,
                buildLeasingPayPlan({ ...order, payGaps: gaps }),
                template,
              );
        text = filled ? stripSmsUrls(filled) : null;
      }
      if (!text) {
        skipped.push(order.id);
        continue;
      }
      if (!order.customer.phone) {
        skipped.push(order.id);
        continue;
      }
      const { send } = await dispatchSms({
        channel: 'leasing',
        purpose: 'leasing_schedule',
        phone: order.customer.phone,
        text,
        relatedType: 'order',
        relatedId: order.id,
      });
      if (!send.accepted) {
        failed.push({ orderId: order.id, code: order.code, error: send.error ?? 'SMS илгээгдсэнгүй.' });
        continue;
      }
      sent.push(order.id);
      if (send.status === 'delivered') delivered += 1;
      else if (send.status === 'unknown') unknown += 1;
      else pending += 1;
    }

    await audit({
      actor: actorOf(req),
      action: 'LEASING_SCHEDULE_SMS',
      entity: 'Order',
      entityId: kind,
      after: { kind, requested: ids.length, sent: sent.length, skipped: skipped.length, failed: failed.length, pending, delivered, unknown },
    });

    res.json({ data: { sent: sent.length, skipped: skipped.length, pending, delivered, failed, unknown } });
  }),
);

/**
 * GET /orders/:id/sms — явуулах сануулгын урьдчилсан харагдац.
 */
leasingOrdersRouter.get(
  '/:id/sms',
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const preview = await payReminderPreview(param(req, 'id'), req.auth!);
    res.json({
      data: {
        text: preview.text,
        phone: preview.order.customer.phone,
        name: preview.order.customer.name,
        amount: preview.amount,
      },
    });
  }),
);

/**
 * POST /orders/:id/sms — төлбөрийн сануулга. Автомат биш.
 */
leasingOrdersRouter.post(
  '/:id/sms',
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({
      kind: z.enum(['pay_reminder']).default('pay_reminder'),
      text: z.string().min(1).max(400).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { kind?: 'pay_reminder'; text?: string };
    const preview = await payReminderPreview(param(req, 'id'), req.auth!);
    const text = body.text != null ? assertSendSmsText(body.text) : preview.text;
    const { send } = await dispatchSms({
      channel: 'leasing',
      purpose: 'leasing_pay',
      phone: preview.order.customer.phone!,
      text,
      relatedType: 'order',
      relatedId: preview.order.id,
    });
    if (!send.accepted) throw badRequest(send.error ?? 'SMS илгээгдсэнгүй.');

    await audit({
      actor: actorOf(req),
      action: 'LEASING_PAY_SMS',
      entity: 'Order',
      entityId: preview.order.id,
      after: {
        kind: 'pay_reminder',
        amount: preview.amount,
        customized: body.text != null,
        smsId: send.id ?? null,
        smsStatus: send.status,
      },
    });

    res.json({
      data: {
        ok: true,
        amount: preview.amount,
        smsStatus: send.status,
      },
    });
  }),
);

const transferBody = z.object({
  reason: z.string().trim().min(3).max(300),
  lines: z
    .array(
      z.object({
        orderItemId: z.string().min(1),
        qty: z.coerce.number().int().min(1).max(1000),
        resaleUnitPrice: z.coerce.number().int().min(0).max(100_000_000),
      }),
    )
    .min(1)
    .max(50),
});

leasingOrdersRouter.get(
  '/:id/ready-transfer',
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const orderId = param(req, 'id');
    await assertLeasingOrderAccess(orderId, req.auth!);
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { round: { select: { ownerKind: true, ownerAdminId: true } } } },
        payments: { select: { kind: true, payeeKind: true, amount: true } },
        readyTransfers: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!order) throw notFound('Захиалга олдсонгүй.');
    const scoped = overlayLeasingMoney(req.auth!, order);
    const visibleItems = filterLeasingDetailItems(
      req.auth!,
      scoped.mixedOwnership,
      order.items,
      order.items,
    );
    res.json({
      data: {
        isLeasing: order.isLeasing,
        mixedOwnership: scoped.mixedOwnership,
        attributedMoney: scoped.attributedMoney,
        netPaid: scoped.paidAmount - scoped.refundedAmount,
        dueAmount: scoped.dueAmount,
        unallocatedPaid: scoped.unallocatedPaid,
        unallocatedRefunded: scoped.unallocatedRefunded,
        writtenOffAmount: order.writtenOffAmount,
        debtClosedAt: order.debtClosedAt?.toISOString() ?? null,
        items: visibleItems.map((item) => {
          const avail = transferAvailability(item);
          return {
            id: item.id,
            name: item.nameSnapshot,
            qty: item.qty,
            availableQty: avail.availableQty,
            eligible: avail.ok,
            reason: avail.reason ?? null,
            unitPrice: item.unitPrice,
            selections: selectionsOf(item.selections),
            cancelled: item.cancelledAt !== null,
            handedOver: item.handedOverAt !== null,
            transferred: item.transferredAt !== null,
          };
        }),
        transfers: order.readyTransfers.map((row) => ({
          id: row.id,
          reason: row.reason,
          paidKeptAmount: row.paidKeptAmount,
          dueClosedAmount: row.dueClosedAmount,
          wroteOffDebt: row.wroteOffDebt,
          remainingActiveQty: row.remainingActiveQty,
          createdAt: row.createdAt.toISOString(),
        })),
      },
    });
  }),
);

leasingOrdersRouter.post(
  '/:id/ready-transfer/preview',
  validate({ params: z.object({ id: z.string().min(1) }), body: transferBody }),
  asyncHandler(async (req, res) => {
    const orderId = param(req, 'id');
    await assertLeasingOrderMutation(orderId, req.auth!);
    const body = req.body as z.infer<typeof transferBody>;
    const preview = await loadTransferPreview(orderId, body.lines);
    res.json({ data: { ...serializeTransferPreview(preview), reason: body.reason } });
  }),
);

leasingOrdersRouter.post(
  '/:id/ready-transfer',
  validate({ params: z.object({ id: z.string().min(1) }), body: transferBody }),
  asyncHandler(async (req, res) => {
    const orderId = param(req, 'id');
    await assertLeasingOrderMutation(orderId, req.auth!);
    const body = req.body as z.infer<typeof transferBody>;
    const ownerAdminId = await resolveReadyTransferOwner(orderId);
    const result = await executeReadyTransfer({
      orderId,
      ownerAdminId,
      reason: body.reason,
      lines: body.lines,
      actor: actorOf(req),
    });
    res.status(201).json({
      data: {
        transferId: result.transferId,
        destRoundIds: result.destRoundIds,
        preview: serializeTransferPreview(result.preview),
        order: await scopedLeasingOrderResponse(req.auth!, orderId),
      },
    });
  }),
);
