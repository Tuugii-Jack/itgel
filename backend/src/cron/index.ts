import cron, { type ScheduledTask } from 'node-cron';
import { prisma } from '../prisma.js';
import { audit } from '../lib/audit.js';
import { sweepAll } from '../lib/rateLimit.js';
import { addDays, startOfUbDay, ubDateString, UB_TZ } from '../lib/date.js';
import {
  changeOrderStatus,
  finalizeRoundClose,
} from '../services/orders.js';
import { getSettings } from '../services/settings.js';
import { syncAllStorageFees } from '../services/storageFee.js';
import { unpaidAutoDeleteWhere } from '../lib/unpaidCancel.js';
import { pollSmsDeliveries } from '../services/smsDeliveryJob.js';

const tasks: ScheduledTask[] = [];

/**
 * 1. Захиалга хаах — `closeAt` хүрсэн тойргийг CLOSED болгоно.
 * `autoCloseOnDeadline` унтраалттай бол алгасна.
 */
export async function closeExpiredProducts(now = new Date()): Promise<number> {
  const expired = await prisma.productRound.findMany({
    where: { deletedAt: null, status: 'ACTIVE', closeAt: { not: null, lte: now } },
    select: { id: true, roundNo: true, product: { select: { name: true } } },
  });
  if (expired.length === 0) return 0;

  await prisma.productRound.updateMany({
    where: { id: { in: expired.map((r) => r.id) } },
    data: { status: 'CLOSED' },
  });

  // Төлөгдөөгүйг цуцлаад, төлснийг «Зам дээр» болгоно.
  const settings = await getSettings();
  if (settings.autoCloseOnDeadline) {
    for (const round of expired) {
      await finalizeRoundClose(round.id, 'system');
    }
  }

  await audit({
    actor: 'system',
    action: 'AUTO_CLOSE',
    entity: 'ProductRound',
    entityId: expired.map((r) => r.id).join(','),
    after: {
      count: expired.length,
      rounds: expired.map((r) => `${r.product.name} #${r.roundNo}`),
      finalized: settings.autoCloseOnDeadline,
    },
  });

  console.info(`[cron] ${expired.length} тойргийн захиалга хаагдлаа.`);
  return expired.length;
}

let closeInFlight = false;
let lastCloseAt = 0;

/**
 * Serverless дээр node-cron ажиллахгүй тул дэлгүүрийн хүсэлт дээр
 * хаагдах цаг хүрсэн тойргийг арын ажил болгож хаана.
 * 30 секунд тутамд нэг удаа — жагсаалтыг удаашруулахгүй.
 */
export function scheduleCloseExpired(): void {
  const now = Date.now();
  if (closeInFlight || now - lastCloseAt < 30_000) return;
  lastCloseAt = now;
  closeInFlight = true;
  void closeExpiredProducts()
    .catch((err) => console.error('[cron] closeExpiredProducts:', err))
    .finally(() => {
      closeInFlight = false;
    });
}

let unpaidCancelInFlight = false;
let lastUnpaidCancelAt = 0;
const UNPAID_CANCEL_THROTTLE_MS = 15 * 60 * 1000;

/**
 * Vercel дээр node-cron ажиллахгүй. SMS cron цуцлалт дууддаггүй.
 * Каталог/нүүрний хүсэлт дээр 15 мин тутам нөхөж ажиллуулна — төлөгчийн браузер шаардахгүй.
 */
export function scheduleCancelUnpaid(): void {
  const now = Date.now();
  if (unpaidCancelInFlight || now - lastUnpaidCancelAt < UNPAID_CANCEL_THROTTLE_MS) return;
  lastUnpaidCancelAt = now;
  unpaidCancelInFlight = true;
  void cancelUnpaidOrders()
    .catch((err) => console.error('[cron] cancelUnpaidOrders:', err))
    .finally(() => {
      unpaidCancelInFlight = false;
    });
}

/**
 * Хуучин автомат SMS — унтарсан. Бараа ирснийг админ багцаас товчоор илгээнэ.
 */
export async function sendArrivalNotifications(): Promise<number> {
  return 0;
}

/**
 * 4. Мөнгө ороогүй захиалгыг цуцалж soft-delete хийнэ.
 *
 * `unpaidCancelHours` нь 0 бол огт ажиллахгүй.
 * Зөвхөн NEW, огт мөнгө ороогүй (paidAmount 0, төлбөрийн мөр байхгүй)
 * захиалгад хамаарна. QPay / шилжүүлэг / бэлэн — ямар ч орлого орсон бол үлдэнэ.
 * «Шилжүүлсэн» гэж мэдэгдсэн нь мөнгө биш тул хамгаалахгүй.
 * Устгасны дараа «Устсан захиалга»-д 10 хоног үлдэж, дараа нь бүрмөсөн устгана.
 */
export async function cancelUnpaidOrders(now = new Date()): Promise<number> {
  const settings = await getSettings();
  if (settings.unpaidCancelHours <= 0) return 0;

  const cutoff = new Date(now.getTime() - settings.unpaidCancelHours * 60 * 60 * 1000);

  const expired = await prisma.order.findMany({
    where: unpaidAutoDeleteWhere(cutoff),
    select: { id: true, code: true, subtotal: true },
    take: 200,
  });
  if (expired.length === 0) return 0;

  let cancelled = 0;
  for (const order of expired) {
    try {
      await changeOrderStatus(order.id, 'CANCELLED', {
        actor: 'system',
        reason: `Төлбөр ${settings.unpaidCancelHours} цагийн дотор ороогүй.`,
        now,
      });
      await prisma.order.update({
        where: { id: order.id },
        data: { deletedAt: now },
      });
      await audit({
        actor: 'system',
        action: 'SOFT_DELETE',
        entity: 'Order',
        entityId: order.id,
        after: { reason: 'unpaid_timeout', hours: settings.unpaidCancelHours },
      });
      cancelled += 1;
    } catch (error) {
      console.error(`[cron] ${order.code} цуцлаж чадсангүй:`, error);
    }
  }

  if (cancelled > 0) {
    console.info(`[cron] ${cancelled} төлөгдөөгүй захиалга устгагдлаа (10 хоног хадгална).`);
  }
  return cancelled;
}

const DELETED_RETENTION_DAYS = 10;

/**
 * Soft-deleted захиалгыг 10 хоногийн дараа бүрмөсөн устгана.
 * Payment / OrderItem / Delivery cascade-аар дагалдана.
 */
export async function purgeDeletedOrders(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DELETED_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const stale = await prisma.order.findMany({
    where: { deletedAt: { not: null, lte: cutoff } },
    select: { id: true, code: true },
    take: 200,
  });
  if (stale.length === 0) return 0;

  let purged = 0;
  for (const order of stale) {
    try {
      await prisma.order.delete({ where: { id: order.id } });
      await audit({
        actor: 'system',
        action: 'HARD_DELETE',
        entity: 'Order',
        entityId: order.id,
        after: { code: order.code, reason: 'retention_expired' },
      });
      purged += 1;
    } catch (error) {
      console.error(`[cron] ${order.code} бүрмөсөн устгаж чадсангүй:`, error);
    }
  }

  if (purged > 0) {
    console.info(`[cron] ${purged} устсан захиалга бүрмөсөн устлаа.`);
  }
  return purged;
}

export interface StaleOrderReport {
  code: string;
  customerPhone: string | null;
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

/**
 * Агуулахын хадгалалтын хураамж — ирснээс хойш үнэгүй хоногоос хэтэрсэн бараанд.
 * Цаг тутам ажиллана; захиалга нээхэд ч sync хийнэ.
 */
export async function accrueStorageFees(now = new Date()): Promise<number> {
  const updated = await syncAllStorageFees(now);
  if (updated > 0) {
    await audit({
      actor: 'system',
      action: 'STORAGE_FEE_ACCRUED',
      entity: 'Order',
      entityId: ubDateString(now),
      after: { updated },
    });
    console.info(`[cron] ${updated} захиалгын агуулахын хураамж шинэчлэгдлээ.`);
  }
  return updated;
}

/** Бүх cron ажлыг UB цагаар ажиллуулна. */
export function startCron(): void {
  const options = { timezone: UB_TZ };

  // 10 минут тутам — хаагдах цаг хүрсэн тойрог
  tasks.push(
    cron.schedule('*/10 * * * *', () => void closeExpiredProducts().catch(console.error), options),
  );

  // Өдөрт нэг — 09:00
  tasks.push(cron.schedule('0 9 * * *', () => void reportStaleOrders().catch(console.error), options));

  // Цаг тутам — төлөгдөөгүй захиалгыг цуцлах (тохиргоо асаалттай үед л).
  tasks.push(
    cron.schedule('15 * * * *', () => void cancelUnpaidOrders().catch(console.error), options),
  );

  // 15 минут тутам — агуулахын хадгалалтын хураамж (request path дээр sync хийхгүй)
  tasks.push(
    cron.schedule('*/15 * * * *', () => void accrueStorageFees().catch(console.error), options),
  );

  // Өдөрт нэг — 03:00: 10 хоног өнгөрсөн soft-delete захиалгыг бүрмөсөн устгана.
  tasks.push(
    cron.schedule('0 3 * * *', () => void purgeDeletedOrders().catch(console.error), options),
  );

  // 1 минут тутам — CallPro хүргэлтийн тайлан. SMS дахин илгээхгүй.
  tasks.push(
    cron.schedule('*/1 * * * *', () => void pollSmsDeliveries().catch(console.error), options),
  );
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
