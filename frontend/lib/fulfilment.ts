import type { Fulfilment, OrderItem } from "@/lib/types";

export const ITEM_FULFILMENT_LABEL: Record<Fulfilment, string> = {
  PICKUP: "Очиж авах",
  DELIVERY: "Хүргэлт",
};

/** Ирсэн, авгаагүй, авах арга сонгоогүй мөр. */
export function itemNeedsFulfilment(item: OrderItem): boolean {
  if (item.cancelled || item.itemStatus === "cancelled" || item.itemStatus === "handed_over") {
    return false;
  }
  if (item.fulfilment) return false;
  return item.itemStatus === "arrived" || (item.arrivedQty ?? 0) > 0;
}

export function orderHasPickup(order: {
  fulfilment: Fulfilment | null;
  items: OrderItem[];
}): boolean {
  if (order.items.some((item) => !item.cancelled && item.fulfilment === "PICKUP")) return true;
  return (
    order.fulfilment === "PICKUP" &&
    !order.items.some((item) => item.fulfilment === "DELIVERY")
  );
}
