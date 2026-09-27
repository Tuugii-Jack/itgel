import { Prisma, type PaymentMethod } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { beginActorIdempotency, hashActorPayload } from '../../lib/actorIdempotency.js';
import { conflict } from '../../lib/errors.js';
import { isLeasingResale } from '../../lib/inventoryOwner.js';
import { leasingHoldsGoods } from '../../lib/leasing.js';
import { handedQtyOf, pickableQtyOf } from '../../lib/itemQty.js';
import { lockOrders } from '../../lib/orderLock.js';
import { isProductPaid, shopDueAmount } from '../../services/money.js';
import { recordPaymentWithTotals } from '../../services/payments.js';
import { HANDOVER_PAY_NOTE } from '../../services/handoverHistory.js';
import { promoteOrdersToArrived } from './lifecycle.js';

export interface HandOverLine {
  itemId: string;
  qty: number;
  expectedHandedQty: number;
}

export interface HandOverCollection {
  collectedAmount?: number;
  method?: PaymentMethod;
  /** complete/delivery: дутуу collectedAmount-ийг shop due-р нөхнө. partial: дутуу = 0. */
  autoCollectDue?: boolean;
}

export interface HandOverItemsResult {
  itemCount: number;
  pieceCount: number;
  orderIds: string[];
  completedOrderIds: string[];
  paymentIds: string[];
}

export const HANDOVER_MONEY_SELECT = {
  id: true,
  code: true,
  status: true,
  deletedAt: true,
  isLeasing: true,
  payeeKind: true,
  subtotal: true,
  leasingFee: true,
  storageFee: true,
  cargoFee: true,
  paidAmount: true,
  refundedAmount: true,
  dueAmount: true,
  shopPaidAmount: true,
  writtenOffAmount: true,
  debtClosedAt: true,
} as const;

function canonicalLines(lines: HandOverLine[]) {
  return [...lines]
    .map((line) => ({
      itemId: line.itemId,
      qty: line.qty,
      expectedHandedQty: line.expectedHandedQty,
    }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
}

function handoverPayloadHash(input: {
  lines: HandOverLine[];
  collection?: HandOverCollection;
}): string {
  return hashActorPayload({
    lines: input.lines,
    collectedAmount: input.collection?.collectedAmount ?? null,
    method: input.collection?.method ?? null,
    autoCollectDue: Boolean(input.collection?.autoCollectDue),
  });
}

/**
 * Ирсэн ширхгийг хүлээлгэн өгнө. Олгосон тоо ирсэн тооноос хэтрэхгүй.
 * Дэлгүүрийн үлдэгдэл, олголт, төлбөр, idempotency нэг transaction.
 * Ижил key давхар бүртгэгдэхгүй; өөр хүсэлт үлдсэн ширхгийг олгоно.
 */
export async function handOverItems(opts: {
  lines: HandOverLine[];
  actor: string;
  note?: string;
  now?: Date;
  idempotencyKey: string;
  collection?: HandOverCollection;
}): Promise<HandOverItemsResult> {
  const now = opts.now ?? new Date();
  const lines = canonicalLines(opts.lines);
  if (lines.length === 0) throw conflict('Бараа сонгоогүй байна.');
  for (const line of lines) {
    if (!Number.isInteger(line.qty) || line.qty < 1) {
      throw conflict('Олгох ширхэг 1-ээс багагүй бүхэл тоо байна.');
    }
    if (!Number.isInteger(line.expectedHandedQty) || line.expectedHandedQty < 0) {
      throw conflict('Өмнө олгосон тоо буруу байна.');
    }
  }
  const itemIds = lines.map((line) => line.itemId);
  if (new Set(itemIds).size !== itemIds.length) {
    throw conflict('Нэг мөрийг хоёр удаа сонгосон байна.');
  }

  const payloadHash = handoverPayloadHash({ lines, collection: opts.collection });

  return prisma.$transaction(async (tx) => {
    const requested = await tx.orderItem.findMany({
      where: { id: { in: itemIds } },
      select: { orderId: true },
    });
    await lockOrders(tx, requested.map((item) => item.orderId));

    const { record: idem, created: idemCreated } = await beginActorIdempotency(tx, {
      kind: 'handover',
      actorId: opts.actor,
      key: opts.idempotencyKey,
      payloadHash,
    });
    if (idem.response && typeof idem.response === 'object') {
      return idem.response as HandOverItemsResult;
    }

    const items = await tx.orderItem.findMany({
      where: { id: { in: itemIds } },
      include: {
        order: { include: { delivery: true } },
      },
    });
    if (items.length !== itemIds.length) throw conflict('Зарим бараа олдсонгүй.');

    const orderIds = [...new Set(items.map((i) => i.orderId))];
    const moneyByOrder = new Map(
      (
        await tx.order.findMany({
          where: { id: { in: orderIds } },
          select: HANDOVER_MONEY_SELECT,
        })
      ).map((row) => [row.id, row]),
    );

    const dues = new Map<string, number>();
    let totalDue = 0;
    for (const orderId of orderIds) {
      const order = moneyByOrder.get(orderId);
      if (!order) throw conflict('Захиалга олдсонгүй.');
      if (leasingHoldsGoods(order)) {
        throw conflict('Лизингийн үндсэн төлбөр дутуу. Лизингийн дансанд төлнө, дэлгүүрийн кассанд бүү ав.', {
          code: 'LEASING_BALANCE_DUE',
          orderId,
        });
      }
      if (isLeasingResale(order) && !isProductPaid(order)) {
        throw conflict('Лизингийн бэлэн барааны төлбөр дутуу. Лизингийн QPay-ээр төлнө.', {
          code: 'LEASING_RESALE_UNPAID',
          orderId,
        });
      }
      const due = shopDueAmount(order);
      dues.set(orderId, due);
      totalDue += due;
    }
    if (totalDue > 0) {
      const collected = opts.collection?.autoCollectDue
        ? (opts.collection.collectedAmount ?? totalDue)
        : (opts.collection?.collectedAmount ?? 0);
      if (collected < totalDue) {
        throw conflict(`Дэлгүүрийн үлдэгдэл ${totalDue}₮ бүрэн төлөгдөөгүй байна.`, {
          dueAmount: totalDue,
          collected,
        });
      }
    }

    const byId = new Map(items.map((item) => [item.id, item]));
    let pieceCount = 0;

    for (const line of lines) {
      const item = byId.get(line.itemId);
      if (!item) throw conflict('Зарим бараа олдсонгүй.');
      if (item.cancelledAt) {
        throw conflict(`"${item.nameSnapshot}" цуцлагдсан тул өгөх боломжгүй.`);
      }
      if (item.order.deletedAt || item.order.status === 'CANCELLED') {
        throw conflict(`${item.order.code} захиалга хүчингүй.`);
      }
      if (item.order.status === 'HANDED_OVER') {
        throw conflict(`${item.order.code} аль хэдийн бүтнээр өгсөн.`);
      }
      const currentHanded = handedQtyOf(item);
      if (!idemCreated && currentHanded === line.expectedHandedQty + line.qty) {
        pieceCount += line.qty;
        continue;
      }
      if (currentHanded !== line.expectedHandedQty) {
        throw conflict(`"${item.nameSnapshot}"-ийн олголт өөрчлөгдсөн. Дахин ачаална уу.`, {
          code: 'HANDOVER_STALE',
          itemId: item.id,
          expectedHandedQty: line.expectedHandedQty,
          handedOverQty: currentHanded,
          pickableQty: pickableQtyOf(item),
        });
      }
      const pickable = pickableQtyOf(item);
      if (line.qty > pickable) {
        throw conflict(
          `"${item.nameSnapshot}": олгох ${line.qty} ш, одоо олгох боломжтой ${pickable} ш.`,
          {
            code: 'HANDOVER_EXCEEDS_ARRIVED',
            itemId: item.id,
            qty: line.qty,
            pickableQty: pickable,
            arrivedQty: item.arrivedQty,
            handedOverQty: currentHanded,
          },
        );
      }

      const updated = await tx.$executeRaw`
        UPDATE "OrderItem"
        SET "handedOverQty" = "handedOverQty" + ${line.qty},
            "handedOverAt" = ${now}
        WHERE "id" = ${item.id}
          AND "cancelledAt" IS NULL
          AND "handedOverQty" = ${line.expectedHandedQty}
          AND "arrivedQty" >= ${line.expectedHandedQty + line.qty}
          AND "qty" >= ${line.expectedHandedQty + line.qty}
      `;
      if (updated !== 1) {
        throw conflict(`"${item.nameSnapshot}"-ийн төлөв өөрчлөгдсөн байна. Дахин ачаална уу.`, {
          code: 'HANDOVER_CONFLICT',
          itemId: item.id,
        });
      }
      if (item.fulfilment == null) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: { fulfilment: 'PICKUP' },
        });
      }
      pieceCount += line.qty;
    }

    await tx.order.updateMany({
      where: { id: { in: orderIds }, fulfilment: null },
      data: { fulfilment: 'PICKUP' },
    });

    const completedOrderIds: string[] = [];
    const paymentIds: string[] = [];

    for (const orderId of orderIds) {
      const remaining = await tx.orderItem.findMany({
        where: { orderId, cancelledAt: null },
        select: { qty: true, arrivedQty: true, handedOverQty: true, handedOverAt: true, cancelledAt: true },
      });
      const stillOpen = remaining.some((item) => handedQtyOf(item) < item.qty);
      const order = items.find((i) => i.orderId === orderId)!.order;
      const orderLines = lines.filter((line) => byId.get(line.itemId)?.orderId === orderId);

      if (stillOpen) {
        if (order.status !== 'ARRIVED' && order.status !== 'HANDED_OVER') {
          await promoteOrdersToArrived(
            tx,
            [orderId],
            opts.actor,
            opts.note ?? 'Хэсэгчилсэн хүлээлгэн өгөх',
            now,
          );
        }
        await audit(
          {
            actor: opts.actor,
            action: 'HANDOVER_PARTIAL',
            entity: 'Order',
            entityId: orderId,
            after: {
              lines: orderLines,
              note: opts.note,
            },
          },
          tx,
        );
      } else {
        if (order.status !== 'HANDED_OVER') {
          if (order.status !== 'ARRIVED') {
            await promoteOrdersToArrived(
              tx,
              [orderId],
              opts.actor,
              opts.note ?? 'Хүлээлгэн өгөх',
              now,
            );
          }
          const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
          if (fresh.status === 'ARRIVED') {
            await tx.order.update({
              where: { id: orderId },
              data: { status: 'HANDED_OVER', handedOverAt: now },
            });
            await audit(
              {
                actor: opts.actor,
                action: 'STATUS_CHANGE',
                entity: 'Order',
                entityId: orderId,
                before: { status: 'ARRIVED' },
                after: { status: 'HANDED_OVER', reason: opts.note },
              },
              tx,
            );
          }
        }

        if (order.delivery) {
          await tx.delivery.update({
            where: { id: order.delivery.id },
            data: { status: 'DELIVERED' },
          });
        }

        await audit(
          {
            actor: opts.actor,
            action: 'HANDOVER',
            entity: 'Order',
            entityId: orderId,
            after: { note: opts.note, complete: true, pieceCount, lines: orderLines },
          },
          tx,
        );
        completedOrderIds.push(orderId);
      }

      const money = await tx.order.findUnique({
        where: { id: orderId },
        select: HANDOVER_MONEY_SELECT,
      });
      if (!money) throw conflict('Захиалга олдсонгүй.');
      if (leasingHoldsGoods(money)) {
        throw conflict('Лизингийн үндсэн төлбөр дутуу. Лизингийн дансанд төлнө, дэлгүүрийн кассанд бүү ав.', {
          code: 'LEASING_BALANCE_DUE',
          orderId,
        });
      }
      if (isLeasingResale(money) && !isProductPaid(money)) {
        throw conflict('Лизингийн бэлэн барааны төлбөр дутуу. Лизингийн QPay-ээр төлнө.', {
          code: 'LEASING_RESALE_UNPAID',
          orderId,
        });
      }
      const due = shopDueAmount(money);
      if (due > 0) {
        const collected = opts.collection?.autoCollectDue
          ? (opts.collection.collectedAmount ?? due)
          : (opts.collection?.collectedAmount ?? 0);
        if (collected < due) {
          throw conflict(`Дэлгүүрийн үлдэгдэл ${due}₮ бүрэн төлөгдөөгүй байна.`, {
            dueAmount: due,
            collected,
          });
        }
        const payment = await recordPaymentWithTotals(tx, {
          orderId,
          kind: 'PAYMENT',
          amount: due,
          method: opts.collection?.method ?? 'CASH',
          note: opts.note ?? HANDOVER_PAY_NOTE,
          actor: opts.actor,
          payeeKind: 'SHOP',
        });
        paymentIds.push(payment.payment.id);
      }
    }

    const result: HandOverItemsResult = {
      itemCount: lines.length,
      pieceCount,
      orderIds,
      completedOrderIds,
      paymentIds,
    };
    await tx.actorIdempotency.update({
      where: { id: idem.id },
      data: { response: result as object },
    });
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
