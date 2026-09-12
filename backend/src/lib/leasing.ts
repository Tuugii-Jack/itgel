import { badRequest, forbidden } from './errors.js';
import { addDays, diffUbDays, startOfUbDay, ubDateString } from './date.js';

/**
 * Лизингийн төлбөр — үнийн шатлалаар шимтгэл + үндсэн 100%.
 * Тохиргоо байхгүй бол 10%. Энгийн захиалгын дүнд нөлөөлөхгүй.
 */
export const LEASING_FEE_RATE = 0.1;

export interface LeasingFeeTier {
  /** Энэ дүнгээс дээш (тухайн дүн орно). */
  minAmount: number;
  /** Барааны үнийн хувь (11 = 11%). */
  ratePercent: number;
}

/** Тохиргоо хоосон үед — хуучин 10%. */
export const FALLBACK_LEASING_FEE_TIERS: LeasingFeeTier[] = [
  { minAmount: 0, ratePercent: 10 },
];

/** Админд санал болгох шатлал. */
export const SUGGESTED_LEASING_FEE_TIERS: LeasingFeeTier[] = [
  { minAmount: 500_000, ratePercent: 11 },
  { minAmount: 400_000, ratePercent: 12 },
  { minAmount: 300_000, ratePercent: 13 },
  { minAmount: 200_000, ratePercent: 14 },
  { minAmount: 0, ratePercent: 15 },
];

export const DEFAULT_LEASING_CHOICE_HINT =
  'Эхлээд {percent}% шимтгэл, дараа нь үндсэн 100%-ийг хуваарьтай төлнө.';
export const DEFAULT_LEASING_TERMS_TITLE = 'Лизингийн нөхцөл';
export const DEFAULT_LEASING_TERMS_BODY =
  'Эхний төлөлт нь барааны үнийн {percent}% — лизингийн шимтгэл. Шимтгэл төлөгдсөний дараа барааны үндсэн 100%-ийг хуваарьтай төлнө. Сүүлийн төлөлт бараа ирэх үетэй давхцана. Шимтгэл нь барааны үнээс тусдаа.';

/** Үндсэн төлбөрийг 2–3 хуваах хоногийн зай. 5+8+8 = 21 хоног ≈ ирэх хугацаа. */
export const DEFAULT_LEASING_PAY_GAPS = [5, 8, 8];

export function leasingCopyOf(input: {
  leasingChoiceHint?: string | null;
  leasingTermsTitle?: string | null;
  leasingTermsBody?: string | null;
}): {
  choiceHint: string;
  termsTitle: string;
  termsBody: string;
} {
  return {
    choiceHint: input.leasingChoiceHint?.trim() || DEFAULT_LEASING_CHOICE_HINT,
    termsTitle: input.leasingTermsTitle?.trim() || DEFAULT_LEASING_TERMS_TITLE,
    termsBody: input.leasingTermsBody?.trim() || DEFAULT_LEASING_TERMS_BODY,
  };
}

/**
 * Захиалга дээрх шимтгэлийг хадгалсан хувиар үлдээнэ.
 * Шинэ тохиргоо хуучин захиалгын дүнг өөрчлөхгүй.
 */
export function leasingFeeSnapshot(input: {
  isLeasing: boolean;
  previousSubtotal: number;
  previousFee: number;
  nextSubtotal: number;
  fallbackFee: number;
}): number {
  if (!input.isLeasing) return 0;
  if (input.previousSubtotal > 0 && input.previousFee > 0) {
    return Math.round(input.nextSubtotal * (input.previousFee / input.previousSubtotal));
  }
  return input.fallbackFee;
}

function sortTiers(tiers: LeasingFeeTier[]): LeasingFeeTier[] {
  return [...tiers].sort((a, b) => b.minAmount - a.minAmount || a.ratePercent - b.ratePercent);
}

export function parseLeasingFeeTiers(raw: unknown): LeasingFeeTier[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...FALLBACK_LEASING_FEE_TIERS];
  const seen = new Set<number>();
  const parsed: LeasingFeeTier[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const minAmount = Math.round(Number((row as { minAmount?: unknown }).minAmount));
    const ratePercent = Number((row as { ratePercent?: unknown }).ratePercent);
    if (!Number.isFinite(minAmount) || minAmount < 0) continue;
    if (!Number.isFinite(ratePercent) || ratePercent < 0.1 || ratePercent > 100) continue;
    if (seen.has(minAmount)) continue;
    seen.add(minAmount);
    parsed.push({
      minAmount,
      ratePercent: Math.round(ratePercent * 10) / 10,
    });
  }
  if (parsed.length === 0) return [...FALLBACK_LEASING_FEE_TIERS];
  const sorted = sortTiers(parsed);
  if (!sorted.some((t) => t.minAmount === 0)) {
    sorted.push({ minAmount: 0, ratePercent: sorted[sorted.length - 1]!.ratePercent });
  }
  return sortTiers(sorted);
}

/** Хадгалахад шалгана — хоосон/давхардсан шатлал зөвшөөрөхгүй. */
export function assertLeasingFeeTiers(raw: unknown): LeasingFeeTier[] {
  if (!Array.isArray(raw) || raw.length < 1) {
    throw badRequest('Дор хаяж нэг шимтгэлийн шатлал оруулна уу.');
  }
  if (raw.length > 12) throw badRequest('Шатлал хамгийн ихдээ 12 байна.');
  const seen = new Set<number>();
  const parsed: LeasingFeeTier[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') throw badRequest('Шатлалын мөр буруу байна.');
    const minAmount = Math.round(Number((row as { minAmount?: unknown }).minAmount));
    const ratePercent = Number((row as { ratePercent?: unknown }).ratePercent);
    if (!Number.isInteger(minAmount) || minAmount < 0 || minAmount > 100_000_000) {
      throw badRequest('Шатлалын доод дүн 0–100,000,000₮ байх ёстой.');
    }
    if (!Number.isFinite(ratePercent) || ratePercent < 0.1 || ratePercent > 100) {
      throw badRequest('Шимтгэлийн хувь 0.1–100 байх ёстой.');
    }
    if (seen.has(minAmount)) throw badRequest('Шатлалын доод дүн давхардсан байна.');
    seen.add(minAmount);
    parsed.push({ minAmount, ratePercent: Math.round(ratePercent * 10) / 10 });
  }
  if (!parsed.some((t) => t.minAmount === 0)) {
    throw badRequest('0₮-ийн шатлал заавал байна — хамгийн бага үнийн хувь.');
  }
  return sortTiers(parsed);
}

export function leasingRatePercent(
  subtotal: number,
  tiers: LeasingFeeTier[] = FALLBACK_LEASING_FEE_TIERS,
): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
  const sorted = sortTiers(parseLeasingFeeTiers(tiers));
  return sorted.find((t) => subtotal >= t.minAmount)?.ratePercent ?? 0;
}

export function leasingFeeOf(
  subtotal: number,
  tiers: LeasingFeeTier[] = FALLBACK_LEASING_FEE_TIERS,
): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
  const rate = leasingRatePercent(subtotal, tiers);
  return Math.round(subtotal * (rate / 100));
}

/** Төлөөгүй захиалгын QPay ↔ лизинг шилжилт. */
export function leasingFlagOf(
  subtotal: number,
  leasing: boolean,
  tiers: LeasingFeeTier[] = FALLBACK_LEASING_FEE_TIERS,
): {
  isLeasing: boolean;
  leasingFee: number;
} {
  return {
    isLeasing: leasing,
    leasingFee: leasing ? leasingFeeOf(subtotal, tiers) : 0,
  };
}

export type LeasingPayKind = 'NONE' | 'FEE' | 'PRINCIPAL' | 'BALANCE';

export interface LeasingView {
  isLeasing: boolean;
  leasingFee: number;
  feePaid: boolean;
  feePaidAmount: number;
  feeDue: number;
  principalAmount: number;
  principalPaid: number;
  principalDue: number;
  nextPayAmount: number;
  nextPayKind: LeasingPayKind;
}

export function leasingView(order: {
  isLeasing?: boolean | null;
  leasingFee?: number | null;
  subtotal: number;
  paidAmount: number;
  refundedAmount: number;
  storageFee?: number | null;
  cargoFee?: number | null;
  dueAmount?: number | null;
  createdAt?: Date | string | null;
}): LeasingView {
  const isLeasing = Boolean(order.isLeasing);
  const stored = order.leasingFee ?? 0;
  const leasingFee = isLeasing
    ? stored > 0
      ? stored
      : leasingFeeOf(order.subtotal)
    : 0;
  const netPaid = order.paidAmount - order.refundedAmount;
  const feePaidAmount = Math.min(Math.max(0, netPaid), leasingFee);
  const feeDue = Math.max(0, leasingFee - feePaidAmount);
  const feePaid = leasingFee > 0 && feeDue === 0;
  const principalPaid = Math.min(Math.max(0, netPaid - leasingFee), order.subtotal);
  const principalDue = Math.max(0, order.subtotal - principalPaid);
  const dueAmount =
    order.dueAmount ??
    order.subtotal +
      leasingFee +
      (order.storageFee ?? 0) +
      (order.cargoFee ?? 0) -
      netPaid;
  const remaining = Math.max(0, dueAmount);

  let nextPayKind: LeasingPayKind = 'NONE';
  let nextPayAmount = 0;
  if (remaining > 0) {
    if (isLeasing && feeDue > 0) {
      nextPayKind = 'FEE';
      nextPayAmount = feeDue;
    } else if (isLeasing && principalDue > 0) {
      nextPayKind = 'PRINCIPAL';
      nextPayAmount = Math.min(principalDue, remaining);
    } else {
      nextPayKind = 'BALANCE';
      nextPayAmount = remaining;
    }
  }

  return {
    isLeasing,
    leasingFee,
    feePaid,
    feePaidAmount,
    feeDue,
    principalAmount: order.subtotal,
    principalPaid,
    principalDue,
    nextPayAmount,
    nextPayKind,
  };
}

/** Шимтгэл төлөгдөөгүй лизинг — захиалга хараахан баталгаажаагүй. */
export function leasingFeeHold(order: Parameters<typeof leasingView>[0]): boolean {
  const view = leasingView(order);
  return view.isLeasing && !view.feePaid;
}

/**
 * Шимтгэл 0₮ — захиалга админд үүсээгүй.
 * `confirmLeasingIfFeePaid` шимтгэл ормогц CONFIRMED болгодог тул
 * NEW + paidAmount 0 нь энэ төлөвийн Prisma шүүлт.
 */
export const LEASING_FEE_HOLD_FILTER = {
  status: 'NEW' as const,
  paidAmount: 0 as const,
};

export const LEASING_FEE_HOLD_WHERE = {
  isLeasing: true as const,
  ...LEASING_FEE_HOLD_FILTER,
};

/** Дэлгүүрийн админ — лизинг захиалга харагдахгүй. */
export const SHOP_STAFF_ORDER_WHERE = { isLeasing: false as const };

/** Лизингийн админ — шимтгэл төлөгдсөний дараа. */
export const LEASING_STAFF_ORDER_WHERE = {
  isLeasing: true as const,
  NOT: LEASING_FEE_HOLD_FILTER,
};

export function parseLeasingPayGaps(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length < 2) return [...DEFAULT_LEASING_PAY_GAPS];
  const gaps = raw
    .map((n) => Math.round(Number(n)))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 60);
  if (gaps.length < 2 || gaps.length > 3) return [...DEFAULT_LEASING_PAY_GAPS];
  return gaps;
}

export function assertLeasingPayGaps(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 3) {
    throw badRequest('Үндсэн төлбөрийг 2 эсвэл 3 хуваана. Хоногийн зайг оруулна уу.');
  }
  const gaps = raw.map((n) => Math.round(Number(n)));
  if (gaps.some((n) => !Number.isInteger(n) || n < 1 || n > 60)) {
    throw badRequest('Хоногийн зай 1–60 хоног байна.');
  }
  const sum = gaps.reduce((a, b) => a + b, 0);
  if (sum < 7 || sum > 90) throw badRequest('Нийт хугацаа 7–90 хоног байна.');
  return gaps;
}

/** Нийт дүнг n хуваарьт хуваана. Үлдэгдэл сүүлийн төлөлт дээр. */
export function splitEven(total: number, parts: number): number[] {
  if (parts < 1 || total <= 0) return [];
  const base = Math.floor(total / parts);
  const rem = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i === parts - 1 ? rem : 0));
}

export type LeasingPlanStepStatus = 'paid' | 'due_today' | 'overdue' | 'upcoming';

export interface LeasingPlanStep {
  kind: 'FEE' | 'INSTALLMENT';
  index: number;
  daysFromStart: number;
  dueDay: string;
  amount: number;
  paidAmount: number;
  remaining: number;
  status: LeasingPlanStepStatus;
  isLast: boolean;
}

export interface LeasingPayPlan {
  gaps: number[];
  totalDays: number;
  steps: LeasingPlanStep[];
  overdue: boolean;
  dueToday: boolean;
  nextAmount: number;
}

export function buildLeasingPayPlan(input: {
  isLeasing?: boolean | null;
  createdAt?: Date | string | null;
  subtotal: number;
  leasingFee?: number | null;
  paidAmount: number;
  refundedAmount: number;
  payGaps?: number[] | null;
  now?: Date;
}): LeasingPayPlan | null {
  if (!input.isLeasing) return null;
  const gaps = parseLeasingPayGaps(input.payGaps);
  const start = startOfUbDay(input.createdAt ? new Date(input.createdAt) : (input.now ?? new Date()));
  const today = startOfUbDay(input.now ?? new Date());
  const view = leasingView(input);
  const parts = splitEven(input.subtotal, gaps.length);
  const raw: Omit<LeasingPlanStep, 'paidAmount' | 'remaining' | 'status'>[] = [
    {
      kind: 'FEE',
      index: 0,
      daysFromStart: 0,
      dueDay: ubDateString(start),
      amount: view.leasingFee,
      isLast: false,
    },
  ];
  let acc = 0;
  for (let i = 0; i < gaps.length; i++) {
    acc += gaps[i]!;
    raw.push({
      kind: 'INSTALLMENT',
      index: i + 1,
      daysFromStart: acc,
      dueDay: ubDateString(addDays(start, acc)),
      amount: parts[i] ?? 0,
      isLast: i === gaps.length - 1,
    });
  }

  let leftover = Math.max(0, input.paidAmount - input.refundedAmount);
  const steps: LeasingPlanStep[] = raw.map((step) => {
    const paidAmount = Math.min(leftover, step.amount);
    leftover -= paidAmount;
    const remaining = step.amount - paidAmount;
    let status: LeasingPlanStepStatus = 'upcoming';
    if (remaining <= 0) status = 'paid';
    else {
      const due = startOfUbDay(new Date(`${step.dueDay}T12:00:00+08:00`));
      const diff = diffUbDays(today, due);
      if (diff > 0) status = 'overdue';
      else if (diff === 0) status = 'due_today';
      else status = 'upcoming';
    }
    return { ...step, paidAmount, remaining, status };
  });

  const next = steps.find((s) => s.remaining > 0);
  return {
    gaps,
    totalDays: acc,
    steps,
    overdue: steps.some((s) => s.status === 'overdue'),
    dueToday: steps.some((s) => s.status === 'due_today'),
    nextAmount: next?.remaining ?? 0,
  };
}

export function serializeLeasing(
  order: Parameters<typeof leasingView>[0],
  payGaps?: number[] | null,
) {
  const view = leasingView(order);
  const payPlan = view.isLeasing ? buildLeasingPayPlan({ ...order, payGaps }) : null;
  return {
    isLeasing: view.isLeasing,
    leasingFee: view.leasingFee,
    leasingFeePaid: view.feePaid,
    leasingFeePaidAmount: view.feePaidAmount,
    leasingPrincipalPaid: view.principalPaid,
    leasingPrincipalDue: view.principalDue,
    leasingDueAmount: view.feeDue + view.principalDue,
    nextPayAmount: view.nextPayKind === 'PRINCIPAL' && payPlan?.nextAmount
      ? Math.min(view.nextPayAmount, payPlan.nextAmount)
      : view.nextPayAmount,
    nextPayKind: view.nextPayKind,
    payPlan,
  };
}

/**
 * QPay нэхэмжлэлийн дүн.
 * Шимтгэл төлөгдөөгүй бол тохиргооны хувь. Үндсэн төлбөрт `requested` заавал.
 * Карго/агуулахын үлдэгдэл (`BALANCE`) дүнгүйгээр үлдэгдлийг нэхэмжилнэ.
 */
export function resolveInvoiceAmount(
  view: LeasingView,
  requested?: number | null,
  scheduledNext?: number | null,
): { amount: number; kind: LeasingPayKind } {
  if (view.nextPayAmount <= 0 || view.nextPayKind === 'NONE') {
    return { amount: 0, kind: 'NONE' };
  }
  if (!view.isLeasing || view.nextPayKind === 'FEE' || view.nextPayKind === 'BALANCE') {
    return {
      amount: view.nextPayKind === 'FEE' ? view.feeDue : view.nextPayAmount,
      kind: view.nextPayKind,
    };
  }
  const max = view.nextPayAmount;
  if (requested == null || !Number.isFinite(requested)) {
    const scheduled = scheduledNext != null ? Math.round(scheduledNext) : 0;
    return {
      amount: scheduled > 0 ? Math.min(scheduled, max) : 0,
      kind: view.nextPayKind,
    };
  }
  const n = Math.round(requested);
  if (n < 1) return { amount: 0, kind: view.nextPayKind };
  return { amount: Math.min(n, max), kind: view.nextPayKind };
}

/** Үндсэн төлбөр дутуу бол бараа өгөхгүй — лизингийн данс тусдаа. */
export function leasingHoldsGoods(order: Parameters<typeof leasingView>[0]): boolean {
  const view = leasingView(order);
  return view.isLeasing && view.principalDue > 0;
}

/** Ирсэн = агуулахад эсвэл хүлээлгэн өгсөн. Цуцлагдсаныг энд оруулахгүй. */
export const LEASING_ARRIVED_STATUSES = ['ARRIVED', 'HANDED_OVER'] as const;
export const LEASING_NOT_ARRIVED_STATUSES = [
  'NEW',
  'CONFIRMED',
  'IN_BATCH',
  'IN_TRANSIT',
] as const;

export type LeasingGoodsFilter =
  | 'all'
  | 'arrived'
  | 'not_arrived'
  | 'arrived_unpaid'
  | 'arrived_paid';

export function leasingGoodsWhere(goods: LeasingGoodsFilter): {
  status?: { in: string[] };
  dueAmount?: { gt: number } | { lte: number };
} {
  if (goods === 'all') return {};
  if (goods === 'not_arrived') {
    return { status: { in: [...LEASING_NOT_ARRIVED_STATUSES] } };
  }
  const arrived = { status: { in: [...LEASING_ARRIVED_STATUSES] } };
  if (goods === 'arrived_unpaid') return { ...arrived, dueAmount: { gt: 0 } };
  if (goods === 'arrived_paid') return { ...arrived, dueAmount: { lte: 0 } };
  return arrived;
}

/** Лизинг захиалгын мөнгийг зөвхөн лизингийн админ бүртгэнэ. */
export function canWriteLeasingOrderMoney(isLeasing: boolean, role?: string): boolean {
  if (isLeasing !== true) return true;
  return role === 'LEASING';
}

export function assertCanWriteLeasingOrderMoney(isLeasing: boolean, role?: string): void {
  if (!canWriteLeasingOrderMoney(isLeasing, role)) {
    throw forbidden('Лизинг захиалгын төлбөрийг зөвхөн лизингийн админ бүртгэнэ.');
  }
}
