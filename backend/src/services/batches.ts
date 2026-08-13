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
  previousBatchStage,
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
 * Багцын захиалгууд = `Order.batchId` ЭСВЭЛ багцын тойрогт захиалсан мөртэй.
 * Барааны «X ш · Y хүн» тоотой ижил хамрах хүрээ — жагсаалт зөрөхгүй.
 *
 * `omitted: false` (анхдагч) — идэвхтэй (шилжилтэнд орох).
 * `omitted: true` — багцаас хассан (төлбөр дутуу гэх мэт).
 * `omitted: 'all'` — хоёулаа.
 */
export async function findOrderIdsForBatch(
  tx: Tx | typeof prisma,
  batchId: string,
  roundIds?: string[],
  omitted: boolean | 'all' = false,
): Promise<string[]> {
  const rounds =
    roundIds ??
    (
      await tx.productRound.findMany({
        where: { batchId, deletedAt: null },
        select: { id: true },
      })
    ).map((r) => r.id);

  const omitFilter =
    omitted === 'all'
      ? {}
      : omitted
        ? { batchOmittedAt: { not: null } }
        : { batchOmittedAt: null };

  const byBatch = await tx.order.findMany({
    where: { batchId, deletedAt: null, status: { not: 'CANCELLED' }, ...omitFilter },
    select: { id: true },
  });

  const byRound =
    rounds.length === 0
      ? []
      : await tx.order.findMany({
          where: {
            deletedAt: null,
            status: { not: 'CANCELLED' },
            ...omitFilter,
            items: { some: { roundId: { in: rounds }, cancelledAt: null } },
          },
          select: { id: true },
        });

  return [...new Set([...byBatch, ...byRound].map((o) => o.id))];
}

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
        rounds: { where: { deletedAt: null }, select: { id: true } },
      },
    });
    if (!batch) throw notFound('Багц олдсонгүй.');

    // Тойрогт захиалсан ч batchId-гүй захиалгуудыг эхлээд хавсаргана.
    for (const round of batch.rounds) {
      await attachOrdersForRound(tx, round.id, batch.id);
    }

    const orderIds = await findOrderIdsForBatch(
      tx,
      batch.id,
      batch.rounds.map((r) => r.id),
    );
    const orders = await tx.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, code: true, status: true },
    });

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
    // байгаа тойргууд хамт хаагдана — дэлгүүрээс шууд нуугдана.
    if (next === 'CLOSED') {
      await tx.productRound.updateMany({
        where: { batchId: batch.id, status: 'ACTIVE', deletedAt: null },
        data: { status: 'CLOSED', closeAt: new Date() },
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
      const groups = new Map<OrderStatus, typeof orders>();
      for (const order of orders) {
        const list = groups.get(order.status) ?? [];
        list.push(order);
        groups.set(order.status, list);
      }

      for (const [from, group] of groups) {
        const sample = group[0];
        if (!sample) continue;
        const steps = stepsToStatus(from, target);
        if (steps.length === 0) {
          skipped += group.length;
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
          where: { id: { in: group.map((o) => o.id) } },
          data: { status: target, batchId: batch.id, ...timestamps },
        });

        await tx.auditLog.createMany({
          data: group.map((order) => ({
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

        if (target === 'ARRIVED') arrivedOrderIds.push(...group.map((o) => o.id));
        moved += group.length;
      }
    } else {
      skipped = orders.length;
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

/**
 * Багцыг нэг алхам буцаана (админ санамсаргүй урагшлуулсан үед).
 * Хүлээлгэн өгсөн / цуцлагдсан захиалгыг хөндөхгүй.
 */
export async function revertBatch(batchId: string, actor: string): Promise<AdvanceResult> {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.batch.findFirst({
      where: { id: batchId, deletedAt: null },
      include: {
        rounds: { where: { deletedAt: null }, select: { id: true } },
      },
    });
    if (!batch) throw notFound('Багц олдсонгүй.');

    const prev = previousBatchStage(batch.stage);
    if (!prev) throw conflict('Багц эхний шатанд байна — буцаах боломжгүй.');

    const orderIds = await findOrderIdsForBatch(
      tx,
      batch.id,
      batch.rounds.map((r) => r.id),
    );
    const orders = await tx.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, code: true, status: true },
    });

    const fromStage = batch.stage;
    const currentTarget = orderStatusForBatchStage(fromStage);
    const prevTarget = orderStatusForBatchStage(prev);

    const updatedBatch = await tx.batch.update({
      where: { id: batch.id },
      data: {
        stage: prev,
        ...(fromStage === 'CLOSED' && prev === 'COLLECTING' ? { closedAt: null } : {}),
      },
    });

    // Хаагдсан тойргуудыг дахин нээнэ (цуглуулж байгаа шат руу буцах үед).
    if (fromStage === 'CLOSED' && prev === 'COLLECTING') {
      await tx.productRound.updateMany({
        where: { batchId: batch.id, status: 'CLOSED', deletedAt: null },
        data: { status: 'ACTIVE' },
      });
    }

    let moved = 0;
    let skipped = 0;

    if (
      currentTarget &&
      prevTarget &&
      currentTarget !== prevTarget
    ) {
      const movable = orders.filter((o) => o.status === currentTarget);
      skipped = orders.length - movable.length;

      if (movable.length > 0) {
        const clear: Record<string, null> = {};
        const clearField = STATUS_TIMESTAMP[currentTarget];
        if (clearField) clear[clearField] = null;
        if (currentTarget === 'ARRIVED') clear.arrivalNotifiedAt = null;

        await tx.order.updateMany({
          where: { id: { in: movable.map((o) => o.id) } },
          data: { status: prevTarget, ...clear },
        });

        if (currentTarget === 'ARRIVED') {
          await tx.orderItem.updateMany({
            where: {
              orderId: { in: movable.map((o) => o.id) },
              cancelledAt: null,
              handedOverAt: null,
              round: { batchId: batch.id },
            },
            data: { arrivedAt: null },
          });
        }

        await tx.auditLog.createMany({
          data: movable.map((order) => ({
            actor,
            action: 'STATUS_REVERT',
            entity: 'Order',
            entityId: order.id,
            before: { status: currentTarget },
            after: {
              status: prevTarget,
              reason: `Багц "${batch.name}" ← ${BATCH_STAGE_LABEL[prev]}`,
            },
          })),
        });

        moved = movable.length;
      }
    } else {
      skipped = orders.length;
    }

    // Агуулахаас буцах үед багцын тойрогт холбоотой мөрүүдийн arrivedAt-ийг цэвэрлэнэ
    // (дээрх захиалгын жагсаалтад ороогүй ч мөр тэмдэглэгдсэн байж болно).
    if (fromStage === 'AT_WAREHOUSE') {
      await tx.orderItem.updateMany({
        where: {
          cancelledAt: null,
          handedOverAt: null,
          arrivedAt: { not: null },
          round: { batchId: batch.id },
          order: {
            deletedAt: null,
            status: { notIn: FROZEN_ORDER_STATUSES },
          },
        },
        data: { arrivedAt: null },
      });
    }

    await audit(
      {
        actor,
        action: 'REVERT',
        entity: 'Batch',
        entityId: batch.id,
        before: { stage: fromStage },
        after: { stage: prev, ordersMoved: moved, ordersSkipped: skipped },
      },
      tx,
    );

    return { batch: updatedBatch, ordersMoved: moved, ordersSkipped: skipped };
  });
}

/**
 * Багцаас захиалга хасах (Хаагдсан үед төлбөр дутууг нийлүүлэгчид оруулахгүй).
 * batchId хэвээр үлдээнэ — төлбөр орвол дахин оруулна.
 */
export async function omitOrderFromBatch(
  batchId: string,
  orderId: string,
  actor: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const batch = await tx.batch.findFirst({ where: { id: batchId, deletedAt: null } });
    if (!batch) throw notFound('Багц олдсонгүй.');
    if (batch.stage !== 'COLLECTING' && batch.stage !== 'CLOSED') {
      throw conflict('Зам дээр гарсан багцаас захиалга хасах боломжгүй.');
    }

    const order = await tx.order.findFirst({
      where: { id: orderId, deletedAt: null, status: { not: 'CANCELLED' } },
    });
    if (!order) throw notFound('Захиалга олдсонгүй.');
    if (order.batchOmittedAt) throw conflict('Захиалга аль хэдийн хассан.');

    const onBatch =
      order.batchId === batchId ||
      (await tx.orderItem.count({
        where: {
          orderId,
          cancelledAt: null,
          round: { batchId, deletedAt: null },
        },
      })) > 0;
    if (!onBatch) throw conflict('Энэ захиалга энэ багцад хамаарахгүй.');

    await tx.order.update({
      where: { id: orderId },
      data: {
        batchId: batchId,
        batchOmittedAt: new Date(),
      },
    });

    await audit(
      {
        actor,
        action: 'BATCH_OMIT',
        entity: 'Order',
        entityId: orderId,
        before: { batchId: order.batchId, batchOmittedAt: null },
        after: { batchId, batchOmittedAt: true, code: order.code },
      },
      tx,
    );
  });
}

/**
 * Хассан захиалгыг дахин оруулах — төлбөр бүрэн (эсвэл илүү) орсон үед.
 * Хоцорсон төлбөр ч хүлээн авна.
 */
export async function reinstateOrderInBatch(
  batchId: string,
  orderId: string,
  actor: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const batch = await tx.batch.findFirst({ where: { id: batchId, deletedAt: null } });
    if (!batch) throw notFound('Багц олдсонгүй.');
    if (batch.stage === 'DONE') {
      throw conflict('Дууссан багцад дахин оруулах боломжгүй.');
    }

    const order = await tx.order.findFirst({
      where: { id: orderId, deletedAt: null, batchId, batchOmittedAt: { not: null } },
    });
    if (!order) throw notFound('Хассан захиалга олдсонгүй.');

    if (order.dueAmount > 0) {
      throw conflict(
        `Төлбөр дутуу (${order.dueAmount}₮). Мөнгө бүрэн орсны дараа дахин оруулна.`,
        { dueAmount: order.dueAmount },
      );
    }

    await tx.order.update({
      where: { id: orderId },
      data: { batchOmittedAt: null },
    });

    await audit(
      {
        actor,
        action: 'BATCH_REINSTATE',
        entity: 'Order',
        entityId: orderId,
        before: { batchOmittedAt: order.batchOmittedAt },
        after: { batchOmittedAt: null, code: order.code, latePayment: true },
      },
      tx,
    );
  });
}
