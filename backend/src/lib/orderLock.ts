import type { Prisma } from '@prisma/client';

/** Hold until COMMIT. SELECT FOR UPDATE on the transaction connection. */
export async function lockOrder(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
}

export async function lockOrders(tx: Prisma.TransactionClient, orderIds: string[]): Promise<void> {
  const ids = [...new Set(orderIds)].sort();
  for (const id of ids) {
    await lockOrder(tx, id);
  }
}

export async function lockRounds(tx: Prisma.TransactionClient, roundIds: string[]): Promise<void> {
  const ids = [...new Set(roundIds)].sort();
  for (const id of ids) {
    await tx.$queryRaw`SELECT "id" FROM "ProductRound" WHERE "id" = ${id} FOR UPDATE`;
  }
}
