import cron, { type ScheduledTask } from 'node-cron';
import { prisma } from '../prisma.js';
import { audit } from '../lib/audit.js';
import { sweepAll } from '../lib/rateLimit.js';
import { addDays, startOfUbDay, ubDateString, UB_TZ } from '../lib/date.js';
import { changeOrderStatus, notifyArrival } from '../services/orders.js';
import { getSettings } from '../services/settings.js';

const tasks: ScheduledTask[] = [];

/**
 * 1. Захиалга хаах — `closeAt` хүрсэн тойргийг CLOSED болгоно.
 * `autoCloseOnDeadline` унтраалттай бол алгасна.
 */
export async function closeExpiredProducts(now = new Date()): Promise<number> {
  const settings = await getSettings();
  if (!settings.autoCloseOnDeadline) return 0;

  const expired = await prisma.productRound.findMany({
    where: { deletedAt: null, status: 'ACTIVE', closeAt: { not: null, lte: now } },
    select: { id: true, roundNo: true, product: { select: { name: true } } },
  });
  if (expired.length === 0) return 0;

  await prisma.productRound.updateMany({
    where: { id: { in: expired.map((r) => r.id) } },
    data: { status: 'CLOSED' },
  });

  await audit({
    actor: 'system',
    action: 'AUTO_CLOSE',
    entity: 'ProductRound',
    entityId: expired.map((r) => r.id).join(','),
    after: {
      count: expired.length,
      rounds: expired.map((r) => `${r.product.name} #${r.roundNo}`),
    },
  });

  console.info(`[cron] ${expired.length} тойргийн захиалга хаагдлаа.`);
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

/**
 * 4. Мөнгө ороогүй захиалгыг цуцлах.
 *
 * `unpaidCancelHours` нь 0 бол огт ажиллахгүй (анхдагч). Хэрэглэгч
 * "шилжүүлсэн" гэж мэдэгдсэн захиалгыг хөндөхгүй — админ гараар шалгана.
 * Зөвхөн NEW төлөвтэй, огт мөнгө ороогүй захиалгад хамаарна.
 */
export async function cancelUnpaidOrders(now = new Date()): Promise<number> {
  const settings = await getSettings();
  if (settings.unpaidCancelHours <= 0) return 0;

  const cutoff = new Date(now.getTime() - settings.unpaidCancelHours * 60 * 60 * 1000);

  const expired = await prisma.order.findMany({
    where: {
      deletedAt: null,
      status: 'NEW',
      paidAmount: 0,
      paymentClaimedAt: null,
      createdAt: { lte: cutoff },
    },
    select: { id: true, code: true, subtotal: true },
    take: 200,
  });
  if (expired.length === 0) return 0;

  // Захиалга бүрийг тусад нь — нэг нь уначихвал бусад нь үргэлжилнэ.
  let cancelled = 0;
  for (const order of expired) {
    try {
      await changeOrderStatus(order.id, 'CANCELLED', {
        actor: 'system',
        reason: `Төлбөр ${settings.unpaidCancelHours} цагийн дотор ороогүй.`,
        now,
      });
      cancelled += 1;
    } catch (error) {
      console.error(`[cron] ${order.code} цуцлаж чадсангүй:`, error);
    }
  }

  if (cancelled > 0) {
    console.info(`[cron] ${cancelled} төлөгдөөгүй захиалга цуцлагдлаа.`);
  }
  return cancelled;
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

  // Цаг тутам — төлөгдөөгүй захиалгыг цуцлах (тохиргоо асаалттай үед л).
  tasks.push(
    cron.schedule('15 * * * *', () => void cancelUnpaidOrders().catch(console.error), options),
  );

  // Rate limiter-ийн хугацаа дууссан бичлэгүүд — эс цэвэрлэвэл санах ой өснө.
  tasks.push(
    cron.schedule(
      '*/15 * * * *',
      () => sweepAll(),
      options,
    ),
  );

  console.info(`[cron] ${tasks.length} ажил эхэллээ (${UB_TZ}).`);
}

export function stopCron(): void {
  for (const task of tasks) task.stop();
  tasks.length = 0;
}
