import { Prisma } from '@prisma/client';

/** Hold until transaction commit: money and fulfilment must see the same order state. */
export async function lockOrder(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
}

export async function lockOrders(tx: Prisma.TransactionClient, orderIds: string[]): Promise<void> {
  const ids = [...new Set(orderIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
}
