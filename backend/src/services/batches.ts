import type { Batch, Order, OrderStatus } from '@prisma/client';
import { prisma } from '../prisma.js';
import { audit } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import {
  BATCH_STAGE_LABEL,
  canTransition,
  nextBatchStage,
  orderStatusForBatchStage,
  stepsToStatus,
} from '../lib/orderStatus.js';
import { notifyArrival } from './orders.js';

/** Төлөв бүрийн огноог тэмдэглэх талбар. */
const STATUS_TIMESTAMP: Partial<Record<OrderStatus, string>> = {
  CONFIRMED: 'confirmedAt',
  IN_BATCH: 'inBatchAt',
  IN_TRANSIT: 'inTransitAt',
  ARRIVED: 'arrivedAt',
  HANDED_OVER: 'handedOverAt',
  CANCELLED: 'cancelledAt',
};

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

    const target = orderStatusForBatchStage(next);
    let moved = 0;
    let skipped = 0;

    if (target) {
      const now = new Date();

      for (const order of batch.orders) {
        const steps = stepsToStatus(order.status, target);
        if (steps.length === 0) {
          skipped += 1;
          continue;
        }

        // Гинжин алхам бүр зөвшөөрөгдсөн эсэхийг шалгана.
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
          if (field) timestamps[field] = now;
          current = step;
        }

        await tx.order.update({
          where: { id: order.id },
          data: { status: target, ...timestamps },
        });

        await audit(
          {
            actor,
            action: 'STATUS_CHANGE',
            entity: 'Order',
            entityId: order.id,
            before: { status: order.status },
            after: {
              status: target,
              reason: `Багц "${batch.name}" → ${BATCH_STAGE_LABEL[next]}`,
            },
          },
          tx,
        );

        if (target === 'ARRIVED') arrivedOrderIds.push(order.id);
        moved += 1;
      }
    } else {
      skipped = batch.orders.length;
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
  // Илгээгдээгүй нь `arrivalNotifiedAt` -аар тэмдэглэгдэж, cron барина.
  for (const orderId of arrivedOrderIds) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (order) await notifyArrival(order as Order);
  }

  return result;
}
