import type { Fulfilment, OrderStatus, Prisma } from '@prisma/client';

export type FulfilmentItem = {
  cancelledAt: Date | null;
  handedOverAt: Date | null;
  arrivedAt: Date | null;
  arrivedQty: number;
  fulfilment: Fulfilment | null;
};

/** Ирсэн, авгаагүй, авах арга сонгоогүй мөр. */
export function itemNeedsFulfilment(item: FulfilmentItem): boolean {
  if (item.cancelledAt || item.handedOverAt || item.fulfilment) return false;
  return item.arrivedAt !== null || item.arrivedQty > 0;
}

export function orderCanChooseFulfilment(order: {
  status: OrderStatus;
  items: FulfilmentItem[];
}): boolean {
  if (order.status !== 'ARRIVED') return false;
  return order.items.some(itemNeedsFulfilment);
}

/** Дэлгүүрт биеэр өгөх боломжтой — хүргэлтээр сонгогдсоныг хасна. */
export function itemPickableAtStore(item: FulfilmentItem): boolean {
  if (item.cancelledAt || !item.arrivedAt || item.handedOverAt) return false;
  return item.fulfilment !== 'DELIVERY';
}

/** Аль нэг мөр хүргэлт бол захиалга хүргэлтийн жагсаалтад үлдэнэ. */
export async function syncOrderFulfilment(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<Fulfilment | null> {
  const items = await tx.orderItem.findMany({
    where: { orderId, cancelledAt: null },
    select: { fulfilment: true },
  });
  const methods = items.map((i) => i.fulfilment).filter((v): v is Fulfilment => v !== null);
  const fulfilment: Fulfilment | null = methods.includes('DELIVERY')
    ? 'DELIVERY'
    : methods.includes('PICKUP')
      ? 'PICKUP'
      : null;
  await tx.order.update({ where: { id: orderId }, data: { fulfilment } });
  return fulfilment;
}
