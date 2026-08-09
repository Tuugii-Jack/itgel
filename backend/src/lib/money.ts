/** Мөнгөн тооцоо — бүгд бүхэл тоо (₮). Float хэрэглэхгүй. */

export interface PricedItem {
  qty: number;
  unitPrice: number;
  costPriceSnapshot?: number;
}

/** Захиалгын дүн: Σ(unitPrice × qty). */
export function subtotalOf(items: PricedItem[]): number {
  return items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
}

/**
 * Одоо төлөх ба үлдэгдэл.
 * `paidAmount = дүн × depositPercent / 100` (доош тойролт),
 * 100% үед `dueAmount = 0`.
 */
export function splitPayment(
  subtotal: number,
  depositPercent: number,
): { paidAmount: number; dueAmount: number } {
  const pct = Math.min(100, Math.max(0, Math.trunc(depositPercent)));
  if (pct === 100) return { paidAmount: subtotal, dueAmount: 0 };
  const paidAmount = Math.floor((subtotal * pct) / 100);
  return { paidAmount, dueAmount: subtotal - paidAmount };
}

/** Ашиг: Σ((unitPrice − costPriceSnapshot) × qty). */
export function profitOf(items: PricedItem[]): number {
  return items.reduce((sum, i) => sum + (i.unitPrice - (i.costPriceSnapshot ?? 0)) * i.qty, 0);
}

/** Ашгийн хувь: (sell − cost) / sell × 100, бүхэл тоо болгож тойруулна. */
export function marginPercent(sellPrice: number, costPrice: number): number {
  if (sellPrice <= 0) return 0;
  return Math.round(((sellPrice - costPrice) / sellPrice) * 100);
}
