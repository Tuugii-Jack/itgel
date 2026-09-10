import type { OrderStatus } from "./types";

export const ORDER_STAGES = [
  { key: "placed", label: "Захиалсан" },
  { key: "transit", label: "Замд" },
  { key: "arrived", label: "Гарт очсон" },
] as const;

/**
 * 6 дотоод төлвийг хэрэглэгчийн гурван шат болгоно.
 * Цуцлагдсан захиалгад аль ч шат гэрэлтэхгүй.
 */
export function buildOrderStages(status: OrderStatus) {
  const reachedIndex: Record<OrderStatus, number> = {
    NEW: 0,
    CONFIRMED: 0,
    IN_BATCH: 1,
    IN_TRANSIT: 1,
    ARRIVED: 2,
    HANDED_OVER: 2,
    CANCELLED: -1,
  };
  const at = reachedIndex[status];
  return ORDER_STAGES.map((stage, i) => ({ ...stage, reached: i <= at }));
}
