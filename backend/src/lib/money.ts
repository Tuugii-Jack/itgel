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

/** Ашиг: Σ((unitPrice − costPriceSnapshot) × qty). */
export function profitOf(items: PricedItem[]): number {
  return items.reduce((sum, i) => sum + (i.unitPrice - (i.costPriceSnapshot ?? 0)) * i.qty, 0);
}

/** Ашгийн хувь: (sell − cost) / sell × 100, бүхэл тоо болгож тойруулна. */
export function marginPercent(sellPrice: number, costPrice: number): number {
  if (sellPrice <= 0) return 0;
  return Math.round(((sellPrice - costPrice) / sellPrice) * 100);
}
