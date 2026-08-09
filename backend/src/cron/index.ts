import cron, { type ScheduledTask } from 'node-cron';
import { prisma } from '../prisma.js';
import { audit } from '../lib/audit.js';
import { addDays, startOfUbDay, ubDateString, UB_TZ } from '../lib/date.js';
import { notifyArrival } from '../services/orders.js';
import { getSettings } from '../services/settings.js';

const tasks: ScheduledTask[] = [];

/**
 * 1. Захиалга хаах — `closeAt` хүрсэн барааг CLOSED болгоно.
 * `autoCloseOnDeadline` унтраалттай бол алгасна.
 */
export async function closeExpiredProducts(now = new Date()): Promise<number> {
  const settings = await getSettings();
  if (!settings.autoCloseOnDeadline) return 0;

  const expired = await prisma.product.findMany({
    where: { deletedAt: null, status: 'ACTIVE', closeAt: { not: null, lte: now } },
    select: { id: true, name: true },
  });
  if (expired.length === 0) return 0;

  await prisma.product.updateMany({
    where: { id: { in: expired.map((p) => p.id) } },
    data: { status: 'CLOSED' },
  });

  await audit({
    actor: 'system',
    action: 'AUTO_CLOSE',
    entity: 'Product',
    entityId: expired.map((p) => p.id).join(','),
    after: { count: expired.length, names: expired.map((p) => p.name) },
  });

  console.info(`[cron] ${expired.length} барааны захиалга хаагдлаа.`);
  return expired.length;
}

/**
 * 2. SMS мэдэгдэл — ARRIVED болсон ч мэдэгдэл очоогүй захиалгуудыг барина.
 * Ердийн урсгалд төлөв солигдох үед шууд илгээгддэг; энэ нь аюулгүйн тор.
 */
export async function sendArrivalNotifications(): Promise<number> {
  const settings = await getSettings();
  if (!settings.smsOnArrival) return 0;

  const pending = await prisma.order.findMany({
    where: { deletedAt: null, status: 'ARRIVED', arrivalNotifiedAt: null },
    take: 200,
  });

  let sent = 0;
  for (const order of pending) {
    if (await notifyArrival(order)) sent += 1;
  }
  if (sent > 0) console.info(`[cron] ${sent} захиалгад ирсэн мэдэгдэл илгээлээ.`);
  return sent;
}

export interface StaleOrderReport {
  code: string;
  customerPhone: string;
  arrivedAt: string | null;
  daysWaiting: number;
  dueAmount: number;
}

/**
 * 3. Үлдэгдэл сануулга — ирснээс хойш 2+ хоног хүлээлгэн өгөөгүй захиалгууд.
 */
export async function reportStaleOrders(now = new Date()): Promise<StaleOrderReport[]> {
  const cutoff = startOfUbDay(addDays(now, -2));

  const stale = await prisma.order.findMany({
    where: { deletedAt: null, status: 'ARRIVED', arrivedAt: { lte: cutoff } },
    include: { customer: true },
    orderBy: { arrivedAt: 'asc' },
  });

  const report: StaleOrderReport[] = stale.map((order) => ({
    code: order.code,
    customerPhone: order.customer.phone,
    arrivedAt: order.arrivedAt?.toISOString() ?? null,
    daysWaiting: order.arrivedAt
      ? Math.floor((now.getTime() - order.arrivedAt.getTime()) / (24 * 60 * 60 * 1000))
      : 0,
    dueAmount: order.dueAmount,
  }));

  if (report.length > 0) {
    await audit({
      actor: 'system',
      action: 'STALE_ORDERS_REPORT',
      entity: 'Order',
      entityId: ubDateString(now),
      after: { count: report.length, orders: report },
    });
    console.warn(`[cron] ${report.length} захиалга 2+ хоног хүлээлгэн өгөөгүй байна.`);
  }

  return report;
}

/** Бүх cron ажлыг UB цагаар ажиллуулна. */
export function startCron(): void {
  const options = { timezone: UB_TZ };

  // Өдөрт нэг — 00:05
  tasks.push(
    cron.schedule('5 0 * * *', () => void closeExpiredProducts().catch(console.error), options),
  );

  // 10 минут тутам
  tasks.push(
    cron.schedule('*/10 * * * *', () => void sendArrivalNotifications().catch(console.error), options),
  );

  // Өдөрт нэг — 09:00
  tasks.push(cron.schedule('0 9 * * *', () => void reportStaleOrders().catch(console.error), options));

  console.info(`[cron] ${tasks.length} ажил эхэллээ (${UB_TZ}).`);
}

export function stopCron(): void {
  for (const task of tasks) task.stop();
  tasks.length = 0;
}
