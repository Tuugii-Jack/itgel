import type { SmsDispatch } from '@prisma/client';
import { prisma } from '../prisma.js';
import { smsProviderOf, type SmsLifecycleStatus } from './sms.js';

/** Хүргэлт шалгах цонх. Өдөр тутмын cron-оос өмнө хаагдахгүй. Батлагдаагүй бол unknown — failed биш. */
export const SMS_DELIVERY_WINDOW_MS = 48 * 60 * 60 * 1000;
export const SMS_DELIVERY_MAX_CHECKS = 8;
export const SMS_DELIVERY_BATCH = 8;
/** Нэг cron дуудлагад багтаан хуримтлагдсан мөрийг шалгана. Төлбөртэй plan шаардахгүй. */
export const SMS_DELIVERY_BUDGET_MS = 8_000;

const CHECKABLE: SmsLifecycleStatus[] = ['queued', 'pending', 'unknown'];

/** Өдөрт нэг cron-д тааруулсан зай. Минут тутам backoff хэрэглэхгүй. */
const BACKOFF_MS = [6 * 60 * 60_000, 12 * 60 * 60_000, 24 * 60 * 60_000];

/**
 * Хадгалсан SmsDispatch-ийг үргэлжлүүлэн шалгана.
 * SMS дахин илгээхгүй. Timeout/5xx-ийг failed гэж үзэхгүй.
 */
export type PollSmsDeliveriesOptions = {
  /** true: дараагийн backoff хүлээлгүй шалгана. Cron-д хэрэглэхгүй. SMS дахин илгээхгүй. */
  includeScheduled?: boolean;
};

export async function pollSmsDeliveries(
  now = new Date(),
  budgetMs = SMS_DELIVERY_BUDGET_MS,
  options: PollSmsDeliveriesOptions = {},
): Promise<{ checked: number; delivered: number }> {
  const started = Date.now();
  let checked = 0;
  let delivered = 0;
  const nextCheckAt = options.includeScheduled ? { not: null } : { lte: now };

  while (Date.now() - started < budgetMs) {
    const due = await prisma.smsDispatch.findMany({
      where: {
        status: { in: CHECKABLE },
        providerMessageId: { not: null },
        nextCheckAt,
        checkCount: { lt: SMS_DELIVERY_MAX_CHECKS },
      },
      orderBy: { nextCheckAt: 'asc' },
      take: SMS_DELIVERY_BATCH,
    });
    if (due.length === 0) break;

    for (const row of due) {
      if (Date.now() - started >= budgetMs) break;
      const result = await checkDispatch(row, now);
      checked += 1;
      if (result === 'delivered') delivered += 1;
    }
    if (due.length < SMS_DELIVERY_BATCH) break;
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

  const delay = BACKOFF_MS[Math.min(nextCount, BACKOFF_MS.length) - 1] ?? 24 * 60 * 60_000;
  const windowEnd = new Date(row.createdAt.getTime() + SMS_DELIVERY_WINDOW_MS);
  const scheduled = new Date(now.getTime() + delay);
  const nextCheckAt = scheduled.getTime() > windowEnd.getTime() ? windowEnd : scheduled;
  const status: SmsLifecycleStatus =
    report.status === 'queued' || report.status === 'pending' ? report.status : 'unknown';
  await prisma.smsDispatch.update({
    where: { id: row.id },
    data: {
      status,
      error: report.error ?? null,
      nextCheckAt,
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
