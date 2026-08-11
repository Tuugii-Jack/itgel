import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { endOfUbDay, parseUbDay, startOfUbDay } from '../../lib/date.js';
import { notFound } from '../../lib/errors.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import { changeOrderStatus } from '../../services/orders.js';
import { recordPayment } from '../../services/payments.js';

export const adminDeliveriesRouter = Router();

const listQuery = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['PENDING', 'ASSIGNED', 'DELIVERED']).optional(),
  district: z.string().trim().min(1).max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
});

adminDeliveriesRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof listQuery>>(req);

    const where: Prisma.DeliveryWhereInput = {
      ...(q.day
        ? {
            scheduledDay: {
              gte: startOfUbDay(parseUbDay(q.day)),
              lte: endOfUbDay(parseUbDay(q.day)),
            },
          }
        : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.district ? { district: q.district } : {}),
    };

    // Хуудаслалт — шүүлтгүй үед бүх түүхийг нэг дор татахаас сэргийлнэ.
    const [total, deliveries] = await Promise.all([
      prisma.delivery.count({ where }),
      prisma.delivery.findMany({
        where,
        orderBy: [{ scheduledDay: 'asc' }, { district: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          order: {
            select: {
              id: true,
              code: true,
              status: true,
              dueAmount: true,
              customer: { select: { name: true, phone: true } },
            },
          },
        },
      }),
    ]);

    res.json({
      data: deliveries.map((d) => ({
        id: d.id,
        scheduledDay: d.scheduledDay.toISOString(),
        district: d.district,
        khoroo: d.khoroo,
        addressText: d.addressText,
        fee: d.fee,
        courierName: d.courierName,
        status: d.status,
        order: {
          id: d.order.id,
          code: d.order.code,
          status: d.order.status,
          dueAmount: d.order.dueAmount,
          customer: { name: d.order.customer.name, phone: d.order.customer.phone },
        },
      })),
      meta: { total, page: q.page, pageSize: q.pageSize, pages: Math.ceil(total / q.pageSize) },
    });
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
      khoroo: z.string().trim().max(30).nullable().optional(),
      addressText: z.string().trim().max(300).nullable().optional(),
      fee: z.coerce.number().int().min(0).max(1_000_000).optional(),
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
        fee: body.fee as number | undefined,
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
      // Жолооч гар дээрээс авсан үлдэгдлийг дэвтэрт бүртгэнэ.
      if (before.order.dueAmount > 0) {
        await recordPayment({
          orderId: before.orderId,
          kind: 'PAYMENT',
          amount: before.order.dueAmount,
          method: 'CASH',
          note: `Хүргэлтээр авсан${before.courierName ? ` — ${before.courierName}` : ''}`,
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
