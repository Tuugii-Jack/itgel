import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { beginActorIdempotency } from '../../lib/actorIdempotency.js';
import { conflict } from '../../lib/errors.js';
import { handedQtyOf, pickableQtyOf } from '../../lib/itemQty.js';
import { lockOrders } from '../../lib/orderLock.js';
import { promoteOrdersToArrived } from './lifecycle.js';

export interface HandOverLine {
  itemId: string;
  qty: number;
  expectedHandedQty: number;
}

export interface HandOverItemsResult {
  itemCount: number;
  pieceCount: number;
  orderIds: string[];
  completedOrderIds: string[];
}

function canonicalLines(lines: HandOverLine[]) {
  return [...lines]
    .map((line) => ({
      itemId: line.itemId,
      qty: line.qty,
      expectedHandedQty: line.expectedHandedQty,
    }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
}

/**
 * Ирсэн ширхгийг хүлээлгэн өгнө. Олгосон тоо ирсэн тооноос хэтрэхгүй.
 * Ижил idempotency key давхар бүртгэгдэхгүй; өөр хүсэлт үлдсэн ширхгийг олгоно.
 */
export async function handOverItems(opts: {
  lines: HandOverLine[];
  actor: string;
  note?: string;
  now?: Date;
  idempotencyKey: string;
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

  const payloadHash = JSON.stringify(lines);

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
      where: { id: { in: [...new Set(items.map((i) => i.orderId))] }, fulfilment: null },
      data: { fulfilment: 'PICKUP' },
    });

    const orderIds = [...new Set(items.map((i) => i.orderId))];
    const completedOrderIds: string[] = [];

    for (const orderId of orderIds) {
      const remaining = await tx.orderItem.findMany({
        where: { orderId, cancelledAt: null },
        select: { qty: true, arrivedQty: true, handedOverQty: true, handedOverAt: true, cancelledAt: true },
      });
      const stillOpen = remaining.some((item) => handedQtyOf(item) < item.qty);
      const order = items.find((i) => i.orderId === orderId)!.order;

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
              lines: lines.filter((line) => byId.get(line.itemId)?.orderId === orderId),
              note: opts.note,
            },
          },
          tx,
        );
        continue;
      }

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
          after: { note: opts.note, complete: true, pieceCount },
        },
        tx,
      );
      completedOrderIds.push(orderId);
    }

    const result: HandOverItemsResult = {
      itemCount: lines.length,
      pieceCount,
      orderIds,
      completedOrderIds,
    };
    await tx.actorIdempotency.update({
      where: { id: idem.id },
      data: { response: result as object },
    });
    return result;
  });
}
