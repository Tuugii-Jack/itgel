import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { endOfUbDay, parseUbDay, startOfUbDay } from '../../lib/date.js';
import { notFound } from '../../lib/errors.js';
import { selectionsOf } from '../../lib/options.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import { deliveryHistory } from '../../services/deliveryHistory.js';
import { changeOrderStatus } from '../../services/orders.js';
import { recordPayment } from '../../services/payments.js';

export const adminDeliveriesRouter = Router();

const deliveryInclude = {
  order: {
    select: {
      id: true,
      code: true,
      status: true,
      dueAmount: true,
      cargoFee: true,
      note: true,
      customer: { select: { name: true, phone: true } },
      items: {
        where: { cancelledAt: null },
        select: {
          nameSnapshot: true,
          qty: true,
          selections: true,
          size: true,
          color: true,
        },
      },
    },
  },
} as const;

type DeliveryWithOrder = Prisma.DeliveryGetPayload<{ include: typeof deliveryInclude }>;

function serializeDelivery(d: DeliveryWithOrder) {
  return {
    id: d.id,
    scheduledDay: d.scheduledDay.toISOString(),
    district: d.district,
    khoroo: d.khoroo,
    addressText: d.addressText,
    courierName: d.courierName,
    status: d.status,
    order: {
      id: d.order.id,
      code: d.order.code,
      status: d.order.status,
      dueAmount: d.order.dueAmount,
      cargoFee: d.order.cargoFee,
      note: d.order.note,
      customer: { name: d.order.customer.name, phone: d.order.customer.phone },
      items: d.order.items.map((item) => ({
        name: item.nameSnapshot,
        qty: item.qty,
        selections: selectionsOf(item.selections),
        size: item.size,
        color: item.color,
      })),
    },
  };
}

const listQuery = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  days: z.string().optional(),
  status: z.enum(['PENDING', 'ASSIGNED', 'DELIVERED']).optional(),
  district: z.string().trim().min(1).max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(200),
});

function parseDayList(q: { day?: string; days?: string }): string[] {
  const raw = q.days
    ? q.days.split(',')
    : q.day
      ? [q.day]
      : [];
  return [...new Set(raw.map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)))].slice(
    0,
    62,
  );
}

adminDeliveriesRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof listQuery>>(req);
    const dayList = parseDayList(q);

    const dayWhere: Prisma.DeliveryWhereInput | undefined =
      dayList.length === 0
        ? undefined
        : dayList.length === 1
          ? {
              scheduledDay: {
                gte: startOfUbDay(parseUbDay(dayList[0]!)),
                lte: endOfUbDay(parseUbDay(dayList[0]!)),
              },
            }
          : {
              OR: dayList.map((d) => ({
                scheduledDay: {
                  gte: startOfUbDay(parseUbDay(d)),
                  lte: endOfUbDay(parseUbDay(d)),
                },
              })),
            };

    const where: Prisma.DeliveryWhereInput = {
      ...dayWhere,
      ...(q.status ? { status: q.status } : {}),
      ...(q.district ? { district: q.district } : {}),
    };

    const [total, deliveries] = await Promise.all([
      prisma.delivery.count({ where }),
      prisma.delivery.findMany({
        where,
        orderBy: [{ scheduledDay: 'asc' }, { district: 'asc' }, { khoroo: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: deliveryInclude,
      }),
    ]);

    res.json({
      data: deliveries.map(serializeDelivery),
      meta: { total, page: q.page, pageSize: q.pageSize, pages: Math.ceil(total / q.pageSize) },
    });
  }),
);

/** GET /deliveries/history?year=&month= — өдрөөр хүргэлтийн түүх. */
adminDeliveriesRouter.get(
  '/history',
  validate({
    query: z.object({
      year: z.coerce.number().int().min(2000).max(2100),
      month: z.coerce.number().int().min(1).max(12),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ year: number; month: number }>(req);
    res.json({ data: await deliveryHistory(q.year, q.month) });
  }),
);

/** PATCH /deliveries/:id — жолооч, төлөв, хаяг. */
adminDeliveriesRouter.patch(
  '/:id',
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({
      courierName: z.string().trim().max(80).nullable().optional(),
      status: z.enum(['PENDING', 'ASSIGNED', 'DELIVERED']).optional(),
      scheduledDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      district: z.string().trim().min(1).max(60).optional(),
      khoroo: z.string().trim().max(60).nullable().optional(),
      addressText: z.string().trim().max(300).nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown> & { status?: 'PENDING' | 'ASSIGNED' | 'DELIVERED' };

    const before = await prisma.delivery.findUnique({
      where: { id: req.params.id },
      include: { order: true },
    });
    if (!before) throw notFound('Хүргэлт олдсонгүй.');

    const after = await prisma.delivery.update({
      where: { id: before.id },
      data: {
        courierName: body.courierName as string | null | undefined,
        status: body.status,
        district: body.district as string | undefined,
        khoroo: body.khoroo as string | null | undefined,
        addressText: body.addressText as string | null | undefined,
        ...(body.scheduledDay
          ? { scheduledDay: startOfUbDay(parseUbDay(body.scheduledDay as string)) }
          : {}),
      },
    });

    // Хүргэгдсэн гэж тэмдэглэвэл захиалга хүлээлгэн өгсөнд тооцогдоно.
    if (body.status === 'DELIVERED' && before.order.status === 'ARRIVED') {
      const actor = actorOf(req);
      await changeOrderStatus(before.orderId, 'HANDED_OVER', {
        actor,
        reason: 'Хүргэлтээр хүлээлгэн өгсөн',
      });
      // Үлдсэн карго/агуулахын төлбөрийг бэлнээр авсанд тооцно.
      if (before.order.dueAmount > 0) {
        await recordPayment({
          orderId: before.orderId,
          kind: 'PAYMENT',
          amount: before.order.dueAmount,
          method: 'CASH',
          note: `Хүргэлтээр авсан${after.courierName ? ` — ${after.courierName}` : before.courierName ? ` — ${before.courierName}` : ''}`,
          actor,
        });
      }
    }

    await audit({
      actor: actorOf(req),
      action: 'UPDATE',
      entity: 'Delivery',
      entityId: after.id,
      before,
      after,
    });

    res.json({ data: after });
  }),
);
