import { forbidden } from './errors.js';

/**
 * Лизингийн төлбөр — барааны үнийн 10% шимтгэл + 100% үндсэн төлбөр.
 * Энгийн захиалгын дүнд нөлөөлөхгүй (`isLeasing` false үед шимтгэл 0).
 */
export const LEASING_FEE_RATE = 0.1;

export function leasingFeeOf(subtotal: number): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
  return Math.round(subtotal * LEASING_FEE_RATE);
}

/** Төлөөгүй захиалгын QPay ↔ лизинг шилжилт. */
export function leasingFlagOf(subtotal: number, leasing: boolean): {
  isLeasing: boolean;
  leasingFee: number;
} {
  return {
    isLeasing: leasing,
    leasingFee: leasing ? leasingFeeOf(subtotal) : 0,
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

export function serializeLeasing(order: Parameters<typeof leasingView>[0]) {
  const view = leasingView(order);
  return {
    isLeasing: view.isLeasing,
    leasingFee: view.leasingFee,
    leasingFeePaid: view.feePaid,
    leasingFeePaidAmount: view.feePaidAmount,
    leasingPrincipalPaid: view.principalPaid,
    leasingPrincipalDue: view.principalDue,
    nextPayAmount: view.nextPayAmount,
    nextPayKind: view.nextPayKind,
  };
}

/**
 * QPay нэхэмжлэлийн дүн.
 * Шимтгэл төлөгдөөгүй бол ямагт 10%. Үндсэн төлбөрт `requested` заавал.
 * Карго/агуулахын үлдэгдэл (`BALANCE`) дүнгүйгээр үлдэгдлийг нэхэмжилнэ.
 */
export function resolveInvoiceAmount(
  view: LeasingView,
  requested?: number | null,
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
    return { amount: 0, kind: view.nextPayKind };
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
