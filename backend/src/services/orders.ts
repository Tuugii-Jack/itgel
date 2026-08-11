import type {
  Batch,
  Order,
  OrderItem,
  OrderStatus,
  Prisma,
  ProductRound,
} from '@prisma/client';
import { prisma } from '../prisma.js';
import { audit } from '../lib/audit.js';
import { addDays, computeArrival, toIso } from '../lib/date.js';
import { conflict } from '../lib/errors.js';
import { canTransition, ORDER_STATUS_LABEL } from '../lib/orderStatus.js';
import { getSettings } from './settings.js';
import { sms, smsTemplates } from './sms.js';

export type OrderWithItems = Order & {
  items: (OrderItem & { round?: ProductRound | null })[];
  batch?: Batch | null;
};

/** Төлөв бүрийн огноог тэмдэглэх талбар. */
const STATUS_TIMESTAMP: Partial<Record<OrderStatus, keyof Prisma.OrderUpdateInput>> = {
  CONFIRMED: 'confirmedAt',
  IN_BATCH: 'inBatchAt',
  IN_TRANSIT: 'inTransitAt',
  ARRIVED: 'arrivedAt',
  HANDED_OVER: 'handedOverAt',
  CANCELLED: 'cancelledAt',
};

export interface StatusChangeOptions {
  actor: string;
  /** Багц ахих үед олон алхмыг дараалуулан гүйцэтгэнэ. */
  reason?: string;
  now?: Date;
}

/**
 * Захиалгын төлөв шилжүүлнэ. Буруу шилжилтэд 409.
 * ARRIVED болмогц `smsOnArrival` асаалттай бол мессеж илгээнэ.
 */
export async function changeOrderStatus(
  orderId: string,
  to: OrderStatus,
  options: StatusChangeOptions,
): Promise<Order> {
  const now = options.now ?? new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw conflict('Захиалга олдсонгүй.');

    if (!canTransition(order.status, to)) {
      throw conflict(
        `"${ORDER_STATUS_LABEL[order.status]}" төлвөөс "${ORDER_STATUS_LABEL[to]}" руу шилжих боломжгүй.`,
        { from: order.status, to },
      );
    }

    const timestampField = STATUS_TIMESTAMP[to];
    const data: Prisma.OrderUpdateInput = { status: to };
    if (timestampField) (data as Record<string, unknown>)[timestampField] = now;

    // Багц-түрүүлэх урсгал: захиалгын урьдчилсан барааны бүх мөр нэг багцын
    // тойргоос бол баталгаажихдаа тэр багц руу автоматаар орно. Хоёр өөр
    // багцын бараа холилдсон ховор тохиолдолд админ гараар багцална.
    if (to === 'CONFIRMED' && !order.batchId) {
      const autoBatchId = await batchForOrder(tx, orderId);
      if (autoBatchId) data.batch = { connect: { id: autoBatchId } };
    }

    const next = await tx.order.update({ where: { id: orderId }, data });

    // Захиалга бүтнээрээ цуцлагдвал бэлэн барааны үлдэгдлийг буцаана.
    // Эс бөгөөс цуцалсан бүрд агуулахын тоо худал багасаж үлдэнэ.
    if (to === 'CANCELLED') await restoreReadyStock(tx, orderId);

    await audit(
      {
        actor: options.actor,
        action: 'STATUS_CHANGE',
        entity: 'Order',
        entityId: orderId,
        before: { status: order.status },
        after: { status: to, reason: options.reason },
      },
      tx,
    );

    return next;
  });

  // SMS-ийг хүлээхгүй — админы «Ирсэн болгох» товч провайдерээс хамаарч
  // гацахгүй. Илгээгдээгүй нь `arrivalNotifiedAt`-аар тэмдэглэгдэж, cron барина.
  if (to === 'ARRIVED') {
    void notifyArrival(updated).catch((e) =>
      console.warn(`[sms] ${updated.code} ирсэн мэдэгдэл алдаа:`, e),
    );
  }
  return updated;
}

/**
 * Захиалга аль багцад орох ёстойг тодорхойлно.
 *
 * Идэвхтэй, урьдчилсан (closeAt заасан) мөрүүдийн тойргууд бүгд НЭГ багцад
 * харьяалагдаж, тэр багц нь захиалга хүлээн авах шатандаа байвал тэр багцын
 * id-г буцаана. Бусад тохиолдолд null — одоогийн гар аргын урсгал хэвээр.
 */
async function batchForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<string | null> {
  const items = await tx.orderItem.findMany({
    where: { orderId, cancelledAt: null },
    select: { round: { select: { batchId: true, closeAt: true } } },
  });

  const preorder = items.filter((i) => i.round.closeAt !== null);
  if (preorder.length === 0) return null;

  const batchIds = new Set(preorder.map((i) => i.round.batchId));
  if (batchIds.size !== 1) return null;
  const [batchId] = batchIds;
  if (!batchId) return null;

  const batch = await tx.batch.findFirst({
    where: { id: batchId, deletedAt: null, stage: { in: ['COLLECTING', 'CLOSED'] } },
    select: { id: true },
  });
  return batch?.id ?? null;
}

/**
 * Цуцлагдсан захиалгын бэлэн барааны үлдэгдлийг агуулахад буцаана.
 * Урьдчилсан захиалгын бараа (`closeAt` заасан) үлдэгдэлгүй тул хамаарахгүй.
 * Мөрөөр нь цуцалсан бараа энд дахин тоологдохгүй — тэр нь аль хэдийн буцаагдсан.
 */
async function restoreReadyStock(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const items = await tx.orderItem.findMany({
    where: { orderId, cancelledAt: null },
    include: { round: true },
  });

  for (const item of items) {
    if (!item.round || item.round.closeAt !== null) continue;
    await tx.productRound.update({
      where: { id: item.roundId },
      data: {
        stock: { increment: item.qty },
        ...(item.round.status === 'SOLD_OUT' ? { status: 'ACTIVE' as const } : {}),
      },
    });
  }
}

/** Захиалга ирснийг мэдэгдэх SMS. Нэг захиалгад нэг л удаа. */
export async function notifyArrival(order: Order): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.smsOnArrival) return false;
  if (order.arrivalNotifiedAt) return false;

  const customer = await prisma.customer.findUnique({ where: { id: order.customerId } });
  if (!customer) return false;

  const result = await sms.send({
    phone: customer.phone,
    text: smsTemplates.arrived(order.code, settings.address, settings.workHours),
  });
  if (!result.ok) {
    console.warn(`[sms] ${order.code} мэдэгдэл илгээгдсэнгүй: ${result.error}`);
    return false;
  }

  await prisma.order.update({
    where: { id: order.id },
    data: { arrivalNotifiedAt: new Date() },
  });
  return true;
}

/**
 * Хүлээгдэж буй ирэх огноо.
 * Багцын ETA байвал түүнийг, эс бөгөөс барааны хамгийн сүүлийн `arriveTo`-г авна.
 */
export function estimatedArrival(order: OrderWithItems, now = new Date()): { from: Date | null; to: Date | null } {
  if (order.batch?.etaFrom || order.batch?.etaTo) {
    return { from: order.batch.etaFrom ?? null, to: order.batch.etaTo ?? null };
  }

  let from: Date | null = null;
  let to: Date | null = null;
  for (const item of order.items) {
    // Захиалах үед амласан огноог мөрөнд нь царцаасан байдаг. Тойрог дахин
    // гарсан ч эдгээр хөдлөхгүй — өмнө нь тойргоос шууд уншиж байсан тул
    // барааг дахин гаргахад хуучин захиалгын огноо чимээгүй хойшилдог байв.
    const arriveFrom =
      item.arriveFrom ?? computeArrival(null, 0, 0, now).arriveFrom;
    const arriveTo = item.arriveTo ?? computeArrival(null, 0, 0, now).arriveTo;

    if (!from || arriveFrom > from) from = arriveFrom;
    if (!to || arriveTo > to) to = arriveTo;
  }
  return { from, to };
}

export interface TimelineStep {
  key: string;
  label: string;
  status: 'done' | 'current' | 'pending';
  at: string | null;
  estimatedAt: string | null;
}

/** Захиалгын дотор хамгийн сүүлд хаагдах тойргийн огноо. */
function latestCloseAt(order: OrderWithItems): Date | null {
  let latest: Date | null = null;
  for (const item of order.items) {
    const closeAt = item.round?.closeAt;
    if (closeAt && (!latest || closeAt > latest)) latest = closeAt;
  }
  return latest;
}

const TIMELINE_ORDER: OrderStatus[] = [
  'NEW',
  'CONFIRMED',
  'IN_BATCH',
  'IN_TRANSIT',
  'ARRIVED',
  'HANDED_OVER',
];

/** Дизайн дээрх timeline — алхам бүр `at` эсвэл `estimatedAt`-тай. */
export function buildTimeline(order: OrderWithItems, now = new Date()): TimelineStep[] {
  const eta = estimatedArrival(order, now);
  const currentIndex = TIMELINE_ORDER.indexOf(order.status);

  // Ирээдүйн алхам бүрд огноо ЗААВАЛ байх ёстой — огноогүй бол хэрэглэгч санддаг.
  const closeAt = latestCloseAt(order);
  const confirmEta = addDays(order.createdAt, 1);
  const supplierEta = order.batch?.closedAt ?? closeAt ?? addDays(order.createdAt, 2);

  const steps: { key: string; label: string; status: OrderStatus; at: Date | null; estimatedAt: Date | null }[] = [
    { key: 'placed', label: 'Захиалга өгсөн', status: 'NEW', at: order.createdAt, estimatedAt: null },
    {
      key: 'confirmed',
      label: 'Баталгаажсан',
      status: 'CONFIRMED',
      at: order.confirmedAt,
      estimatedAt: confirmEta,
    },
    {
      key: 'sent_to_supplier',
      label: 'Нийлүүлэгч рүү явсан',
      status: 'IN_BATCH',
      at: order.inBatchAt,
      estimatedAt: supplierEta,
    },
    {
      key: 'in_transit',
      label: 'Зам дээр',
      status: 'IN_TRANSIT',
      at: order.inTransitAt,
      estimatedAt: eta.from,
    },
    {
      key: 'arrived',
      label: 'Агуулахад ирсэн',
      status: 'ARRIVED',
      at: order.arrivedAt,
      estimatedAt: eta.to,
    },
    {
      key: 'handed_over',
      label: 'Хүлээлгэн өгсөн',
      status: 'HANDED_OVER',
      at: order.handedOverAt,
      estimatedAt: eta.to,
    },
  ];

  // Таамаг огноо ухрахгүй байх — өмнөх алхмаас эрт байж болохгүй.
  let floor: Date | null = null;
  for (const step of steps) {
    const value = step.at ?? step.estimatedAt;
    if (!value) continue;
    if (floor && value < floor) step.estimatedAt = step.at ? step.estimatedAt : floor;
    floor = step.at ?? step.estimatedAt ?? floor;
  }

  const result: TimelineStep[] = steps.map((step) => {
    const stepIndex = TIMELINE_ORDER.indexOf(step.status);
    let state: TimelineStep['status'] = 'pending';
    if (order.status === 'CANCELLED') {
      state = step.at ? 'done' : 'pending';
    } else if (stepIndex < currentIndex) {
      state = 'done';
    } else if (stepIndex === currentIndex) {
      state = order.status === 'HANDED_OVER' ? 'done' : 'current';
    }
    return {
      key: step.key,
      label: step.label,
      status: state,
      at: toIso(step.at),
      estimatedAt: step.at ? null : toIso(step.estimatedAt),
    };
  });

  if (order.status === 'CANCELLED') {
    result.push({
      key: 'cancelled',
      label: 'Цуцлагдсан',
      status: 'done',
      at: toIso(order.cancelledAt),
      estimatedAt: null,
    });
  }

  return result;
}
