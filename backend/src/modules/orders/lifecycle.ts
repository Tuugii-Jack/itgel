import type {
  Batch,
  Order,
  OrderItem,
  OrderStatus,
  Prisma,
  ProductRound,
} from '@prisma/client';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { conflict } from '../../lib/errors.js';
import { lockOrder } from '../../lib/orderLock.js';
import { canTransition, ORDER_STATUS_LABEL, previousInFlow, stepsToStatus } from '../../lib/orderStatus.js';
import { isProductPaid } from '../../services/money.js';
import {
  consumeReadyStock as consumeRoundStock,
  restoreReadyStock as restoreRoundStock,
  selectionsFromItem,
} from '../../services/readyStock.js';
import { notifyOrderConfirmed } from './notify.js';

export type OrderWithItems = Order & {
  items: (OrderItem & { round?: ProductRound | null })[];
  batch?: Batch | null;
};

/** Төлөв бүрийн огноог тэмдэглэх талбар. */
const STATUS_TIMESTAMP: Partial<Record<OrderStatus, keyof Prisma.OrderUpdateInput>> = {
  CONFIRMED: 'confirmedAt',
  IN_BATCH: 'inBatchAt',
  IN_TRANSIT: 'inTransitAt',
  ARRIVED: 'arrivedAt',
  HANDED_OVER: 'handedOverAt',
  CANCELLED: 'cancelledAt',
};

export interface StatusChangeOptions {
  actor: string;
  /** Багц ахих үед олон алхмыг дараалуулан гүйцэтгэнэ. */
  reason?: string;
  now?: Date;
}

/**
 * Захиалгын төлөв шилжүүлнэ. Буруу шилжилтэд 409.
 * Бараа ирсэн SMS автоматаар явахгүй — админ багцаас товчоор илгээнэ.
 */
export async function changeOrderStatus(
  orderId: string,
  to: OrderStatus,
  options: StatusChangeOptions,
): Promise<Order> {
  const now = options.now ?? new Date();

  const updated = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw conflict('Захиалга олдсонгүй.');

    if (!canTransition(order.status, to)) {
      throw conflict(
        `"${ORDER_STATUS_LABEL[order.status]}" төлвөөс "${ORDER_STATUS_LABEL[to]}" руу шилжих боломжгүй.`,
        { from: order.status, to },
      );
    }

    if (to === 'CANCELLED') {
      const delivered = await tx.orderItem.count({
        where: { orderId, cancelledAt: null, handedOverAt: { not: null } },
      });
      if (delivered > 0) {
        throw conflict('Зарим барааг хүлээлгэн өгсөн тул үлдсэн барааг мөрөөр нь цуцална уу.');
      }
    }

    const timestampField = STATUS_TIMESTAMP[to];
    const data: Prisma.OrderUpdateInput = { status: to };
    if (timestampField) (data as Record<string, unknown>)[timestampField] = now;

    // Багц-түрүүлэх урсгал: захиалгын урьдчилсан барааны бүх мөр нэг багцын
    // тойргоос бол баталгаажихдаа тэр багц руу автоматаар орно. Хоёр өөр
    // багцын бараа холилдсон ховор тохиолдолд админ гараар багцална.
    if (to === 'CONFIRMED' && !order.batchId) {
      const autoBatchId = await batchForOrder(tx, orderId);
      if (autoBatchId) data.batch = { connect: { id: autoBatchId } };
    }

    const next = await tx.order.update({ where: { id: orderId }, data });

    // Бэлэн бараа — баталгаажмагц авах боломжтой; ядаж нэг ирсэн бол ARRIVED.
    if (to === 'CONFIRMED') {
      await audit(
        {
          actor: options.actor,
          action: 'STATUS_CHANGE',
          entity: 'Order',
          entityId: orderId,
          before: { status: order.status },
          after: { status: 'CONFIRMED', reason: options.reason },
        },
        tx,
      );
      const readyCount = await markReadyItemsArrived(tx, orderId, now);
      if (readyCount > 0) {
        const steps = stepsToStatus('CONFIRMED', 'ARRIVED');
        const timestamps: Record<string, Date> = {};
        let current: OrderStatus = 'CONFIRMED';
        for (const step of steps) {
          if (!canTransition(current, step)) break;
          const field = STATUS_TIMESTAMP[step];
          if (field) (timestamps as Record<string, Date>)[field as string] = now;
          current = step;
        }
        if (current === 'ARRIVED') {
          const arrived = await tx.order.update({
            where: { id: orderId },
            data: { status: 'ARRIVED', ...timestamps },
          });
          await audit(
            {
              actor: options.actor,
              action: 'STATUS_CHANGE',
              entity: 'Order',
              entityId: orderId,
              before: { status: 'CONFIRMED' },
              after: { status: 'ARRIVED', reason: 'Бэлэн бараа ирсэн' },
            },
            tx,
          );
          return arrived;
        }
      }
      return next;
    }

    // Захиалга ARRIVED болоход бэлэн барааг ирсэн гэж тэмдэглэнэ.
    // Урьдчилсан мөрийг бүү бүгдийг нь ирсэн болго — ирсэн тоог багцаас бүртгэнэ.
    if (to === 'ARRIVED') {
      await markReadyItemsArrived(tx, orderId, now);
    }
    if (to === 'HANDED_OVER') {
      await stampItemsFullyArrived(tx, { orderId, cancelledAt: null, handedOverAt: null }, now);
      await tx.orderItem.updateMany({
        where: { orderId, cancelledAt: null, handedOverAt: null },
        data: { handedOverAt: now },
      });
    }

    // Захиалга бүтнээрээ цуцлагдвал бэлэн барааны үлдэгдлийг буцаана.
    // Эс бөгөөс цуцалсан бүрд агуулахын тоо худал багасаж үлдэнэ.
    if (to === 'CANCELLED') await restoreReadyStock(tx, orderId);

    await audit(
      {
        actor: options.actor,
        action: 'STATUS_CHANGE',
        entity: 'Order',
        entityId: orderId,
        before: { status: order.status },
        after: { status: to, reason: options.reason },
      },
      tx,
    );

    return next;
  });

  // И-мэйл/SMS-ийг хүлээхгүй — админы товч SMTP/SMS провайдерээс гацахгүй.
  if (to === 'CONFIRMED') {
    void notifyOrderConfirmed(updated).catch((e) =>
      console.warn(`[mail] ${updated.code} баталгаажилтын мэдэгдэл алдаа:`, e),
    );
  }
  return updated;
}

/**
 * Тойрог хаагдахад барааны үнэ төлөгдөөгүй захиалгыг цуцална.
 * Карго/агуулахын үлдэгдэл энд хамаарахгүй.
 */
export async function cancelUnpaidOrdersForRound(
  roundId: string,
  actor: string,
  reason = 'Захиалга хаагдсан — төлбөр ороогүй.',
): Promise<number> {
  const candidates = await prisma.order.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ['CANCELLED', 'HANDED_OVER'] },
      items: { some: { roundId, cancelledAt: null } },
    },
    select: { id: true, code: true, subtotal: true, paidAmount: true, refundedAmount: true, leasingFee: true },
    take: 500,
  });
  const unpaid = candidates.filter((o) => !isProductPaid(o));
  if (unpaid.length === 0) return 0;

  const now = new Date();
  let cancelled = 0;
  for (const order of unpaid) {
    try {
      await changeOrderStatus(order.id, 'CANCELLED', { actor, reason, now });
      await prisma.order.update({
        where: { id: order.id },
        data: { deletedAt: now },
      });
      await audit({
        actor,
        action: 'SOFT_DELETE',
        entity: 'Order',
        entityId: order.id,
        after: { reason: 'round_closed_unpaid', roundId, code: order.code },
      });
      cancelled += 1;
    } catch (error) {
      console.error(`[round-close] ${order.code} цуцлаж чадсангүй:`, error);
    }
  }

  if (cancelled > 0) {
    console.info(
      `[round-close] ${cancelled} төлөгдөөгүй захиалга цуцлагдлаа (тойрог ${roundId}).`,
    );
  }
  return cancelled;
}

/**
 * Тойрог хаагдахад төлбөр бүрэн орсон захиалгыг «Зам дээр» (IN_TRANSIT) болгоно.
 */
export async function promotePaidOrdersInTransitForRound(
  roundId: string,
  actor: string,
  reason = 'Захиалга хаагдсан — замд гарлаа.',
): Promise<number> {
  const candidates = await prisma.order.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ['CANCELLED', 'HANDED_OVER', 'IN_TRANSIT', 'ARRIVED'] },
      items: { some: { roundId, cancelledAt: null } },
    },
    select: {
      id: true,
      code: true,
      status: true,
      subtotal: true,
      paidAmount: true,
      refundedAmount: true,
      leasingFee: true,
    },
    take: 500,
  });
  const paid = candidates.filter(isProductPaid);
  if (paid.length === 0) return 0;

  const now = new Date();
  let moved = 0;
  for (const order of paid) {
    try {
      const steps = stepsToStatus(order.status, 'IN_TRANSIT');
      if (steps.length === 0) continue;
      let current = order.status;
      for (const step of steps) {
        await changeOrderStatus(order.id, step, { actor, reason, now });
        current = step;
      }
      if (current === 'IN_TRANSIT') moved += 1;
    } catch (error) {
      console.error(`[round-close] ${order.code} замд шилжүүлж чадсангүй:`, error);
    }
  }

  if (moved > 0) {
    console.info(
      `[round-close] ${moved} захиалга «Зам дээр» боллоо (тойрог ${roundId}).`,
    );
  }
  return moved;
}

/** Тойрог хаагдсаны дараах стандарт үйлдэл: төлөгдөөгүйг цуцлах, төлснийг замд. */
export async function finalizeRoundClose(roundId: string, actor: string): Promise<void> {
  await cancelUnpaidOrdersForRound(roundId, actor);
  await promotePaidOrdersInTransitForRound(roundId, actor);
}

/**
 * Төлвийг нэг алхам буцаана (админ санамсаргүй урагшлуулсан үед).
 * CANCELLED бол audit-аас цуцлахаас өмнөх төлөв рүү.
 */
export async function revertOrderStatus(
  orderId: string,
  options: StatusChangeOptions,
): Promise<Order> {
  const updated = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw conflict('Захиалга олдсонгүй.');
    if (order.deletedAt) throw conflict('Устгасан захиалгын төлөв буцаах боломжгүй.');

    let to: OrderStatus | null = null;
    if (order.status === 'CANCELLED') {
      to = await previousStatusFromAudit(tx, orderId);
      if (!to || to === 'CANCELLED') {
        throw conflict('Цуцлахаас өмнөх төлөвийг олсонгүй. Гараар засаарай.');
      }
    } else {
      to = previousInFlow(order.status);
      if (!to) {
        throw conflict(`"${ORDER_STATUS_LABEL[order.status]}" төлвөөс буцаах боломжгүй.`);
      }
    }

    const from = order.status;
    const data: Prisma.OrderUpdateInput = { status: to };

    // Одоогийн төлвийн огноог цэвэрлэнэ.
    const clearField = STATUS_TIMESTAMP[from];
    if (clearField) (data as Record<string, unknown>)[clearField] = null;

    // Мөрийн нийцүүлэлт
    if (from === 'HANDED_OVER') {
      await tx.orderItem.updateMany({
        where: { orderId, cancelledAt: null },
        data: { handedOverAt: null },
      });
    }
    if (from === 'ARRIVED') {
      // Аваагүй мөрүүдийн arrivedAt-ийг арилгана (буцааж «хүлээж» болгоно).
      await tx.orderItem.updateMany({
        where: { orderId, cancelledAt: null, handedOverAt: null },
        data: { arrivedAt: null, arrivedQty: 0 },
      });
      data.arrivalNotifiedAt = null;
    }
    if (from === 'CONFIRMED' && to === 'NEW') {
      // Бэлэн барааны arrivedAt-ийг баталгаажуулахад тавьсан тул буцаана.
      await tx.orderItem.updateMany({
        where: {
          orderId,
          cancelledAt: null,
          handedOverAt: null,
          round: { closeAt: null },
        },
        data: { arrivedAt: null, arrivedQty: 0 },
      });
      data.arrivalNotifiedAt = null;
      if (order.batchId) data.batch = { disconnect: true };
    }
    if (from === 'CANCELLED') {
      data.cancelledAt = null;
      // Цуцлах үед үлдэгдэл нэмэгдсэн тул дахин хасна.
      await consumeReadyStock(tx, orderId);
    }

    const next = await tx.order.update({ where: { id: orderId }, data });

    await audit(
      {
        actor: options.actor,
        action: 'STATUS_REVERT',
        entity: 'Order',
        entityId: orderId,
        before: { status: from },
        after: { status: to, reason: options.reason ?? 'Админ буцаасан' },
      },
      tx,
    );

    return next;
  });

  return updated;
}

async function previousStatusFromAudit(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<OrderStatus | null> {
  const logs = await tx.auditLog.findMany({
    where: { entity: 'Order', entityId: orderId, action: { in: ['STATUS_CHANGE', 'STATUS_REVERT'] } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  for (const log of logs) {
    const after = log.after as { status?: string } | null;
    if (after?.status === 'CANCELLED') {
      const before = log.before as { status?: OrderStatus } | null;
      if (before?.status && before.status !== 'CANCELLED') return before.status;
    }
  }
  return null;
}

/** Цуцлалтыг буцаах үед бэлэн барааны үлдэгдлийг дахин хасна. */
async function consumeReadyStock(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const items = await tx.orderItem.findMany({
    where: { orderId, cancelledAt: null, handedOverAt: null },
    include: {
      round: { include: { skuStocks: true, product: { select: { name: true } } } },
    },
  });

  for (const item of items) {
    if (!item.round || item.round.closeAt !== null) continue;
    await consumeRoundStock(
      tx,
      {
        ...item.round,
        product: { name: item.round.product.name },
      },
      item.qty,
      selectionsFromItem(item),
    );
  }
}

/**
 * Захиалга аль багцад орох ёстойг тодорхойлно.
 *
 * Идэвхтэй, урьдчилсан (closeAt заасан) мөрүүдийн тойргууд бүгд НЭГ багцад
 * харьяалагдаж, тэр багц нь захиалга хүлээн авах шатандаа байвал тэр багцын
 * id-г буцаана. Бусад тохиолдолд null — одоогийн гар аргын урсгал хэвээр.
 */
async function batchForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<string | null> {
  const items = await tx.orderItem.findMany({
    where: { orderId, cancelledAt: null },
    select: { round: { select: { batchId: true, closeAt: true } } },
  });

  const preorder = items.filter((i) => i.round.closeAt !== null);
  if (preorder.length === 0) return null;

  const batchIds = new Set(preorder.map((i) => i.round.batchId));
  if (batchIds.size !== 1) return null;
  const [batchId] = batchIds;
  if (!batchId) return null;

  const batch = await tx.batch.findFirst({
    where: { id: batchId, deletedAt: null, stage: 'IN_TRANSIT' },
    select: { id: true },
  });
  return batch?.id ?? null;
}

/**
 * Цуцлагдсан захиалгын бэлэн барааны үлдэгдлийг агуулахад буцаана.
 * Урьдчилсан захиалгын бараа (`closeAt` заасан) үлдэгдэлгүй тул хамаарахгүй.
 * Мөрөөр нь цуцалсан бараа энд дахин тоологдохгүй — тэр нь аль хэдийн буцаагдсан.
 */
async function restoreReadyStock(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const items = await tx.orderItem.findMany({
    where: { orderId, cancelledAt: null, handedOverAt: null },
    include: { round: { include: { skuStocks: true } } },
  });

  for (const item of items) {
    if (!item.round || item.round.closeAt !== null) continue;
    await restoreRoundStock(tx, item.round, item.qty, selectionsFromItem(item));
  }
}

/** Мөрүүдийг бүтнээр ирсэн гэж тэмдэглэнэ (arrivedQty = qty). */
async function stampItemsFullyArrived(
  tx: Prisma.TransactionClient,
  where: Prisma.OrderItemWhereInput,
  now: Date,
): Promise<number> {
  const items = await tx.orderItem.findMany({
    where,
    select: { id: true, qty: true },
  });
  if (items.length === 0) return 0;
  for (const item of items) {
    await tx.orderItem.update({
      where: { id: item.id },
      data: { arrivedAt: now, arrivedQty: item.qty },
    });
  }
  return items.length;
}

/** Бэлэн барааны мөрүүдийг ирсэн гэж тэмдэглэнэ (closeAt null). */
export async function markReadyItemsArrived(
  tx: Prisma.TransactionClient,
  orderId: string,
  now = new Date(),
): Promise<number> {
  return stampItemsFullyArrived(
    tx,
    {
      orderId,
      cancelledAt: null,
      arrivedAt: null,
      round: { closeAt: null },
    },
    now,
  );
}

/**
 * Багцын тойргийн бүх мөрийг бүтнээр ирсэн гэж тэмдэглэнэ.
 * Нөлөөлсөн захиалгын id-уудыг буцаана.
 */
export async function markItemsArrivedForBatch(
  tx: Prisma.TransactionClient,
  batchId: string,
  now = new Date(),
): Promise<string[]> {
  const items = await tx.orderItem.findMany({
    where: {
      cancelledAt: null,
      arrivedAt: null,
      round: { batchId },
    },
    select: { id: true, orderId: true, qty: true },
  });
  if (items.length === 0) return [];

  for (const item of items) {
    await tx.orderItem.update({
      where: { id: item.id },
      data: { arrivedAt: now, arrivedQty: item.qty },
    });
  }

  return [...new Set(items.map((i) => i.orderId))];
}

/**
 * Ирсэн мөртэй захиалгуудыг `ARRIVED` хүртэл ахиулна (алхам алхмаар).
 * Аль хэдийн ARRIVED/HANDED_OVER/CANCELLED бол алгасна.
 */
export async function promoteOrdersToArrived(
  tx: Prisma.TransactionClient,
  orderIds: string[],
  actor: string,
  reason: string,
  now = new Date(),
): Promise<string[]> {
  if (orderIds.length === 0) return [];

  const orders = await tx.order.findMany({
    where: {
      id: { in: orderIds },
      deletedAt: null,
      status: { notIn: ['ARRIVED', 'HANDED_OVER', 'CANCELLED'] },
    },
    select: { id: true, code: true, status: true },
  });

  const promoted: string[] = [];
  for (const order of orders) {
    const steps = stepsToStatus(order.status, 'ARRIVED');
    if (steps.length === 0) continue;

    let current = order.status;
    const timestamps: Record<string, Date> = {};
    for (const step of steps) {
      if (!canTransition(current, step)) {
        throw conflict(
          `${order.code} захиалгыг "${step}" руу шилжүүлэх боломжгүй.`,
          { orderCode: order.code, from: current, to: step },
        );
      }
      const field = STATUS_TIMESTAMP[step];
      if (field) timestamps[field as string] = now;
      current = step;
    }

    await tx.order.update({
      where: { id: order.id },
      data: { status: 'ARRIVED', ...timestamps },
    });
    await audit(
      {
        actor,
        action: 'STATUS_CHANGE',
        entity: 'Order',
        entityId: order.id,
        before: { status: order.status },
        after: { status: 'ARRIVED', reason },
      },
      tx,
    );
    promoted.push(order.id);
  }
  return promoted;
}

