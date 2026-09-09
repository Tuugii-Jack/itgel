/** Лизингийн шимтгэл — барааны үнийн 10%. Backend-тэй ижил. */
export const LEASING_FEE_RATE = 0.1;

export function leasingFeeOf(subtotal: number): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
  return Math.round(subtotal * LEASING_FEE_RATE);
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
    return { label: "Одоо төлөх (10%)", amount: leasingNowPayAmount(order) };
  }
  if (isLeasingSplitPay(order)) {
    return {
      label: "Үлдэгдэл — хувааж төлнө",
      amount: order.leasingPrincipalDue ?? order.dueAmount,
    };
  }
  return { label: "Шилжүүлэх үлдэгдэл", amount: order.dueAmount };
}
