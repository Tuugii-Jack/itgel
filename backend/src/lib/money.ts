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

export type AttributedShare = { ownerId: string; subtotal: number };

/**
 * Холимог эзэмшлийн дүнг мөрийн дүнгээр хуваана. Хадгалсан захиалгыг өөрчлөхгүй.
 * Эздийн floor дүн + хуваарилаагүй үлдэгдэл = бодит нийт.
 */
export function splitAttributedAmount(
  amount: number,
  shares: AttributedShare[],
): { byOwner: Record<string, number>; unallocated: number } {
  const byOwner: Record<string, number> = {};
  for (const share of shares) byOwner[share.ownerId] = 0;
  if (amount <= 0) return { byOwner, unallocated: 0 };
  if (shares.length === 0) return { byOwner, unallocated: amount };
  const allSubtotal = shares.reduce((sum, share) => sum + share.subtotal, 0);
  if (allSubtotal <= 0) return { byOwner, unallocated: amount };
  if (shares.length === 1) {
    byOwner[shares[0]!.ownerId] = amount;
    return { byOwner, unallocated: 0 };
  }
  let allocated = 0;
  for (const share of shares) {
    const part = share.subtotal <= 0 ? 0 : Math.floor((amount * share.subtotal) / allSubtotal);
    byOwner[share.ownerId] = part;
    allocated += part;
  }
  return { byOwner, unallocated: amount - allocated };
}

/** Нэг эзний floor хувь. Нийт тэнцэлд `splitAttributedAmount`-ийн unallocated-ийг нэмнэ. */
export function attributedShare(amount: number, ownSubtotal: number, allSubtotal: number): number {
  if (amount <= 0 || ownSubtotal <= 0 || allSubtotal <= 0) return 0;
  if (ownSubtotal >= allSubtotal) return amount;
  return Math.floor((amount * ownSubtotal) / allSubtotal);
}

/** Лизингийн дэвтэр — SHOP карго төлбөрийг алгасна. `null` болон LEASING тооцогдоно. */
export function leasingPayeeSums(
  payments: Array<{ kind: string; payeeKind: string | null; amount: number }>,
): { paid: number; refunded: number } {
  let paid = 0;
  let refunded = 0;
  for (const payment of payments) {
    if (payment.payeeKind === 'SHOP') continue;
    if (payment.kind === 'PAYMENT') paid += payment.amount;
    if (payment.kind === 'REFUND') refunded += payment.amount;
  }
  return { paid, refunded };
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
