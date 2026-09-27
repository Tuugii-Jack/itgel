import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { conflict, notFound } from '../../lib/errors.js';
import { ORDER_STATUS_LABEL } from '../../lib/orderStatus.js';
import { parsePickupLookup } from '../../lib/pickupQr.js';
import { isLeasingResale } from '../../lib/inventoryOwner.js';
import { leasingFeeHold, leasingHoldsGoods, leasingView, SHOP_STAFF_ORDER_WHERE } from '../../lib/leasing.js';
import { itemPickableAtStore } from '../../lib/itemFulfilment.js';
import { handedQtyOf, pickableQtyOf } from '../../lib/itemQty.js';
import { readActorIdempotencyKey } from '../../lib/actorIdempotency.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, param, query, validate } from '../../middleware/validate.js';
import { handOverItems, HANDOVER_MONEY_SELECT } from '../../services/orders.js';
import { isProductPaid, shopDueAmount } from '../../services/money.js';
import { handoverHistory } from '../../services/handoverHistory.js';
import { adminOrderItem, publicOrderItem } from '../../services/serialize.js';
import { syncOrderCargoFee, syncOrdersCargoFees } from '../../services/cargoFee.js';
import { syncOrderStorageFee, syncOrdersStorageFees } from '../../services/storageFee.js';
import { adminOrderDetail } from '../../modules/orders/adminDetail.js';
import { currentLeasingPayGaps } from '../../services/settings.js';

export const adminHandoverRouter = Router();

const lookupQuery = z.object({ code: z.string().trim().min(3).max(80) });

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
    const { code: raw } = query<z.infer<typeof lookupQuery>>(req);
    const code = parsePickupLookup(raw) ?? raw.trim().toUpperCase();

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
      select: HANDOVER_MONEY_SELECT,
    });
    const fresh = { ...order, ...money };

    const pickable = fresh.items.filter(itemPickableAtStore);
    const deliveryHeld = fresh.items.filter(
      (i) => !i.cancelledAt && pickableQtyOf(i) > 0 && i.fulfilment === 'DELIVERY',
    );
    const leasingHeld = leasingHoldsGoods(fresh);
    const leasingUnpaid = isLeasingResale(fresh) && !isProductPaid(fresh);
    const gaps = await currentLeasingPayGaps();

    res.json({
      data: {
        ...adminOrderDetail(fresh, gaps),
        canHandOver:
          pickable.length > 0 && fresh.status !== 'CANCELLED' && !leasingHeld && !leasingUnpaid,
        blockReason:
          fresh.status === 'CANCELLED'
            ? 'Захиалга цуцлагдсан.'
            : fresh.status === 'HANDED_OVER'
              ? 'Энэ захиалгыг аль хэдийн хүлээлгэн өгсөн байна.'
              : leasingHeld
                ? 'Лизингийн үндсэн төлбөр дутуу. Лизингийн дансанд төлнө, дэлгүүрийн кассанд бүү ав.'
                : leasingUnpaid
                  ? 'Лизингийн бэлэн барааны төлбөр дутуу. Лизингийн QPay-ээр төлнө.'
                  : pickable.length === 0
                    ? deliveryHeld.length > 0
                      ? 'Эдгээр бараа хүргэлтээр авахаар сонгогдсон.'
                      : 'Авах боломжтой (ирсэн) бараа алга.'
                    : null,
        pickableItemIds: pickable.map((i) => i.id),
        pickableItems: pickable.map((i) => ({
          itemId: i.id,
          pickableQty: pickableQtyOf(i),
          expectedHandedQty: handedQtyOf(i),
        })),
        recipientProof: 'paper_signature',
        lookupOnly: true,
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
          where: { deletedAt: null, status: { not: 'CANCELLED' }, ...SHOP_STAFF_ORDER_WHERE },
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
            ...SHOP_STAFF_ORDER_WHERE,
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
                pickableQtyOf(item) > 0 &&
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
      items: z
        .array(
          z.object({
            itemId: z.string().min(1),
            qty: z.coerce.number().int().min(1).max(10_000),
            expectedHandedQty: z.coerce.number().int().min(0).max(10_000),
          }),
        )
        .min(1)
        .max(200),
      collectedAmount: z.coerce.number().int().min(0).optional(),
      method: payMethod.optional(),
      note: z.string().trim().max(300).optional(),
      idempotencyKey: z.string().trim().min(8).max(128).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      items: { itemId: string; qty: number; expectedHandedQty: number }[];
      collectedAmount?: number;
      method?: 'CASH' | 'CARD' | 'BANK_TRANSFER';
      note?: string;
      idempotencyKey?: string;
    };
    const actor = actorOf(req);
    const idempotencyKey = readActorIdempotencyKey(req.headers['idempotency-key'], body.idempotencyKey);
    const itemIds = body.items.map((row) => row.itemId);

    const items = await prisma.orderItem.findMany({
      where: { id: { in: itemIds } },
      include: { order: true },
    });
    if (items.length !== itemIds.length) throw conflict('Зарим бараа олдсонгүй.');

    const uniqueOrderIds = [...new Set(items.map((i) => i.orderId))];
    await syncOrdersStorageFees(uniqueOrderIds);
    await syncOrdersCargoFees(uniqueOrderIds);

    const result = await handOverItems({
      lines: body.items,
      actor,
      note: body.note,
      idempotencyKey,
      collection: {
        collectedAmount: body.collectedAmount,
        method: body.method,
      },
    });

    res.json({
      data: {
        itemCount: result.itemCount,
        pieceCount: result.pieceCount,
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
        idempotencyKey: z.string().trim().min(8).max(128).optional(),
      })
      .default({}),
  }),
  asyncHandler(async (req, res) => {
    const { collectedAmount, method, note, idempotencyKey: bodyKey } = req.body as {
      collectedAmount?: number;
      method?: 'CASH' | 'CARD' | 'BANK_TRANSFER';
      note?: string;
      idempotencyKey?: string;
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

    const actor = actorOf(req);
    const idempotencyKey = readActorIdempotencyKey(req.headers['idempotency-key'], bodyKey);

    // Бүх ирсэн ширхгийг өгнө; үлдсэн хүлээж буй мөр байвал захиалга ARRIVED үлдэнэ.
    await handOverItems({
      lines: pickable.map((i) => ({
        itemId: i.id,
        qty: pickableQtyOf(i),
        expectedHandedQty: handedQtyOf(i),
      })),
      actor,
      note,
      idempotencyKey,
      collection: {
        collectedAmount,
        method,
        autoCollectDue: true,
      },
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

    res.json({ data: adminOrderDetail(updated, await currentLeasingPayGaps()) });
  }),
);
