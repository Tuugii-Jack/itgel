import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { conflict, notFound } from '../../lib/errors.js';
import { ORDER_STATUS_LABEL } from '../../lib/orderStatus.js';
import { itemPickableAtStore } from '../../lib/itemFulfilment.js';
import { leasingFeeHold, leasingHoldsGoods, leasingView } from '../../lib/leasing.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, param, query, validate } from '../../middleware/validate.js';
import { handOverItems } from '../../services/orders.js';
import { recordPayment } from '../../services/payments.js';
import { shopDueAmount } from '../../services/money.js';
import { HANDOVER_PAY_NOTE, handoverHistory } from '../../services/handoverHistory.js';
import { adminOrderItem, publicOrderItem } from '../../services/serialize.js';
import { syncOrderCargoFee, syncOrdersCargoFees } from '../../services/cargoFee.js';
import { syncOrderStorageFee, syncOrdersStorageFees } from '../../services/storageFee.js';
import { adminOrderDetail } from './orders.js';
import { currentLeasingPayGaps } from '../../services/settings.js';

export const adminHandoverRouter = Router();

const lookupQuery = z.object({ code: z.string().trim().min(3).max(20) });

const customerQuery = z.object({
  q: z.string().trim().min(2).max(120),
});

const payMethod = z.enum(['CASH', 'CARD', 'BANK_TRANSFER']);

/** GET /handover/history?year=&month= — өгсөн бараа, бэлэн/карт. */
adminHandoverRouter.get(
  '/history',
  validate({
    query: z.object({
      year: z.coerce.number().int().min(2000).max(2100),
      month: z.coerce.number().int().min(1).max(12),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ year: number; month: number }>(req);
    res.json({ data: await handoverHistory(q.year, q.month) });
  }),
);

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
    if (leasingFeeHold(order)) {
      throw conflict('Лизингийн шимтгэл төлөгдөөгүй. Захиалга хараахан үүсээгүй.');
    }

    await syncOrderStorageFee(order.id);
    await syncOrderCargoFee(prisma, order.id);
    // Зөвхөн мөнгөний багана шинэчлэгдсэн байж болно — бүтэн include дахин татахгүй.
    const money = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: {
        storageFee: true,
        cargoFee: true,
        dueAmount: true,
        paidAmount: true,
        refundedAmount: true,
        subtotal: true,
        isLeasing: true,
        leasingFee: true,
      },
    });
    const fresh = { ...order, ...money };

    const pickable = fresh.items.filter(itemPickableAtStore);
    const deliveryHeld = fresh.items.filter(
      (i) => !i.cancelledAt && i.arrivedAt && !i.handedOverAt && i.fulfilment === 'DELIVERY',
    );
    const leasingHeld = leasingHoldsGoods(fresh);
    const gaps = await currentLeasingPayGaps();

    res.json({
      data: {
        ...adminOrderDetail(fresh, gaps),
        canHandOver:
          pickable.length > 0 && fresh.status !== 'CANCELLED' && !leasingHeld,
        blockReason:
          fresh.status === 'CANCELLED'
            ? 'Захиалга цуцлагдсан.'
            : fresh.status === 'HANDED_OVER'
              ? 'Энэ захиалгыг аль хэдийн хүлээлгэн өгсөн байна.'
              : leasingHeld
                ? 'Лизингийн үндсэн төлбөр дутуу. Лизингийн дансанд төлнө, дэлгүүрийн кассанд бүү ав.'
                : pickable.length === 0
                  ? deliveryHeld.length > 0
                    ? 'Эдгээр бараа хүргэлтээр авахаар сонгогдсон.'
                    : 'Авах боломжтой (ирсэн) бараа алга.'
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
          where: { deletedAt: null, status: { not: 'CANCELLED' }, isLeasing: false },
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
    await syncOrdersCargoFees(orderIds);

    const refreshed = await prisma.customer.findMany({
      where: { id: { in: customers.map((c) => c.id) } },
      include: {
        orders: {
          where: {
            deletedAt: null,
            status: { notIn: ['CANCELLED'] },
            isLeasing: false,
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
        const orderDues = customer.orders.map((order) => {
          const view = leasingView(order);
          return {
            orderId: order.id,
            code: order.code,
            status: order.status,
            statusLabel: ORDER_STATUS_LABEL[order.status],
            subtotal: order.subtotal,
            deliveryFee: order.deliveryFee,
            storageFee: order.storageFee,
            cargoFee: order.cargoFee,
            paidAmount: order.paidAmount,
            dueAmount: order.dueAmount,
            isLeasing: view.isLeasing,
            shopDueAmount: shopDueAmount(order),
            leasingDueAmount: view.feeDue + view.principalDue,
          };
        });

        const lines = customer.orders.flatMap((order) => {
          const view = leasingView(order);
          const shopDue = shopDueAmount(order);
          const leasingDue = view.feeDue + view.principalDue;
          const leasingHeld = leasingHoldsGoods(order);
          return order.items.map((item) => {
            const pub = publicOrderItem(item);
            return {
              ...adminOrderItem(item),
              orderId: order.id,
              orderCode: order.code,
              orderStatus: order.status,
              orderStatusLabel: ORDER_STATUS_LABEL[order.status],
              dueAmount: order.dueAmount,
              shopDueAmount: shopDue,
              leasingDueAmount: leasingDue,
              isLeasing: view.isLeasing,
              storageFee: order.storageFee,
              deliveryFee: order.deliveryFee,
              paidAmount: order.paidAmount,
              subtotal: order.subtotal,
              canPick:
                pub.itemStatus === 'arrived' &&
                pub.fulfilment !== 'DELIVERY' &&
                !leasingHeld,
            };
          });
        });

        const active = lines.filter((l) => !l.cancelled);
        const waiting = active.filter((l) => l.itemStatus === 'waiting').length;
        const arrived = active.filter((l) => l.itemStatus === 'arrived').length;
        const handedOver = active.filter((l) => l.itemStatus === 'handed_over').length;
        const dueAmount = orderDues.reduce((sum, o) => sum + o.shopDueAmount, 0);
        const leasingDueAmount = orderDues.reduce((sum, o) => sum + o.leasingDueAmount, 0);

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
            shopDueAmount: dueAmount,
            leasingDueAmount,
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
 * Дэлгүүрийн үлдэгдэл (карго/агуулах) > 0 бол collectedAmount бүрэн байх ёстой.
 * Лизингийн үлдэгдлийг энд авч бүртгэхгүй.
 */
adminHandoverRouter.post(
  '/partial',
  validate({
    body: z.object({
      itemIds: z.array(z.string().min(1)).min(1).max(200),
      collectedAmount: z.coerce.number().int().min(0).optional(),
      method: payMethod.optional(),
      note: z.string().trim().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      itemIds: string[];
      collectedAmount?: number;
      method?: 'CASH' | 'CARD' | 'BANK_TRANSFER';
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
    await syncOrdersCargoFees(uniqueOrderIds);

    const dueByOrder = new Map<string, number>();
    for (const orderId of uniqueOrderIds) {
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: {
          isLeasing: true,
          subtotal: true,
          leasingFee: true,
          storageFee: true,
          cargoFee: true,
          paidAmount: true,
          refundedAmount: true,
        },
      });
      if (leasingHoldsGoods(order)) {
        throw conflict('Лизингийн үндсэн төлбөр дутуу. Лизингийн дансанд төлнө, дэлгүүрийн кассанд бүү ав.', {
          code: 'LEASING_BALANCE_DUE',
          orderId,
        });
      }
      dueByOrder.set(orderId, shopDueAmount(order));
    }
    const totalDue = [...dueByOrder.values()].reduce((a, b) => a + b, 0);
    if (totalDue > 0) {
      const collected = body.collectedAmount ?? 0;
      if (collected < totalDue) {
        throw conflict(`Дэлгүүрийн үлдэгдэл ${totalDue}₮ бүрэн төлөгдөөгүй байна.`, {
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
          method: body.method ?? 'CASH',
          note: body.note ?? HANDOVER_PAY_NOTE,
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
        method: body.method ?? null,
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
        method: payMethod.optional(),
        note: z.string().trim().max(300).optional(),
      })
      .default({}),
  }),
  asyncHandler(async (req, res) => {
    const { collectedAmount, method, note } = req.body as {
      collectedAmount?: number;
      method?: 'CASH' | 'CARD' | 'BANK_TRANSFER';
      note?: string;
    };
    const orderId = param(req, 'orderId');

    await syncOrderStorageFee(orderId);
    await syncOrderCargoFee(prisma, orderId);

    const order = await prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: { delivery: true, items: true },
    });
    if (!order) throw notFound('Захиалга олдсонгүй.');

    const pickable = order.items.filter(itemPickableAtStore);
    if (pickable.length === 0) {
      throw conflict('Авах боломжтой (ирсэн) бараа алга.');
    }

    if (leasingHoldsGoods(order)) {
      throw conflict('Лизингийн үндсэн төлбөр дутуу. Лизингийн дансанд төлнө, дэлгүүрийн кассанд бүү ав.', {
        code: 'LEASING_BALANCE_DUE',
      });
    }

    const shopDue = shopDueAmount(order);
    const collected = collectedAmount ?? shopDue;
    if (shopDue > 0 && collected < shopDue) {
      throw conflict(`Дэлгүүрийн үлдэгдэл ${shopDue}₮ бүрэн төлөгдөөгүй байна.`, {
        dueAmount: shopDue,
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

    if (shopDue > 0) {
      await recordPayment({
        orderId: order.id,
        kind: 'PAYMENT',
        amount: shopDue,
        method: method ?? 'CASH',
        note: note ?? HANDOVER_PAY_NOTE,
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

    res.json({ data: adminOrderDetail(updated, await currentLeasingPayGaps()) });
  }),
);
