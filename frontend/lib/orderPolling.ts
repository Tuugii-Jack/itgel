import type { PublicOrder } from "./types";

type PollOrder = Pick<
  PublicOrder,
  | "status"
  | "paymentState"
  | "dueAmount"
  | "isLeasing"
  | "cargoPayMethod"
  | "fulfilment"
  | "paidAmount"
  | "refundedAmount"
  | "subtotal"
  | "nextPayKind"
> & {
  leasingFeePaid?: boolean;
  payPlan?: { overdue?: boolean; dueToday?: boolean } | null;
};

function awaitingPayment(state: PollOrder["paymentState"]): boolean {
  return state === "UNPAID" || state === "PARTIAL";
}

function feeHold(order: PollOrder): boolean {
  if (!order.isLeasing) return false;
  if (order.nextPayKind === "FEE") return true;
  return !order.leasingFeePaid;
}

/**
 * Track дээр QPay самбар харагдах эсэх — урьдчилж төлөх QR хэвээр.
 * Нийт үлдэгдэлтэй лизингийг эндээс хасна гэсэн үг биш.
 */
export function isTrackPaymentOpen(order: PollOrder | null | undefined): boolean {
  if (!order || order.status === "CANCELLED") return false;
  if (!awaitingPayment(order.paymentState) || order.dueAmount <= 0) return false;
  if (order.cargoPayMethod === "CASH") return false;
  if (order.isLeasing) return true;
  if (order.fulfilment === "PICKUP") return false;
  if (
    order.paidAmount - order.refundedAmount >= order.subtotal &&
    (order.status === "IN_BATCH" ||
      order.status === "IN_TRANSIT" ||
      (order.status === "ARRIVED" && order.fulfilment === null))
  ) {
    return false;
  }
  return true;
}

/**
 * Автомат poll — одоо хүлээгдэж буй төлбөр.
 * Лизингийн нийт үлдэгдэл эсвэл upcoming хуваарь энэ биш.
 * Урьдчилж төлөх QR хэвээр. Хэрэглэгч өөрөө оролдсон үед л leftover-ийг
 * хязгаартай шалгана — автомат invoice үүссэн нь оролдлого биш.
 */
export function shouldPollPayment(
  order: PollOrder | null | undefined,
  intent?: { prepayAttemptAtPaid?: number | null },
): boolean {
  if (!order || order.status === "CANCELLED") return false;
  if (feeHold(order)) return true;
  if (!order.isLeasing) {
    return isTrackPaymentOpen(order);
  }
  if (order.nextPayKind === "BALANCE" && order.dueAmount > 0) return true;
  if (order.payPlan?.overdue || order.payPlan?.dueToday) return true;
  const snapshot = intent?.prepayAttemptAtPaid;
  if (
    snapshot != null &&
    awaitingPayment(order.paymentState) &&
    order.dueAmount > 0 &&
    order.paidAmount <= snapshot
  ) {
    return true;
  }
  return false;
}

export function shouldPollSuccess(
  order: PollOrder | null | undefined,
  extra: PollOrder | PollOrder[] | null | undefined = null,
): boolean {
  const one = (row: PollOrder | null | undefined): boolean => {
    if (!row || row.status === "CANCELLED") return false;
    if (feeHold(row)) return true;
    return !row.isLeasing && awaitingPayment(row.paymentState) && row.dueAmount > 0;
  };
  const extras = Array.isArray(extra) ? extra : extra ? [extra] : [];
  return one(order) || extras.some(one);
}
