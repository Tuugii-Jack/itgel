import type { PublicOrder } from "@/lib/types";

export function lineCargo(item: PublicOrder["items"][number]): number {
  return Math.max(0, item.cargoFee ?? 0);
}

export function unpaidTowardCargo(
  order: PublicOrder,
  cargoFee: number,
  ignoreStorage = false,
): number {
  if (cargoFee <= 0) return 0;
  const netPaid = order.paidAmount - order.refundedAmount;
  const storage = ignoreStorage ? 0 : (order.storageFee ?? 0);
  const leasing = order.isLeasing ? (order.leasingFee ?? 0) : 0;
  const towardCargo = Math.max(0, netPaid - order.subtotal - leasing - storage);
  return Math.max(0, cargoFee - towardCargo);
}
