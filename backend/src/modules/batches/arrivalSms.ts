import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { isArrivalSmsEligible } from '../../lib/arrivalSms.js';
import { env } from '../../env.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { assertSmsText, smsPreviewToken, smsSegmentOf } from '../../lib/smsCompose.js';
import { findOrderIdsForBatch } from '../../services/batches.js';
import { smsTemplates, type SmsLifecycleStatus } from '../../services/sms.js';
import { notifyArrival } from '../orders/notify.js';

function arrivalTextOf(code: string, commonText?: string, override?: string) {
  if (override?.trim()) return assertSmsText(override.replaceAll('{code}', code));
  if (commonText?.trim()) return assertSmsText(commonText.replaceAll('{code}', code));
  return smsTemplates.arrived(code);
}

export async function previewBatchArrivalSms(
  batchId: string,
  opts: { commonText?: string; overrides?: { orderId: string; text: string }[] } = {},
) {
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
  const orders = await prisma.order.findMany({
    where: { id: { in: activeIds }, deletedAt: null, status: { not: 'CANCELLED' } },
    include: {
      customer: { select: { name: true, phone: true } },
      items: {
        select: {
          cancelledAt: true,
          arrivedAt: true,
          arrivedQty: true,
          qty: true,
          handedOverAt: true,
          handedOverQty: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  const latestSms = await prisma.smsDispatch.findMany({
    where: { relatedType: 'order', relatedId: { in: orders.map((o) => o.id) }, purpose: 'arrival' },
    orderBy: { createdAt: 'desc' },
    select: { relatedId: true, status: true },
  });
  const latestByOrder = new Map<string, string>();
  for (const row of latestSms) {
    if (!row.relatedId || latestByOrder.has(row.relatedId)) continue;
    latestByOrder.set(row.relatedId, row.status);
  }

  const overrideMap = new Map((opts.overrides ?? []).map((row) => [row.orderId, row.text]));
  const recipients: {
    orderId: string;
    code: string;
    name: string | null;
    phone: string;
    text: string;
    chars: number;
    segments: number;
  }[] = [];
  const skipped: { orderId: string; code: string; reason: string }[] = [];
  for (const order of orders) {
    if (!isArrivalSmsEligible(order)) {
      skipped.push({ orderId: order.id, code: order.code, reason: 'Бараа ирээгүй эсвэл олгосон' });
      continue;
    }
    if (!order.customer.phone) {
      skipped.push({ orderId: order.id, code: order.code, reason: 'Утас алга' });
      continue;
    }
    if (order.arrivalNotifiedAt) {
      skipped.push({ orderId: order.id, code: order.code, reason: 'Аль хэдийн илгээсэн' });
      continue;
    }
    const smsStatus = latestByOrder.get(order.id) as SmsLifecycleStatus | undefined;
    if (smsStatus === 'queued' || smsStatus === 'pending' || smsStatus === 'unknown') {
      skipped.push({ orderId: order.id, code: order.code, reason: 'Хүргэлт хүлээгдэж байна' });
      continue;
    }
    const text = arrivalTextOf(order.code, opts.commonText, overrideMap.get(order.id));
    const seg = smsSegmentOf(text);
    recipients.push({
      orderId: order.id,
      code: order.code,
      name: order.customer.name,
      phone: order.customer.phone,
      text,
      chars: seg.chars,
      segments: seg.segments,
    });
  }
  return {
    sender: env.SHOP_SMS_FROM ?? null,
    channel: 'shop' as const,
    recipients,
    skipped,
    previewToken: smsPreviewToken(
      recipients.map((row) => ({ id: row.orderId, text: row.text })),
      { channel: 'shop', relatedType: 'order' },
    ),
  };
}

export async function sendBatchArrivalSms(opts: {
  batchId: string;
  orderId?: string;
  resend?: boolean;
  actor: string;
  previewToken?: string;
  commonText?: string;
  overrides?: { orderId: string; text: string }[];
  sendKey?: string;
}) {
  const { batchId, orderId, resend, actor } = opts;
  const preview = await previewBatchArrivalSms(batchId, {
    commonText: opts.commonText,
    overrides: opts.overrides,
  });
  if (!opts.sendKey?.trim()) {
    throw badRequest('Илгээлтийн түлхүүр алга.');
  }
  if (opts.previewToken !== preview.previewToken) {
    throw conflict('Preview-ийн дараа хүлээн авагч эсвэл мессеж өөрчлөгдсөн. Дахин шалгана уу.');
  }
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
  const targetRecipients = orderId
    ? preview.recipients.filter((row) => row.orderId === orderId)
    : preview.recipients;
  const textByOrder = new Map(targetRecipients.map((row) => [row.orderId, row.text]));
  const targetIds = orderId ? [orderId] : targetRecipients.map((row) => row.orderId);
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
          handedOverQty: true,
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
    const result = await notifyArrival(order, {
      resend: Boolean(resend) && forceSingle,
      text: textByOrder.get(order.id),
      confirmKey: opts.sendKey,
    });
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
