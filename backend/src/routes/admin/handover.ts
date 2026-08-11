import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { conflict, notFound } from '../../lib/errors.js';
import { ORDER_STATUS_LABEL } from '../../lib/orderStatus.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, param, query, validate } from '../../middleware/validate.js';
import { handOverItems } from '../../services/orders.js';
import { recordPayment } from '../../services/payments.js';
import { adminOrderItem, publicOrderItem } from '../../services/serialize.js';
import { syncOrderStorageFee, syncOrdersStorageFees } from '../../services/storageFee.js';
import { adminOrderDetail } from './orders.js';

export const adminHandoverRouter = Router();

const lookupQuery = z.object({ code: z.string().trim().min(3).max(20) });

const customerQuery = z.object({
  q: z.string().trim().min(2).max(120),
});

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

    await syncOrderStorageFee(order.id);
    // Зөвхөн мөнгөний багана шинэчлэгдсэн байж болно — бүтэн include дахин татахгүй.
    const money = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: {
        storageFee: true,
        dueAmount: true,
        paidAmount: true,
        refundedAmount: true,
        subtotal: true,
      },
    });
    const fresh = { ...order, ...money };

    const pickable = fresh.items.filter(
      (i) => !i.cancelledAt && i.arrivedAt && !i.handedOverAt,
    );

    res.json({
      data: {
        ...adminOrderDetail(fresh),
        canHandOver: pickable.length > 0 && fresh.status !== 'CANCELLED',
        blockReason:
          fresh.status === 'CANCELLED'
            ? 'Захиалга цуцлагдсан.'
            : fresh.status === 'HANDED_OVER'
              ? 'Энэ захиалгыг аль хэдийн хүлээлгэн өгсөн байна.'
              : pickable.length === 0
                ? 'Авах боломжтой (ирсэн) бараа алга.'
                : null,
        pickableItemIds: pickable.map((i) => i.id),
      },
    });
  }),
);

/**
 * GET /handover/customer?q= — утас / нэр / и-мэйлээр хэрэглэгч + бүх мөр.
 */
adminHandoverRouter.get(
  '/customer',
  validate({ query: customerQuery }),
  asyncHandler(async (req, res) => {
    const { q } = query<z.infer<typeof customerQuery>>(req);
    const needle = q.trim();
    const emailNeedle = needle.toLowerCase();

    const customers = await prisma.customer.findMany({
      where: {
        OR: [
          { phone: { contains: needle } },
          { name: { contains: needle, mode: 'insensitive' } },
          { email: { contains: emailNeedle, mode: 'insensitive' } },
        ],
      },
      take: 10,
      orderBy: { updatedAt: 'desc' },
      include: {
        orders: {
          where: { deletedAt: null, status: { not: 'CANCELLED' } },
          orderBy: { createdAt: 'desc' },
          include: {
            items: { include: { product: true } },
          },
        },
      },
    });

    if (customers.length === 0) throw notFound('Хэрэглэгч олдсонгүй.');

    const orderIds = [
      ...new Set(customers.flatMap((c) => c.orders.map((o) => o.id))),
    ];
    await syncOrdersStorageFees(orderIds);

    const refreshed = await prisma.customer.findMany({
      where: { id: { in: customers.map((c) => c.id) } },
      include: {
        orders: {
          where: {
            deletedAt: null,
            status: { notIn: ['CANCELLED'] },
          },
          orderBy: { createdAt: 'desc' },
          include: {
            items: { include: { product: true } },
          },
        },
      },
    });

    res.json({
      data: refreshed.map((customer) => {
        const orderDues = customer.orders.map((order) => ({
          orderId: order.id,
          code: order.code,
          status: order.status,
          statusLabel: ORDER_STATUS_LABEL[order.status],
          subtotal: order.subtotal,
          deliveryFee: order.deliveryFee,
          storageFee: order.storageFee,
          paidAmount: order.paidAmount,
          dueAmount: order.dueAmount,
        }));

        const lines = customer.orders.flatMap((order) =>
          order.items.map((item) => {
            const pub = publicOrderItem(item);
            return {
              ...adminOrderItem(item),
              orderId: order.id,
              orderCode: order.code,
              orderStatus: order.status,
              orderStatusLabel: ORDER_STATUS_LABEL[order.status],
              dueAmount: order.dueAmount,
              storageFee: order.storageFee,
              deliveryFee: order.deliveryFee,
              paidAmount: order.paidAmount,
              subtotal: order.subtotal,
              canPick: pub.itemStatus === 'arrived',
            };
          }),
        );

        const active = lines.filter((l) => !l.cancelled);
        const waiting = active.filter((l) => l.itemStatus === 'waiting').length;
        const arrived = active.filter((l) => l.itemStatus === 'arrived').length;
        const handedOver = active.filter((l) => l.itemStatus === 'handed_over').length;
        const dueAmount = orderDues.reduce((sum, o) => sum + Math.max(0, o.dueAmount), 0);

        return {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          totals: {
            items: active.length,
            waiting,
            arrived,
            handedOver,
            dueAmount,
          },
          orders: orderDues,
          items: lines,
        };
      }),
    });
  }),
);

/**
 * POST /handover/partial — сонгосон мөрүүдийг хүлээлгэн өгнө.
 * dueAmount > 0 захиалгад collectedAmount бүрэн байх ёстой.
 */
adminHandoverRouter.post(
  '/partial',
  validate({
    body: z.object({
      itemIds: z.array(z.string().min(1)).min(1).max(200),
      collectedAmount: z.coerce.number().int().min(0).optional(),
      note: z.string().trim().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      itemIds: string[];
      collectedAmount?: number;
      note?: string;
    };
    const actor = actorOf(req);

    const items = await prisma.orderItem.findMany({
      where: { id: { in: body.itemIds } },
      include: { order: true },
    });
    if (items.length !== body.itemIds.length) throw conflict('Зарим бараа олдсонгүй.');

    const uniqueOrderIds = [...new Set(items.map((i) => i.orderId))];
    await syncOrdersStorageFees(uniqueOrderIds);

    const dueByOrder = new Map<string, number>();
    for (const orderId of uniqueOrderIds) {
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { dueAmount: true },
      });
      dueByOrder.set(orderId, order.dueAmount);
    }
    const totalDue = [...dueByOrder.values()].reduce((a, b) => a + b, 0);
    if (totalDue > 0) {
      const collected = body.collectedAmount ?? 0;
      if (collected < totalDue) {
        throw conflict(`Үлдэгдэл ${totalDue}₮ бүрэн төлөгдөөгүй байна.`, {
          dueAmount: totalDue,
          collected,
        });
      }
    }

    const result = await handOverItems({
      itemIds: body.itemIds,
      actor,
      note: body.note,
    });

    // Төлбөр — захиалга бүрд due-г нэг удаа.
    if (totalDue > 0) {
      for (const [orderId, due] of dueByOrder) {
        if (due <= 0) continue;
        await recordPayment({
          orderId,
          kind: 'PAYMENT',
          amount: due,
          method: 'CASH',
          note: body.note ?? 'Хүлээлгэн өгөх үед авсан',
          actor,
        });
      }
    }

    await audit({
      actor,
      action: 'HANDOVER_PARTIAL',
      entity: 'OrderItem',
      entityId: body.itemIds[0]!,
      after: {
        itemIds: body.itemIds,
        orderIds: result.orderIds,
        completedOrderIds: result.completedOrderIds,
        note: body.note,
      },
    });

    res.json({
      data: {
        itemCount: result.itemCount,
        orderIds: result.orderIds,
        completedOrderIds: result.completedOrderIds,
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
    const orderId = param(req, 'orderId');

    await syncOrderStorageFee(orderId);

    const order = await prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: { delivery: true, items: true },
    });
    if (!order) throw notFound('Захиалга олдсонгүй.');

    const pickable = order.items.filter(
      (i) => !i.cancelledAt && i.arrivedAt && !i.handedOverAt,
    );
    if (pickable.length === 0) {
      throw conflict('Авах боломжтой (ирсэн) бараа алга.');
    }

    const collected = collectedAmount ?? order.dueAmount;
    if (collected < order.dueAmount) {
      throw conflict(`Үлдэгдэл ${order.dueAmount}₮ бүрэн төлөгдөөгүй байна.`, {
        dueAmount: order.dueAmount,
        collected,
      });
    }

    const actor = actorOf(req);

    // Бүх ирсэн мөрийг өгнө; үлдсэн хүлээж буй мөр байвал захиалга ARRIVED үлдэнэ.
    await handOverItems({
      itemIds: pickable.map((i) => i.id),
      actor,
      note,
    });

    // Хэрэв бүх мөр авсан бол handOverItems аль хэдийн HANDED_OVER болгосон.
    // Хэрэв зөвхөн ирсэнүүдийг өгсөн ч захиалга бүрэн дуусаагүй бол OK.

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

    // Хуучин урсгал: бүх мөр ирсэн байвал бүтнээр HANDED_OVER — handOverItems хийнэ.
    // Хэрэв order бүрэн өгөгдөөгүй ч админ «бүгдийг» дарсан бол хүлээж буй мөр үлдэнэ.

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
