import type { Batch, Order, OrderStatus, Prisma, ProductRound } from '@prisma/client';
import { prisma } from '../prisma.js';
import { audit } from '../lib/audit.js';
import { computeArrival } from '../lib/date.js';
import { conflict, notFound } from '../lib/errors.js';
import {
  BATCH_STAGE_LABEL,
  canTransition,
  nextBatchStage,
  orderStatusForBatchStage,
  stepsToStatus,
} from '../lib/orderStatus.js';
import { notifyArrival, markItemsArrivedForBatch, promoteOrdersToArrived } from './orders.js';

/** Төлөв бүрийн огноог тэмдэглэх талбар. */
const STATUS_TIMESTAMP: Partial<Record<OrderStatus, string>> = {
  CONFIRMED: 'confirmedAt',
  IN_BATCH: 'inBatchAt',
  IN_TRANSIT: 'inTransitAt',
  ARRIVED: 'arrivedAt',
  HANDED_OVER: 'handedOverAt',
  CANCELLED: 'cancelledAt',
};

/** Багцад холбохдоо/салгахдаа хөндөхгүй захиалгын төлөв. */
const FROZEN_ORDER_STATUSES: OrderStatus[] = ['CANCELLED', 'HANDED_OVER'];

export type Tx = Prisma.TransactionClient;

/**
 * Тойрогт захиалсан (цуцлагдаагүй, гартаа өгөөгүй) захиалгуудыг багцад хавсаргана.
 * Аль хэдийн өөр багцад байгааг хөндөхгүй.
 */
export async function attachOrdersForRound(
  tx: Tx,
  roundId: string,
  batchId: string,
): Promise<number> {
  const items = await tx.orderItem.findMany({
    where: {
      roundId,
      cancelledAt: null,
      order: {
        deletedAt: null,
        status: { notIn: FROZEN_ORDER_STATUSES },
        OR: [{ batchId: null }, { batchId }],
      },
    },
    select: { orderId: true },
  });
  const orderIds = [...new Set(items.map((i) => i.orderId))];
  if (orderIds.length === 0) return 0;

  const result = await tx.order.updateMany({
    where: {
      id: { in: orderIds },
      deletedAt: null,
      status: { notIn: FROZEN_ORDER_STATUSES },
      OR: [{ batchId: null }, { batchId }],
    },
    data: { batchId },
  });
  return result.count;
}

/**
 * Тойрог багцаас салахад: зөвхөн энэ тойргоор багцад орсон захиалгын
 * batchId-г цэвэрлэнэ (бусад тойрог нь тэр багцад үлдээсэн бол үлдээнэ).
 */
export async function detachOrdersForRound(
  tx: Tx,
  roundId: string,
  batchId: string,
): Promise<number> {
  const items = await tx.orderItem.findMany({
    where: {
      roundId,
      cancelledAt: null,
      order: { deletedAt: null, batchId },
    },
    select: { orderId: true },
  });
  const candidateIds = [...new Set(items.map((i) => i.orderId))];
  if (candidateIds.length === 0) return 0;

  // Бусад тойрог нь энэ багцад байгаа эсэхийг шалгана.
  const stillLinked = await tx.orderItem.findMany({
    where: {
      orderId: { in: candidateIds },
      cancelledAt: null,
      roundId: { not: roundId },
      round: { batchId, deletedAt: null },
      order: { deletedAt: null },
    },
    select: { orderId: true },
  });
  const keep = new Set(stillLinked.map((i) => i.orderId));
  const clearIds = candidateIds.filter((id) => !keep.has(id));
  if (clearIds.length === 0) return 0;

  const result = await tx.order.updateMany({
    where: {
      id: { in: clearIds },
      batchId,
      status: { notIn: FROZEN_ORDER_STATUSES },
    },
    data: { batchId: null },
  });
  return result.count;
}

/**
 * Багцын тойргуудын closeAt + lead-ээс захиалгын мөрүүдийн ирэх огноог дахин тооцно.
 * Цуцлагдсан мөр / гартаа өгсөн захиалгыг хөндөхгүй.
 */
export async function resyncArrivalsForBatch(
  tx: Tx,
  batch: Pick<Batch, 'id'> & { deadline?: Date | null },
  rounds?: Pick<ProductRound, 'id' | 'closeAt' | 'leadMinDays' | 'leadMaxDays'>[],
): Promise<number> {
  const list =
    rounds ??
    (await tx.productRound.findMany({
      where: { batchId: batch.id, deletedAt: null, closeAt: { not: null } },
      select: { id: true, closeAt: true, leadMinDays: true, leadMaxDays: true },
    }));

  let updated = 0;
  for (const round of list) {
    if (!round.closeAt) continue;
    const { arriveFrom, arriveTo } = computeArrival(
      round.closeAt,
      round.leadMinDays,
      round.leadMaxDays,
    );
    const result = await tx.orderItem.updateMany({
      where: {
        roundId: round.id,
        cancelledAt: null,
        order: {
          deletedAt: null,
          status: { notIn: FROZEN_ORDER_STATUSES },
        },
      },
      data: { arriveFrom, arriveTo },
    });
    updated += result.count;
  }
  return updated;
}

export interface AdvanceResult {
  batch: Batch;
  ordersMoved: number;
  /** Аль хэдийн зорилтод хүрсэн тул хөдлөөгүй захиалга. */
  ordersSkipped: number;
}

/**
 * Багцыг дараагийн шат руу ахиулна.
 *
 * Багц ба доторх бүх захиалга НЭГ транзакцад шилжинэ — дунд нь алдвал
 * юу ч өөрчлөгдөхгүй. Өмнө нь захиалга бүрд тусдаа транзакц нээдэг байсан
 * тул хагас шилжсэн байдал үүсэх боломжтой байв.
 *
 * Дахин дуудахад аюулгүй: аль хэдийн зорилтод хүрсэн захиалгыг алгасна.
 * SMS нь транзакц амжилттай дууссаны дараа илгээгдэнэ.
 */
export async function advanceBatch(batchId: string, actor: string): Promise<AdvanceResult> {
  const arrivedOrderIds: string[] = [];

  const result = await prisma.$transaction(async (tx) => {
    const batch = await tx.batch.findFirst({
      where: { id: batchId, deletedAt: null },
      include: {
        orders: {
          where: { deletedAt: null },
          select: { id: true, code: true, status: true },
        },
      },
    });
    if (!batch) throw notFound('Багц олдсонгүй.');

    const next = nextBatchStage(batch.stage);
    if (!next) throw conflict('Багц эцсийн шатанд байна.');

    const updatedBatch = await tx.batch.update({
      where: { id: batch.id },
      data: {
        stage: next,
        ...(next === 'CLOSED' && !batch.closedAt ? { closedAt: new Date() } : {}),
      },
    });

    // Багц захиалга авахаа болиход түүнд зориулж гаргасан, идэвхтэй хэвээр
    // байгаа тойргууд хамт хаагдана — дэлгүүрт «Захиалга хаагдсан» болно.
    if (next === 'CLOSED') {
      await tx.productRound.updateMany({
        where: { batchId: batch.id, status: 'ACTIVE', deletedAt: null },
        data: { status: 'CLOSED' },
      });
    }

    const target = orderStatusForBatchStage(next);
    let moved = 0;
    let skipped = 0;
    const now = new Date();

    if (target) {

      // Ижил төлөвтэй захиалгуудыг бүлэглэж, бүлэг бүрд ганц updateMany +
      // createMany хийнэ. Захиалга бүрд тусдаа хоёр бичилт хийвэл том багц
      // ахиулахад олон секунд зарцуулагддаг байсан.
      const groups = new Map<OrderStatus, typeof batch.orders>();
      for (const order of batch.orders) {
        const list = groups.get(order.status) ?? [];
        list.push(order);
        groups.set(order.status, list);
      }

      for (const [from, orders] of groups) {
        const sample = orders[0];
        if (!sample) continue;
        const steps = stepsToStatus(from, target);
        if (steps.length === 0) {
          skipped += orders.length;
          continue;
        }

        // Гинжин алхам бүр зөвшөөрөгдсөн эсэхийг шалгана — бүлэг доторх
        // захиалгууд ижил төлөвтэй тул нэг л удаа шалгахад хангалттай.
        let current = from;
        const timestamps: Record<string, Date> = {};
        for (const step of steps) {
          if (!canTransition(current, step)) {
            throw conflict(
              `${sample.code} захиалгыг "${step}" руу шилжүүлэх боломжгүй.`,
              { orderCode: sample.code, from: current, to: step },
            );
          }
          const field = STATUS_TIMESTAMP[step];
          if (field) timestamps[field] = now;
          current = step;
        }

        await tx.order.updateMany({
          where: { id: { in: orders.map((o) => o.id) } },
          data: { status: target, ...timestamps },
        });

        await tx.auditLog.createMany({
          data: orders.map((order) => ({
            actor,
            action: 'STATUS_CHANGE',
            entity: 'Order',
            entityId: order.id,
            before: { status: from },
            after: {
              status: target,
              reason: `Багц "${batch.name}" → ${BATCH_STAGE_LABEL[next]}`,
            },
          })),
        });

        if (target === 'ARRIVED') arrivedOrderIds.push(...orders.map((o) => o.id));
        moved += orders.length;
      }
    } else {
      skipped = batch.orders.length;
    }

    // Мөрөөр ирсэн тэмдэг — Order.batchId-аас гадуур тойрог холбогдсон захиалгад ч.
    if (next === 'AT_WAREHOUSE') {
      const itemOrderIds = await markItemsArrivedForBatch(tx, batch.id, now);
      const promoted = await promoteOrdersToArrived(
        tx,
        itemOrderIds,
        actor,
        `Багц "${batch.name}" → ${BATCH_STAGE_LABEL[next]}`,
        now,
      );
      for (const id of promoted) {
        if (!arrivedOrderIds.includes(id)) arrivedOrderIds.push(id);
      }
      // Багцын захиалгад аль хэдийн ARRIVED болсон ч мөрөнд arrivedAt тавьсан.
    }

    await audit(
      {
        actor,
        action: 'ADVANCE',
        entity: 'Batch',
        entityId: batch.id,
        before: { stage: batch.stage },
        after: { stage: next, ordersMoved: moved, ordersSkipped: skipped },
      },
      tx,
    );

    return { batch: updatedBatch, ordersMoved: moved, ordersSkipped: skipped };
  });

  // Мэдэгдэл нь транзакцын гадна — SMS амжилтгүй болсон ч төлөв буцахгүй.
  // Хүлээхгүй илгээнэ: олон захиалгатай багцад «Шат ахиулах» товч SMS
  // провайдерээс хамаарч гацахгүй. Илгээгдээгүй нь `arrivalNotifiedAt`-аар
  // тэмдэглэгдэж, cron барина.
  if (arrivedOrderIds.length > 0) {
    void (async () => {
      const orders = await prisma.order.findMany({ where: { id: { in: arrivedOrderIds } } });
      for (const order of orders) await notifyArrival(order as Order);
    })().catch((e) => console.warn('[sms] багцын ирсэн мэдэгдэл алдаа:', e));
  }

  return result;
}
