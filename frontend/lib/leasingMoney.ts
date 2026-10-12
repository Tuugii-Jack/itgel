/** Хувийг 0.1%-ийн бүхэл нэгжээр бодож, 0.5₮-ийг дээш бүхэлчилнэ. */
export function wholeTugrikFee(subtotal: number, ratePercent: number): number {
  if (!Number.isSafeInteger(subtotal) || subtotal <= 0 || !Number.isFinite(ratePercent) || ratePercent <= 0) return 0;
  const tenths = Math.round(ratePercent * 10);
  return Number((BigInt(subtotal) * BigInt(tenths) + BigInt(500)) / BigInt(1_000));
}
