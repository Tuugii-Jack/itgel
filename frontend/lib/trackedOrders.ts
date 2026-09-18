import type { MyOrder, PublicOrder } from "./types";

/** One cache per mounted customer scope; never share it between accounts. */
export function createTrackedOrderCache(loadOrder: (code: string) => Promise<PublicOrder>) {
  const orders = new Map<string, PublicOrder>();
  const inflight = new Map<string, Promise<PublicOrder>>();
  const normalize = (code: string) => code.trim().toUpperCase();

  const peek = (code: string): PublicOrder | null => orders.get(normalize(code)) ?? null;

  const fetch = (code: string): Promise<PublicOrder> => {
    const key = normalize(code);
    const pending = inflight.get(key);
    if (pending) return pending;
    const request = loadOrder(key)
      .then((order) => {
        orders.set(key, order);
        return order;
      })
      .catch((error: unknown) => {
        orders.delete(key);
        throw error;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, request);
    return request;
  };

  const prefetch = (code: string): void => {
    if (peek(code) || inflight.has(normalize(code))) return;
    void fetch(code).catch(() => undefined);
  };

  const remember = (order: PublicOrder): void => {
    orders.set(normalize(order.code), order);
  };

  return { peek, fetch, prefetch, remember };
}

/**
 * Төлбөр баталгаажсан захиалгын дүнг зөвхөн энэ жагсаалтын тохирох мөрөнд бичнэ.
 * Өөр хэрэглэгчийн жагсаалт эсвэл өөр код руу нэмэхгүй.
 */
export function patchMyOrderList(orders: MyOrder[], next: PublicOrder): MyOrder[] {
  const code = next.code.trim().toUpperCase();
  let changed = false;
  const patched = orders.map((row) => {
    if (row.code.toUpperCase() !== code) return row;
    changed = true;
    return {
      ...row,
      status: next.status,
      statusLabel: next.statusLabel,
      subtotal: next.subtotal,
      deliveryFee: next.deliveryFee,
      storageFee: next.storageFee,
      cargoFee: next.cargoFee,
      cargoPayMethod: next.cargoPayMethod,
      paidAmount: next.paidAmount,
      refundedAmount: next.refundedAmount,
      dueAmount: next.dueAmount,
      paymentState: next.paymentState,
      isLeasing: next.isLeasing,
      leasingFee: next.leasingFee,
      leasingFeePaid: next.leasingFeePaid,
      leasingPrincipalDue: next.leasingPrincipalDue,
      nextPayAmount: next.nextPayAmount,
      nextPayKind: next.nextPayKind,
      payPlan: next.payPlan,
      fulfilment: next.fulfilment,
      canChooseFulfilment: next.canChooseFulfilment,
      items: next.items,
      refundPayoutOn: next.refundPayoutOn,
      refundPaid: next.refundPaid,
      delivery: next.delivery,
      timeline: next.timeline,
      createdAt: next.createdAt,
    };
  });
  return changed ? patched : orders;
}

/** Temporary network failures may keep the current view, denied access may not. */
export function trackedOrderAfterError(
  current: PublicOrder | null,
  error: unknown,
): PublicOrder | null {
  if (
    error !== null &&
    typeof error === "object" &&
    "status" in error &&
    (error.status === 401 || error.status === 403 || error.status === 404)
  ) {
    return null;
  }
  return current;
}
