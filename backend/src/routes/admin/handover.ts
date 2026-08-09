import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { conflict, notFound } from '../../lib/errors.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import { changeOrderStatus } from '../../services/orders.js';
import { recordPayment } from '../../services/payments.js';
import { adminOrderDetail } from './orders.js';

export const adminHandoverRouter = Router();

const lookupQuery = z.object({ code: z.string().trim().min(3).max(20) });

/** GET /handover/lookup?code= — QR эсвэл кодоор хайна. */
adminHandoverRouter.get(
  '/lookup',
  validate({ query: lookupQuery }),
  asyncHandler(async (req, res) => {
    const { code } = query<z.infer<typeof lookupQuery>>(req);

    const order = await prisma.order.findFirst({
      where: { code: code.toUpperCase(), deletedAt: null },
      include: {
        customer: true,
        items: { include: { product: true } },
        batch: true,
        delivery: true,
      },
    });
    if (!order) throw notFound('Ийм кодтой захиалга олдсонгүй.');

    res.json({
      data: {
        ...adminOrderDetail(order),
        canHandOver: order.status === 'ARRIVED',
        blockReason:
          order.status === 'ARRIVED'
            ? null
            : order.status === 'HANDED_OVER'
              ? 'Энэ захиалгыг аль хэдийн хүлээлгэн өгсөн байна.'
              : 'Бараа агуулахад ирээгүй байна.',
      },
    });
  }),
);

/** POST /handover/:orderId/complete — үлдэгдэл төлбөр авч хүлээлгэн өгнө. */
adminHandoverRouter.post(
  '/:orderId/complete',
  validate({
    params: z.object({ orderId: z.string().min(1) }),
    body: z
      .object({
        collectedAmount: z.coerce.number().int().min(0).optional(),
        note: z.string().trim().max(300).optional(),
      })
      .default({}),
  }),
  asyncHandler(async (req, res) => {
    const { collectedAmount, note } = req.body as { collectedAmount?: number; note?: string };

    const order = await prisma.order.findFirst({
      where: { id: req.params.orderId, deletedAt: null },
      include: { delivery: true },
    });
    if (!order) throw notFound('Захиалга олдсонгүй.');
    if (order.status !== 'ARRIVED') {
      throw conflict('Зөвхөн агуулахад ирсэн захиалгыг хүлээлгэн өгнө.');
    }

    const collected = collectedAmount ?? order.dueAmount;
    if (collected < order.dueAmount) {
      throw conflict(`Үлдэгдэл ${order.dueAmount}₮ бүрэн төлөгдөөгүй байна.`, {
        dueAmount: order.dueAmount,
        collected,
      });
    }

    const actor = actorOf(req);
    await changeOrderStatus(order.id, 'HANDED_OVER', { actor, reason: note });

    // Хүлээн авсан мөнгө дэвтэрт бичигдэнэ — дүн эндээс бодогдоно.
    if (collected > 0) {
      await recordPayment({
        orderId: order.id,
        kind: 'PAYMENT',
        amount: collected,
        method: 'CASH',
        note: note ?? 'Хүлээлгэн өгөх үед авсан',
        actor,
      });
    }

    if (order.delivery) {
      await prisma.delivery.update({
        where: { id: order.delivery.id },
        data: { status: 'DELIVERED' },
      });
    }

    await audit({
      actor,
      action: 'HANDOVER',
      entity: 'Order',
      entityId: order.id,
      before: { dueAmount: order.dueAmount },
      after: { collected, note },
    });

    const updated = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        customer: true,
        items: { include: { product: true } },
        batch: true,
        delivery: true,
      },
    });

    res.json({ data: adminOrderDetail(updated) });
  }),
);
