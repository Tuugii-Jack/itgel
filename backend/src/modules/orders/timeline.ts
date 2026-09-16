import type { OrderStatus } from '@prisma/client';
import { addDays, toIso } from '../../lib/date.js';
import type { OrderWithItems } from './lifecycle.js';

/**
 * Хүлээгдэж буй ирэх огноо — зөвхөн багцын ETA.
 * Хаагдах өдөр + хоногоор таамаг бодохгүй.
 */
export function estimatedArrival(order: OrderWithItems): { from: Date | null; to: Date | null } {
  if (order.batch?.etaFrom || order.batch?.etaTo) {
    return { from: order.batch.etaFrom ?? null, to: order.batch.etaTo ?? null };
  }
  return { from: null, to: null };
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
  const eta = estimatedArrival(order);
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
