import type { OrderStatus } from '@prisma/client';

export type ArrivalSmsItem = {
  cancelledAt: Date | null;
  arrivedAt: Date | null;
  arrivedQty: number;
  qty: number;
  handedOverAt: Date | null;
};

export type ArrivalSmsOrder = {
  deletedAt: Date | null;
  status: OrderStatus;
  items: ArrivalSmsItem[];
};

export type ArrivalSmsDecision =
  | { ok: true }
  | { ok: false; reason: string };

function itemArrived(item: ArrivalSmsItem): boolean {
  if (item.cancelledAt) return false;
  return item.arrivedQty > 0 || item.arrivedAt !== null;
}

/** Ирсэн, хараахан хүлээлгэж өгөөгүй идэвхтэй мөр. */
export function itemsAwaitingHandover(items: ArrivalSmsItem[]): ArrivalSmsItem[] {
  return items.filter((item) => itemArrived(item) && !item.handedOverAt);
}

/**
 * Багцын төлөв хангалтгүй — бараа бодитоор ирсэн, хүлээлгэж өгөөгүй байх ёстой.
 * Хэсэгчлэн ирсэн захиалгад зөвхөн ирсэн үлдэгдэлтэй бол зөвшөөрнө.
 */
export function arrivalSmsEligibility(order: ArrivalSmsOrder): ArrivalSmsDecision {
  if (order.deletedAt) return { ok: false, reason: 'Устгасан захиалга.' };
  if (order.status === 'CANCELLED') return { ok: false, reason: 'Цуцлагдсан захиалга.' };
  if (order.status === 'HANDED_OVER') return { ok: false, reason: 'Барааг хүлээлгэн өгсөн.' };

  const active = order.items.filter((item) => !item.cancelledAt);
  if (active.length === 0) return { ok: false, reason: 'Идэвхтэй бараа алга.' };

  if (!active.some(itemArrived)) return { ok: false, reason: 'Бараа ирээгүй.' };

  const waiting = itemsAwaitingHandover(active);
  if (waiting.length === 0) return { ok: false, reason: 'Барааг хүлээлгэн өгсөн.' };

  return { ok: true };
}

export function isArrivalSmsEligible(order: ArrivalSmsOrder): boolean {
  return arrivalSmsEligibility(order).ok;
}
