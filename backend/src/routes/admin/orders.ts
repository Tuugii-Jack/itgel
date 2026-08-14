import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { normalizePhone, PHONE_RE } from '../../lib/code.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { profitOf } from '../../lib/money.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, param, query, validate } from '../../middleware/validate.js';
import { createOrder } from '../../services/createOrder.js';
import { adminPaymentsRouter } from './payments.js';
import {
  computeTotals,
  fullyPaid,
  loadOrderTotals,
  PAYMENT_STATE_LABEL,
  paymentState,
} from '../../services/money.js';
import { buildTimeline, changeOrderStatus, revertOrderStatus } from '../../services/orders.js';
import {
  adminOrderItem,
  batchSummary,
  orderStatusLabel,
  publicDelivery,
} from '../../services/serialize.js';
import { syncOrderStorageFee } from '../../services/storageFee.js';

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
  /** Хэрэглэгч "шилжүүлсэн" гэж мэдэгдсэн, гэвч мөнгө нь ороогүй захиалгууд. */
  claimed: z.coerce.boolean().optional(),
  /** Soft-deleted («Устсан») захиалгууд — 10 хоног хадгална. */
  deleted: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

adminOrdersRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof listQuery>>(req);

    const where: Prisma.OrderWhereInput = {
      deletedAt: q.deleted ? { not: null } : null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.batch ? { batchId: q.batch } : {}),
      ...(q.fulfilment ? { fulfilment: q.fulfilment } : {}),
      ...(q.claimed ? { paymentClaimedAt: { not: null }, dueAmount: { gt: 0 } } : {}),
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

    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: q.deleted ? { deletedAt: 'desc' } : { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          customer: { select: { id: true, name: true, phone: true, email: true } },
          items: {
            select: { qty: true, unitPrice: true, costPriceSnapshot: true, cancelledAt: true },
          },
          batch: true,
        },
      }),
    ]);

    // Агуулахын хураамж — жагсаалт дээр sync хийхгүй (N+1 удаашрал).
    // Cron + захиалга/хүлээлгэн өгөх нээхэд шинэчлэгдэнэ.

    const RETENTION_MS = 10 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    res.json({
      data: orders.map((order) => {
        const purgeAt = order.deletedAt
          ? new Date(order.deletedAt.getTime() + RETENTION_MS)
          : null;
        const daysLeft = purgeAt
          ? Math.max(0, Math.ceil((purgeAt.getTime() - now) / (24 * 60 * 60 * 1000)))
          : null;
        return {
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
          paymentClaimedAt: order.paymentClaimedAt?.toISOString() ?? null,
          profit: profitOf(order.items.filter((i) => i.cancelledAt === null)),
          fulfilment: order.fulfilment,
          batch: batchSummary(order.batch),
          createdAt: order.createdAt.toISOString(),
          deletedAt: order.deletedAt?.toISOString() ?? null,
          purgeAt: purgeAt?.toISOString() ?? null,
          daysLeft,
        };
      }),
      meta: { total, page: q.page, pageSize: q.pageSize, pages: Math.ceil(total / q.pageSize) },
    });
  }),
);

const exportQuery = z.object({
  status: orderStatus.optional(),
  q: z.string().trim().min(1).max(60).optional(),
  batch: z.string().min(1).optional(),
  fulfilment: z.enum(['PICKUP', 'DELIVERY']).optional(),
  claimed: z.coerce.boolean().optional(),
  deleted: z.coerce.boolean().optional(),
  /** Сонгосон захиалгын id — таслалаар (шүүлтээс илүү чухал). */
  ids: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(500),
});

/**
 * GET /orders/export — Excel/хэвлэхэд зориулсан дэлгэрэнгүй жагсаалт
 * (мөр бүрийн selections, хэмжээ, өнгө гэх мэт).
 * `/:id`-ээс өмнө бүртгэнэ.
 */
adminOrdersRouter.get(
  '/export',
  validate({ query: exportQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof exportQuery>>(req);
    const ids = q.ids
      ? [...new Set(q.ids.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 500)
      : null;

    const where: Prisma.OrderWhereInput = ids
      ? { id: { in: ids } }
      : {
          deletedAt: q.deleted ? { not: null } : null,
          ...(q.status ? { status: q.status } : {}),
          ...(q.batch ? { batchId: q.batch } : {}),
          ...(q.fulfilment ? { fulfilment: q.fulfilment } : {}),
          ...(q.claimed ? { paymentClaimedAt: { not: null }, dueAmount: { gt: 0 } } : {}),
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

    const orders = await prisma.order.findMany({
      where,
      orderBy: q.deleted && !ids ? { deletedAt: 'desc' } : { createdAt: 'desc' },
      take: q.limit,
      include: {
        customer: true,
        items: { include: { product: true } },
        batch: true,
        delivery: true,
      },
    });

    const byId = new Map(orders.map((o) => [o.id, o]));
    const sorted = ids
      ? ids.map((id) => byId.get(id)).filter((o): o is (typeof orders)[number] => Boolean(o))
      : orders;

    res.json({
      data: sorted.map((order) => adminOrderDetail(order)),
      meta: { total: sorted.length, limit: q.limit },
    });
  }),
);

const emailSchema = z
  .string()
  .trim()
  .email('И-мэйл буруу байна.')
  .max(120)
  .transform((v) => v.toLowerCase());

const phoneSchema = z
  .string()
  .trim()
  .transform(normalizePhone)
  .refine((v) => PHONE_RE.test(v), 'Утасны дугаар буруу байна (8 орон).');

const createOrderBody = z
  .object({
    customerId: z.string().min(1).optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    name: z.string().trim().min(1).max(80).optional(),
    note: z.string().trim().max(500).optional(),
    status: z.enum(['NEW', 'CONFIRMED']).default('CONFIRMED'),
    markPaid: z.boolean().default(true),
    items: z
      .array(
        z.object({
          productId: z.string().min(1),
          qty: z.coerce.number().int().min(1).max(50),
          selections: z
            .record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(40))
            .optional(),
          size: z.string().trim().max(40).optional(),
          color: z.string().trim().max(40).optional(),
        }),
      )
      .min(1)
      .max(30),
  })
  .superRefine((body, ctx) => {
    if (!body.customerId && !body.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Хэрэглэгч эсвэл и-мэйл оруулна уу.',
        path: ['email'],
      });
    }
  });

/** POST /orders — админ гараар захиалга оруулах. */
adminOrdersRouter.post(
  '/',
  validate({ body: createOrderBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createOrderBody>;
    const actor = actorOf(req);

    let customerId = body.customerId ?? null;

    if (!customerId) {
      const email = body.email!;
      const existing = await prisma.customer.findUnique({ where: { email } });
      if (existing) {
        customerId = existing.id;
        const patch: { phone?: string; name?: string | null; emailVerifiedAt?: Date } = {};
        if (body.phone && existing.phone !== body.phone) {
          const phoneTaken = await prisma.customer.findFirst({
            where: { phone: body.phone, NOT: { id: existing.id } },
          });
          if (phoneTaken) throw conflict('Энэ утас өөр бүртгэлтэй холбогдсон.');
          patch.phone = body.phone;
        }
        if (body.name && body.name !== existing.name) patch.name = body.name;
        if (!existing.emailVerifiedAt) patch.emailVerifiedAt = new Date();
        if (Object.keys(patch).length > 0) {
          await prisma.customer.update({ where: { id: existing.id }, data: patch });
        }
      } else {
        if (body.phone) {
          const phoneTaken = await prisma.customer.findFirst({ where: { phone: body.phone } });
          if (phoneTaken) throw conflict('Энэ утас өөр бүртгэлтэй холбогдсон.');
        }
        const created = await prisma.customer.create({
          data: {
            email,
            phone: body.phone ?? null,
            name: body.name ?? null,
            emailVerifiedAt: new Date(),
          },
        });
        customerId = created.id;
      }
    }

    const order = await createOrder({
      customerId,
      items: body.items,
      note: body.note,
      actor,
      allowClosed: true,
      status: body.status,
      markPaid: body.status === 'CONFIRMED' ? body.markPaid : false,
      customerName: body.name,
    });

    const full = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        customer: true,
        items: { include: { product: true } },
        batch: true,
        delivery: true,
      },
    });

    res.status(201).json({ data: adminOrderDetail(full) });
  }),
);

adminOrdersRouter.get(
  '/:id',
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const orderId = param(req, 'id');
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
 * POST /orders/:id/status/revert — төлвийг нэг алхам буцаана
 * (санамсаргүй урагшлуулсан эсвэл цуцалсныг сэргээх).
 */
adminOrdersRouter.post(
  '/:id/status/revert',
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z
      .object({
        reason: z.string().trim().max(300).optional(),
      })
      .optional(),
  }),
  asyncHandler(async (req, res) => {
    const orderId = param(req, 'id');
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

    // Код, төлбөрийн дүнг НЭГ асуулгаар урьдчилж татна — захиалга бүрд
    // тусдаа асуулга хийвэл олон захиалгад мэдэгдэхүйц удаашрална.
    const orders = await prisma.order.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        code: true,
        subtotal: true,
        deliveryFee: true,
        paidAmount: true,
        refundedAmount: true,
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
            throw conflict(`Төлбөр дутуу: ${totals.subtotal - totals.netPaid}₮ ороогүй байна.`);
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
      email: order.customer.email,
    },
    items: order.items.map(adminOrderItem),
    subtotal: order.subtotal,
    deliveryFee: totals.deliveryFee,
    storageFee: order.storageFee,
    cargoFee: order.cargoFee,
    cargoPayMethod: order.cargoPayMethod,
    paidAmount: order.paidAmount,
    refundedAmount: order.refundedAmount,
    dueAmount: order.dueAmount,
    total: totals.total,
    netPaid: totals.netPaid,
    paymentState: state,
    paymentStateLabel: PAYMENT_STATE_LABEL[state],
    paymentClaimedAt: order.paymentClaimedAt?.toISOString() ?? null,
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
