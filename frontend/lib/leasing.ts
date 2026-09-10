import { dayKey, daysBetween } from "@/lib/format";
import type { LeasingPayPlan, LeasingPlanStep, LeasingPlanStepStatus } from "@/lib/types";

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
  "Эхлээд {percent}% шимтгэл, дараа нь үндсэн 100%-ийг хуваарьтай төлнө.";
export const DEFAULT_LEASING_TERMS_TITLE = "Лизингийн нөхцөл";
export const DEFAULT_LEASING_TERMS_BODY =
  "Эхний төлөлт нь барааны үнийн {percent}% — лизингийн шимтгэл. Шимтгэл төлөгдсөний дараа барааны үндсэн 100%-ийг хуваарьтай төлнө. Сүүлийн төлөлт бараа ирэх үетэй давхцана. Шимтгэл нь барааны үнээс тусдаа.";

/** Үндсэн төлбөрийг 2–3 хуваах хоногийн зай. 5+8+8 = 21 хоног. */
export const DEFAULT_LEASING_PAY_GAPS = [5, 8, 8];

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
  payPlan?: LeasingPayPlan | null;
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
  if (order.payPlan?.nextAmount) return order.payPlan.nextAmount;
  return order.nextPayAmount ?? order.leasingPrincipalDue ?? order.dueAmount;
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

/** Шимтгэл төлөгдөөгүй лизинг — захиалга хараахан үүсээгүй. */
export function leasingFeeHold(order: Pick<LeasingPayOrder, "isLeasing" | "leasingFeePaid" | "nextPayKind">): boolean {
  if (!order.isLeasing) return false;
  if (order.nextPayKind === "FEE") return true;
  return !order.leasingFeePaid;
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
    const amount = order.payPlan?.nextAmount ?? order.nextPayAmount ?? order.leasingPrincipalDue ?? order.dueAmount;
    const label = order.payPlan?.overdue
      ? "Хоцорсон төлөлт"
      : order.payPlan?.dueToday
        ? "Өнөөдөр төлөх"
        : "Дараагийн төлөлт";
    return { label, amount };
  }
  return { label: "Шилжүүлэх үлдэгдэл", amount: order.dueAmount };
}

export function parseLeasingPayGaps(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length < 2) return [...DEFAULT_LEASING_PAY_GAPS];
  const gaps = raw
    .map((n) => Math.round(Number(n)))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 60);
  if (gaps.length < 2 || gaps.length > 3) return [...DEFAULT_LEASING_PAY_GAPS];
  return gaps;
}

/** Нийт дүнг n хуваарьт хуваана. Үлдэгдэл сүүлийн төлөлт дээр. */
export function splitEven(total: number, parts: number): number[] {
  if (parts < 1 || total <= 0) return [];
  const base = Math.floor(total / parts);
  const rem = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i === parts - 1 ? rem : 0));
}

function addCalendarDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

export function buildLeasingPayPlan(input: {
  isLeasing?: boolean | null;
  createdAt?: string | Date | null;
  subtotal: number;
  leasingFee?: number | null;
  paidAmount?: number;
  refundedAmount?: number;
  payGaps?: number[] | null;
  now?: Date;
}): LeasingPayPlan | null {
  if (!input.isLeasing) return null;
  const gaps = parseLeasingPayGaps(input.payGaps);
  const now = input.now ?? new Date();
  const startDay = dayKey(input.createdAt ? new Date(input.createdAt) : now);
  const today = dayKey(now);
  const fee =
    input.leasingFee && input.leasingFee > 0
      ? input.leasingFee
      : leasingFeeOf(input.subtotal);
  const parts = splitEven(input.subtotal, gaps.length);
  const raw: Omit<LeasingPlanStep, "paidAmount" | "remaining" | "status">[] = [
    {
      kind: "FEE",
      index: 0,
      daysFromStart: 0,
      dueDay: startDay,
      amount: fee,
      isLast: false,
    },
  ];
  let acc = 0;
  for (let i = 0; i < gaps.length; i++) {
    acc += gaps[i]!;
    raw.push({
      kind: "INSTALLMENT",
      index: i + 1,
      daysFromStart: acc,
      dueDay: addCalendarDays(startDay, acc),
      amount: parts[i] ?? 0,
      isLast: i === gaps.length - 1,
    });
  }

  let leftover = Math.max(0, (input.paidAmount ?? 0) - (input.refundedAmount ?? 0));
  const steps: LeasingPlanStep[] = raw.map((step) => {
    const paidAmount = Math.min(leftover, step.amount);
    leftover -= paidAmount;
    const remaining = step.amount - paidAmount;
    let status: LeasingPlanStepStatus = "upcoming";
    if (remaining <= 0) status = "paid";
    else {
      const diff = daysBetween(`${today}T12:00:00+08:00`, `${step.dueDay}T12:00:00+08:00`);
      if (diff > 0) status = "overdue";
      else if (diff === 0) status = "due_today";
      else status = "upcoming";
    }
    return { ...step, paidAmount, remaining, status };
  });

  const next = steps.find((s) => s.remaining > 0);
  return {
    gaps,
    totalDays: acc,
    steps,
    overdue: steps.some((s) => s.status === "overdue"),
    dueToday: steps.some((s) => s.status === "due_today"),
    nextAmount: next?.remaining ?? 0,
  };
}

export function leasingStepWhen(step: LeasingPlanStep): string {
  if (step.kind === "FEE") {
    if (step.status === "paid") return "Захиалга өгөхдөө";
    return "Одоо";
  }
  if (step.status === "due_today") return "Өнөөдөр";
  if (step.status === "overdue") {
    return step.daysFromStart > 0 ? `${step.daysFromStart} хоногийн хуваарь · хоцорсон` : "Хоцорсон";
  }
  if (step.isLast) return `${step.daysFromStart} хоногийн дараа · бараа ирэх үе`;
  return `${step.daysFromStart} хоногийн дараа`;
}

export function leasingStepTitle(step: LeasingPlanStep, totalInstallments: number): string {
  if (step.kind === "FEE") return "Лизингийн шимтгэл";
  if (step.isLast) return `Сүүлийн төлөлт · үндсэн ${step.index}/${totalInstallments}`;
  return `Үндсэн ${step.index}/${totalInstallments}`;
}

export function leasingStepStatusLabel(status: LeasingPlanStepStatus): string {
  if (status === "paid") return "Төлсөн";
  if (status === "due_today") return "Өнөөдөр";
  if (status === "overdue") return "Төлөгдөөгүй";
  return "Хүлээгдэж буй";
}

export function leasingScheduleAlert(
  plan?: LeasingPayPlan | null,
): "overdue" | "due_today" | null {
  if (!plan) return null;
  if (plan.overdue) return "overdue";
  if (plan.dueToday) return "due_today";
  return null;
}
