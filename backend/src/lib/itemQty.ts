/** Мөрийн ширхэг — arrivedAt/handedOverAt-ийг тоо мэт ашиглахгүй. */

export type QtyItem = {
  qty: number;
  arrivedQty?: number | null;
  handedOverQty?: number | null;
  arrivedAt?: Date | string | null;
  handedOverAt?: Date | string | null;
  cancelledAt?: Date | string | null;
};

export function orderedQtyOf(item: QtyItem): number {
  return Math.max(0, item.qty);
}

/** Ирсэн ширхэг. arrivedAt нь зөвхөн бүтэн ирсэн огноо. */
export function arrivedQtyOf(item: QtyItem): number {
  return Math.min(Math.max(0, item.arrivedQty ?? 0), orderedQtyOf(item));
}

/**
 * Олгосон ширхэг.
 * Бичигдсэн handedOverQty-г ашиглана.
 * Хуучин бүрэн олголт: handedOverAt байгаа ч qty=0 бол бүтнээр олгосон гэж үздэг.
 * Хэсэгчилсэн түүхийг таамаглахгүй.
 */
export function handedQtyOf(item: QtyItem): number {
  const qty = orderedQtyOf(item);
  const recorded = Math.max(0, item.handedOverQty ?? 0);
  if (recorded > 0) return Math.min(recorded, qty);
  if (item.handedOverAt) return qty;
  return 0;
}

export function pickableQtyOf(item: QtyItem): number {
  if (item.cancelledAt) return 0;
  return Math.max(0, arrivedQtyOf(item) - handedQtyOf(item));
}

export function waitingQtyOf(item: QtyItem): number {
  if (item.cancelledAt) return 0;
  return Math.max(0, orderedQtyOf(item) - arrivedQtyOf(item));
}

/** Агуулахад тооцогдох ширхэг — ирсэн ба олгосны их. Хуучин зөрүүтэй мөрийг таамгаар нөхөхгүй. */
export function accountedQtyOf(item: QtyItem): number {
  return Math.min(orderedQtyOf(item), Math.max(arrivedQtyOf(item), handedQtyOf(item)));
}

export function isFullyHanded(item: QtyItem): boolean {
  if (item.cancelledAt) return false;
  return handedQtyOf(item) >= orderedQtyOf(item);
}

export function isFullyArrived(item: QtyItem): boolean {
  if (item.cancelledAt) return false;
  return arrivedQtyOf(item) >= orderedQtyOf(item);
}

export type ItemQtyStatus = 'cancelled' | 'handed_over' | 'arrived' | 'waiting';

export function itemQtyStatusOf(item: QtyItem): ItemQtyStatus {
  if (item.cancelledAt) return 'cancelled';
  if (isFullyHanded(item)) return 'handed_over';
  if (pickableQtyOf(item) > 0) return 'arrived';
  return 'waiting';
}

export function qtySnapshotOf(item: QtyItem) {
  return {
    qty: orderedQtyOf(item),
    arrivedQty: arrivedQtyOf(item),
    handedOverQty: handedQtyOf(item),
    pickableQty: pickableQtyOf(item),
    waitingQty: waitingQtyOf(item),
  };
}
