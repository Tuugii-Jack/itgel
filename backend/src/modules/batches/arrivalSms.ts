import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { isArrivalSmsEligible } from '../../lib/arrivalSms.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { findOrderIdsForBatch } from '../../services/batches.js';
import { notifyArrival } from '../orders/notify.js';

export async function sendBatchArrivalSms(opts: {
  batchId: string;
  orderId?: string;
  resend?: boolean;
  actor: string;
}) {
  const { batchId, orderId, resend, actor } = opts;
  const batch = await prisma.batch.findFirst({
    where: { id: batchId, deletedAt: null },
    include: { rounds: { where: { deletedAt: null }, select: { id: true } } },
  });
  if (!batch) throw notFound('Багц олдсонгүй.');
  if (batch.stage !== 'AT_WAREHOUSE' && batch.stage !== 'DONE') {
    throw conflict('Багцыг агуулахад оруулсны дараа SMS илгээнэ.');
  }

  const roundIds = batch.rounds.map((r) => r.id);
  const activeIds = await findOrderIdsForBatch(prisma, batch.id, roundIds, false);
  if (orderId && !activeIds.includes(orderId)) {
    throw badRequest('Энэ захиалга энэ багцад алга.');
  }
  const targetIds = orderId ? [orderId] : activeIds;
  const orders = await prisma.order.findMany({
    where: {
      id: { in: targetIds },
      deletedAt: null,
      status: { not: 'CANCELLED' },
    },
    include: {
      items: {
        select: {
          cancelledAt: true,
          arrivedAt: true,
          arrivedQty: true,
          qty: true,
          handedOverAt: true,
        },
      },
    },
  });

  const forceSingle = Boolean(orderId);
  const sent: string[] = [];
  const skipped: string[] = [];
  const failed: { orderId: string; code: string; error: string }[] = [];
  let pending = 0;
  let delivered = 0;
  let failedCount = 0;
  let unknown = 0;

  for (const order of orders) {
    if (!orderId && !isArrivalSmsEligible(order)) {
      skipped.push(order.id);
      continue;
    }
    const forceResend = Boolean(resend) || (forceSingle && Boolean(order.arrivalNotifiedAt));
    const result = await notifyArrival(order, { resend: forceResend });
    if (result.skipped) skipped.push(order.id);
    else if (result.ok) {
      sent.push(order.id);
      if (result.status === 'delivered') delivered += 1;
      else if (result.status === 'unknown') unknown += 1;
      else pending += 1;
    } else {
      failed.push({ orderId: order.id, code: order.code, error: result.error ?? 'Алдаа' });
      failedCount += 1;
    }
  }

  await audit({
    actor,
    action: 'ARRIVAL_SMS',
    entity: 'Batch',
    entityId: batch.id,
    after: {
      sent: sent.length,
      skipped: skipped.length,
      failed: failed.length,
      pending,
      delivered,
      unknown,
      orderId: orderId ?? null,
    },
  });

  return {
    sent: sent.length,
    skipped: skipped.length,
    pending,
    delivered,
    failed,
    failedCount,
    unknown,
  };
}
