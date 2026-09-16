import type { SmsDispatch } from '@prisma/client';
import { prisma } from '../prisma.js';
import { smsProviderOf, type SmsLifecycleStatus } from './sms.js';

/** Хүргэлт шалгах цонх. Энэ хугацаанд батлагдаагүй бол unknown — failed биш. */
export const SMS_DELIVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SMS_DELIVERY_MAX_CHECKS = 20;
export const SMS_DELIVERY_BATCH = 8;

const CHECKABLE: SmsLifecycleStatus[] = ['queued', 'pending', 'unknown'];

const BACKOFF_MS = [
  15_000, 30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 30 * 60_000, 60 * 60_000,
];

/**
 * Хадгалсан SmsDispatch-ийг үргэлжлүүлэн шалгана.
 * SMS дахин илгээхгүй. Timeout/5xx-ийг failed гэж үзэхгүй.
 */
export async function pollSmsDeliveries(now = new Date()): Promise<{ checked: number; delivered: number }> {
  const due = await prisma.smsDispatch.findMany({
    where: {
      status: { in: CHECKABLE },
      providerMessageId: { not: null },
      nextCheckAt: { lte: now },
      checkCount: { lt: SMS_DELIVERY_MAX_CHECKS },
    },
    orderBy: { nextCheckAt: 'asc' },
    take: SMS_DELIVERY_BATCH,
  });

  let checked = 0;
  let delivered = 0;
  for (const row of due) {
    const result = await checkDispatch(row, now);
    checked += 1;
    if (result === 'delivered') delivered += 1;
  }
  return { checked, delivered };
}

async function checkDispatch(row: SmsDispatch, now: Date): Promise<SmsLifecycleStatus | 'skipped'> {
  const leaseUntil = new Date(now.getTime() + 30_000);
  const claimed = await prisma.smsDispatch.updateMany({
    where: {
      id: row.id,
      status: { in: CHECKABLE },
      nextCheckAt: row.nextCheckAt,
    },
    data: {
      lastCheckedAt: now,
      checkCount: { increment: 1 },
      nextCheckAt: leaseUntil,
    },
  });
  if (claimed.count !== 1) return 'skipped';

  const provider = smsProviderOf(row.channel === 'shop' ? 'shop' : 'leasing');
  const messageId = row.providerMessageId;
  if (!messageId || !provider.delivery) {
    await finalizeUnknown(row.id, now, row.createdAt, 'Хүргэлтийн тайлан байхгүй.');
    return 'unknown';
  }

  const report = await provider.delivery(messageId);
  if (report.status === 'delivered') {
    await prisma.smsDispatch.update({
      where: { id: row.id },
      data: {
        status: 'delivered',
        deliveredAt: now,
        nextCheckAt: null,
        error: null,
      },
    });
    return 'delivered';
  }

  if (report.status === 'failed') {
    await prisma.smsDispatch.update({
      where: { id: row.id },
      data: {
        status: 'failed',
        nextCheckAt: null,
        error: report.error ?? 'Хүргэлт амжилтгүй.',
      },
    });
    return 'failed';
  }

  const nextCount = row.checkCount + 1;
  const expired = now.getTime() - row.createdAt.getTime() >= SMS_DELIVERY_WINDOW_MS;
  if (expired || nextCount >= SMS_DELIVERY_MAX_CHECKS) {
    await finalizeUnknown(row.id, now, row.createdAt, report.error ?? undefined);
    return 'unknown';
  }

  const delay = BACKOFF_MS[Math.min(nextCount, BACKOFF_MS.length) - 1] ?? 60 * 60_000;
  const status: SmsLifecycleStatus =
    report.status === 'queued' || report.status === 'pending' ? report.status : 'unknown';
  await prisma.smsDispatch.update({
    where: { id: row.id },
    data: {
      status,
      error: report.error ?? null,
      nextCheckAt: new Date(now.getTime() + delay),
    },
  });
  return status;
}

async function finalizeUnknown(id: string, now: Date, _createdAt: Date, error?: string) {
  await prisma.smsDispatch.update({
    where: { id },
    data: {
      status: 'unknown',
      nextCheckAt: null,
      lastCheckedAt: now,
      error: error ?? null,
    },
  });
}
