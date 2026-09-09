/** Лизингийн шимтгэл — backend-тэй ижил шатлал. Тохиргоо байхгүй бол 10%. */

export interface LeasingFeeTier {
  minAmount: number;
  ratePercent: number;
}

export const LEASING_FEE_RATE = 0.1;

export const FALLBACK_LEASING_FEE_TIERS: LeasingFeeTier[] = [
  { minAmount: 0, ratePercent: 10 },
];

export const SUGGESTED_LEASING_FEE_TIERS: LeasingFeeTier[] = [
  { minAmount: 500_000, ratePercent: 11 },
  { minAmount: 400_000, ratePercent: 12 },
  { minAmount: 300_000, ratePercent: 13 },
  { minAmount: 200_000, ratePercent: 14 },
  { minAmount: 0, ratePercent: 15 },
];

export const DEFAULT_LEASING_CHOICE_HINT =
  "Эхлээд {percent}% шимтгэл, дараа нь үндсэн 100%-ийг хувааж төлнө.";
export const DEFAULT_LEASING_TERMS_TITLE = "Лизингийн нөхцөл";
export const DEFAULT_LEASING_TERMS_BODY =
  "Эхний төлөлт нь барааны үнийн {percent}% — лизингийн шимтгэл. Шимтгэл төлөгдсөний дараа барааны үндсэн 100%-ийг нэг удаа эсвэл хувааж төлнө. Шимтгэл нь барааны үнээс тусдаа.";

export function parseLeasingFeeTiers(raw: unknown): LeasingFeeTier[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...FALLBACK_LEASING_FEE_TIERS];
  const seen = new Set<number>();
  const parsed: LeasingFeeTier[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const minAmount = Math.round(Number((row as { minAmount?: unknown }).minAmount));
    const ratePercent = Number((row as { ratePercent?: unknown }).ratePercent);
    if (!Number.isFinite(minAmount) || minAmount < 0) continue;
    if (!Number.isFinite(ratePercent) || ratePercent < 0.1 || ratePercent > 100) continue;
    if (seen.has(minAmount)) continue;
    seen.add(minAmount);
    parsed.push({ minAmount, ratePercent: Math.round(ratePercent * 10) / 10 });
  }
  if (parsed.length === 0) return [...FALLBACK_LEASING_FEE_TIERS];
  const sorted = [...parsed].sort((a, b) => b.minAmount - a.minAmount);
  if (!sorted.some((t) => t.minAmount === 0)) {
    sorted.push({ minAmount: 0, ratePercent: sorted[sorted.length - 1]!.ratePercent });
  }
  return [...sorted].sort((a, b) => b.minAmount - a.minAmount);
}

export function leasingRatePercent(
  subtotal: number,
  tiers: LeasingFeeTier[] = FALLBACK_LEASING_FEE_TIERS,
): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
  const sorted = parseLeasingFeeTiers(tiers);
  return sorted.find((t) => subtotal >= t.minAmount)?.ratePercent ?? 0;
}

export function leasingFeeOf(
  subtotal: number,
  tiers: LeasingFeeTier[] = FALLBACK_LEASING_FEE_TIERS,
): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
  return Math.round(subtotal * (leasingRatePercent(subtotal, tiers) / 100));
}

export function formatLeasingPercent(percent: number): string {
  if (!Number.isFinite(percent) || percent <= 0) return "0";
  return Number.isInteger(percent) ? String(percent) : String(Math.round(percent * 10) / 10);
}

/** Захиалга дээр хадгалсан шимтгэлээс хувь. */
export function leasingFeePercentOf(fee: number, subtotal: number): number {
  if (!(subtotal > 0) || !(fee >= 0)) return 0;
  return Math.round((fee / subtotal) * 1000) / 10;
}

export function leasingFeeCaption(fee: number, subtotal: number): string {
  const percent = leasingFeePercentOf(fee, subtotal);
  return percent > 0 ? `Лизингийн шимтгэл (${formatLeasingPercent(percent)}%)` : "Лизингийн шимтгэл";
}

export function leasingPercentTag(fee: number, subtotal: number): string {
  const percent = leasingFeePercentOf(fee, subtotal);
  return percent > 0 ? ` (${formatLeasingPercent(percent)}%)` : "";
}

export function fillLeasingCopy(
  template: string,
  vars: { percent: number; fee: number; feeText: string },
): string {
  return template
    .replaceAll("{percent}", formatLeasingPercent(vars.percent))
    .replaceAll("{rate}", formatLeasingPercent(vars.percent))
    .replaceAll("{fee}", vars.feeText);
}

type LeasingPayOrder = {
  isLeasing?: boolean;
  leasingFee?: number;
  leasingFeePaid?: boolean;
  leasingPrincipalDue?: number;
  nextPayAmount?: number;
  nextPayKind?: string;
  subtotal: number;
  dueAmount: number;
  storageFee?: number;
  cargoFee?: number;
  paidAmount?: number;
  refundedAmount?: number;
  shopDueAmount?: number;
  leasingDueAmount?: number;
};

/** Шимтгэл төлөгдөөгүй лизинг — ямагт 10%, хэзээ ч бүтэн дүн биш. */
export function leasingNowPayAmount(order: LeasingPayOrder): number {
  if (!order.isLeasing) return order.dueAmount;
  const fee =
    order.leasingFee && order.leasingFee > 0
      ? order.leasingFee
      : leasingFeeOf(order.subtotal);
  const feeDue = order.leasingFeePaid ? 0 : fee;
  if (feeDue > 0 || order.nextPayKind === "FEE") return feeDue || fee;
  return order.leasingPrincipalDue ?? order.nextPayAmount ?? order.dueAmount;
}

/** Үндсэн 100%-ийг хэрэглэгч өөрөө хувааж төлнө. */
export function isLeasingSplitPay(order: LeasingPayOrder): boolean {
  return Boolean(
    order.isLeasing &&
      order.nextPayKind !== "FEE" &&
      order.nextPayKind !== "BALANCE" &&
      (order.leasingFeePaid || order.nextPayKind === "PRINCIPAL") &&
      (order.leasingPrincipalDue ?? 0) > 0,
  );
}

/** Ирсэн = агуулахад эсвэл хүлээлгэн өгсөн. */
export function leasingGoodsArrived(status: string): boolean {
  return status === "ARRIVED" || status === "HANDED_OVER";
}

export function leasingArrivalUnpaid(status: string, dueAmount: number): boolean {
  return leasingGoodsArrived(status) && dueAmount > 0;
}

/** Үндсэн төлбөр дутуу бол бараа авч болохгүй — лизингийн данс тусдаа. */
export function leasingHoldsGoods(order: LeasingPayOrder): boolean {
  if (!order.isLeasing) return false;
  if ((order.leasingPrincipalDue ?? 0) > 0) return true;
  return order.nextPayKind === "FEE" || order.nextPayKind === "PRINCIPAL";
}

/** Лизингийн дансны үлдэгдэл (шимтгэл + үндсэн). */
export function leasingAccountDue(order: LeasingPayOrder): number {
  if (!order.isLeasing) return 0;
  if (order.leasingDueAmount != null) return Math.max(0, order.leasingDueAmount);
  const fee =
    order.leasingFee && order.leasingFee > 0
      ? order.leasingFee
      : leasingFeeOf(order.subtotal);
  const feeDue = order.leasingFeePaid ? 0 : fee;
  return feeDue + (order.leasingPrincipalDue ?? 0);
}

/**
 * Дэлгүүрийн кассанд авах дүн.
 * Лизингт бараа/шимтгэл өөр данс тул зөвхөн карго+агуулах үлдэнэ.
 */
export function shopDueOf(order: LeasingPayOrder): number {
  if (order.shopDueAmount != null) return Math.max(0, order.shopDueAmount);
  if (!order.isLeasing) return Math.max(0, order.dueAmount);
  const net = (order.paidAmount ?? 0) - (order.refundedAmount ?? 0);
  const fee =
    order.leasingFee && order.leasingFee > 0
      ? order.leasingFee
      : leasingFeeOf(order.subtotal);
  const towardShop = Math.max(0, net - fee - order.subtotal);
  return Math.max(0, (order.storageFee ?? 0) + (order.cargoFee ?? 0) - towardShop);
}

/** Хураангуй дээрх «одоо төлөх» дүн — лизингт нийт дүн биш. */
export function leasingDueHeadline(order: LeasingPayOrder & {
  paidAmount?: number;
  refundedAmount?: number;
}): { label: string; amount: number } {
  if (order.dueAmount <= 0) {
    return {
      label: "Төлсөн, бүтнээр",
      amount: (order.paidAmount ?? 0) - (order.refundedAmount ?? 0),
    };
  }
  if (!order.isLeasing) {
    return { label: "Шилжүүлэх үлдэгдэл", amount: order.dueAmount };
  }
  if (!order.leasingFeePaid || order.nextPayKind === "FEE") {
    const percent = leasingFeePercentOf(order.leasingFee ?? 0, order.subtotal);
    return {
      label: percent > 0 ? `Одоо төлөх (${formatLeasingPercent(percent)}%)` : "Одоо төлөх",
      amount: leasingNowPayAmount(order),
    };
  }
  if (isLeasingSplitPay(order)) {
    return {
      label: "Үлдэгдэл — хувааж төлнө",
      amount: order.leasingPrincipalDue ?? order.dueAmount,
    };
  }
  return { label: "Шилжүүлэх үлдэгдэл", amount: order.dueAmount };
}
