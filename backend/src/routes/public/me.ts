import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { notFound } from '../../lib/errors.js';
import { toIso } from '../../lib/date.js';
import { requireCustomer } from '../../middleware/auth.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import { computeTotals, paymentState } from '../../services/money.js';
import { buildTimeline } from '../../services/orders.js';
import { orderStatusLabel, publicDelivery, publicOrderItem } from '../../services/serialize.js';

export const publicMeRouter = Router();

// Бүх зам хэрэглэгчийн JWT шаардана.
publicMeRouter.use(requireCustomer);

function serializeCustomer(c: {
  id: string;
  phone: string;
  name: string | null;
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
    phone: c.phone,
    name: c.name,
    address: { district: c.district, khoroo: c.khoroo, addressText: c.addressText },
    notifications: {
      payment: c.notifyPayment,
      arrival: c.notifyArrival,
      promo: c.notifyPromo,
    },
    createdAt: c.createdAt.toISOString(),
  };
}

/** GET /api/me — профайлын мэдээлэл. */
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
  district: z.string().trim().max(60).nullable().optional(),
  khoroo: z.string().trim().max(30).nullable().optional(),
  addressText: z.string().trim().max(300).nullable().optional(),
  notifyPayment: z.boolean().optional(),
  notifyArrival: z.boolean().optional(),
  notifyPromo: z.boolean().optional(),
});

/** PATCH /api/me — нэр, хадгалсан хаяг, мэдэгдлийн тохиргоо. */
publicMeRouter.patch(
  '/',
  validate({ body: patchBody }),
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.update({
      where: { id: req.auth!.sub },
      data: req.body as z.infer<typeof patchBody>,
    });
    res.json({ data: serializeCustomer(customer) });
  }),
);

const ordersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

/** GET /api/me/orders — өөрийн захиалгын түүх, явцтай. */
publicMeRouter.get(
  '/orders',
  validate({ query: ordersQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof ordersQuery>>(req);
    const where = { customerId: req.auth!.sub, deletedAt: null };

    // Нийлбэрүүд бүх захиалгаас — зөвхөн энэ хуудаснаас биш.
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
        // Төлбөрийн таб — цуцлагдаагүй захиалгын төлсөн дүнгийн нийлбэр.
        totalSpent: (spent._sum.paidAmount ?? 0) - (spent._sum.refundedAmount ?? 0),
        activeCount,
      },
    });
  }),
);
