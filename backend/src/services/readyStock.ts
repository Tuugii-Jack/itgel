import type { Prisma, ProductStatus } from '@prisma/client';
import { conflict } from '../lib/errors.js';
import { findSku, skuKeyOf } from '../lib/skuStock.js';
import { selectionsOf } from '../lib/options.js';

type Tx = Prisma.TransactionClient;

export type ReadyRound = {
  id: string;
  closeAt: Date | null;
  status: ProductStatus;
  stock: number;
  reserved?: number;
  available?: number;
  product?: { name: string };
  skuStocks: { id: string; skuKey: string; stock: number; reserved?: number; available?: number }[];
};

function soldOutStatus(status: ProductStatus): ProductStatus {
  return status === 'HIDDEN' || status === 'DRAFT' || status === 'ARCHIVED' || status === 'CLOSED'
    ? status
    : 'SOLD_OUT';
}

function activeStatus(status: ProductStatus): ProductStatus {
  return status === 'SOLD_OUT' ? 'ACTIVE' : status;
}

async function maybeMarkSoldOut(tx: Tx, roundId: string): Promise<void> {
  const round = await tx.productRound.findUniqueOrThrow({
    where: { id: roundId },
    select: { id: true, skuStocks: true, available: true, status: true, closeAt: true },
  });
  if (round.closeAt !== null) return;
  const available =
    round.skuStocks.length > 0
      ? round.skuStocks.reduce((sum, row) => sum + row.available, 0)
      : round.available;
  if (available <= 0) {
    if (round.status === 'ACTIVE') {
      await tx.productRound.update({
        where: { id: round.id },
        data: { status: soldOutStatus(round.status) },
      });
    }
    return;
  }
  if (round.status === 'SOLD_OUT') {
    await tx.productRound.update({
      where: { id: round.id },
      data: { status: activeStatus(round.status) },
    });
  }
}

async function bumpSku(
  tx: Tx,
  row: { id: string },
  qty: number,
  where: Prisma.RoundSkuStockWhereInput,
  data: Prisma.RoundSkuStockUpdateManyMutationInput,
  emptyMessage: string,
): Promise<void> {
  const updated = await tx.roundSkuStock.updateMany({
    where: { id: row.id, ...where },
    data,
  });
  if (updated.count !== 1) throw conflict(emptyMessage);
}

/**
 * Төлбөр хүлээгдэж буй бэлэн барааг түр нөөцлөнө. Агуулахад байгаа `stock` хасагдахгүй.
 */
export async function reserveReadyStock(
  tx: Tx,
  round: ReadyRound,
  qty: number,
  selections: Record<string, string>,
): Promise<void> {
  if (round.closeAt !== null || qty <= 0) return;
  const sku = findSku(round.skuStocks, selections);
  if (round.skuStocks.length > 0) {
    if (!sku) {
      throw conflict(
        `${round.product?.name ?? 'Бараа'}: энэ сонголтын үлдэгдэл бүртгэгдээгүй байна.`,
      );
    }
    await bumpSku(
      tx,
      sku,
      qty,
      { available: { gte: qty } },
      { reserved: { increment: qty }, available: { decrement: qty } },
      `${round.product?.name ?? 'Бараа'}: үлдэгдэл хүрэлцэхгүй.`,
    );
  }

  const updated = await tx.productRound.updateMany({
    where: { id: round.id, available: { gte: qty } },
    data: { reserved: { increment: qty }, available: { decrement: qty } },
  });
  if (updated.count !== 1) {
    throw conflict(`${round.product?.name ?? 'Бараа'}: үлдэгдэл хүрэлцэхгүй.`);
  }
  await maybeMarkSoldOut(tx, round.id);
}

/**
 * Нөөцлөгдсөн барааг борлуулсан болгоно. available аль хэдийн буурсан тул дахин хасахгүй.
 */
export async function commitReadyStock(
  tx: Tx,
  round: ReadyRound,
  qty: number,
  selections: Record<string, string>,
): Promise<void> {
  if (round.closeAt !== null || qty <= 0) return;
  const sku = findSku(round.skuStocks, selections);
  if (round.skuStocks.length > 0) {
    if (!sku) throw conflict('Энэ сонголтын үлдэгдэл бүртгэгдээгүй байна.');
    await bumpSku(
      tx,
      sku,
      qty,
      { reserved: { gte: qty }, stock: { gte: qty } },
      { reserved: { decrement: qty }, stock: { decrement: qty } },
      `${round.product?.name ?? 'Бараа'}: нөөцлөгдсөн үлдэгдэл хүрэлцэхгүй.`,
    );
  }
  const updated = await tx.productRound.updateMany({
    where: { id: round.id, reserved: { gte: qty }, stock: { gte: qty } },
    data: { reserved: { decrement: qty }, stock: { decrement: qty } },
  });
  if (updated.count !== 1) {
    throw conflict(`${round.product?.name ?? 'Бараа'}: нөөцлөгдсөн үлдэгдэл хүрэлцэхгүй.`);
  }
  await maybeMarkSoldOut(tx, round.id);
}

/** Цуцлалт — түр нөөцийг чөлөөлнө. stock нэмэгдэхгүй. */
export async function releaseReadyStock(
  tx: Tx,
  round: ReadyRound,
  qty: number,
  selections: Record<string, string>,
): Promise<void> {
  if (round.closeAt !== null || qty <= 0) return;
  const sku = findSku(round.skuStocks, selections);
  if (sku) {
    await tx.roundSkuStock.update({
      where: { id: sku.id },
      data: { reserved: { decrement: qty }, available: { increment: qty } },
    });
  }
  await tx.productRound.update({
    where: { id: round.id },
    data: { reserved: { decrement: qty }, available: { increment: qty } },
  });
  await maybeMarkSoldOut(tx, round.id);
}

/**
 * Төлбөр батлагдсан барааг агуулахаас хасна (нөөцлөөгүй үед).
 * Хуучин consumeReadyStock-ийн оронд: шууд борлуулалт эсвэл хоцорсон төлбөр.
 */
export async function consumeReadyStock(
  tx: Tx,
  round: ReadyRound,
  qty: number,
  selections: Record<string, string>,
): Promise<void> {
  if (round.closeAt !== null || qty <= 0) return;
  const sku = findSku(round.skuStocks, selections);
  if (round.skuStocks.length > 0) {
    if (!sku) {
      throw conflict(
        `${round.product?.name ?? 'Бараа'}: энэ сонголтын үлдэгдэл бүртгэгдээгүй байна.`,
      );
    }
    await bumpSku(
      tx,
      sku,
      qty,
      { available: { gte: qty }, stock: { gte: qty } },
      { stock: { decrement: qty }, available: { decrement: qty } },
      `${round.product?.name ?? 'Бараа'}: үлдэгдэл хүрэлцэхгүй.`,
    );
  }

  const updated = await tx.productRound.updateMany({
    where: { id: round.id, available: { gte: qty }, stock: { gte: qty } },
    data: { stock: { decrement: qty }, available: { decrement: qty } },
  });
  if (updated.count !== 1) {
    throw conflict(`${round.product?.name ?? 'Бараа'}: үлдэгдэл хүрэлцэхгүй.`);
  }
  await maybeMarkSoldOut(tx, round.id);
}

/** Борлуулсан барааг агуулахад буцаана. */
export async function restoreReadyStock(
  tx: Tx,
  round: ReadyRound,
  qty: number,
  selections: Record<string, string>,
): Promise<void> {
  if (round.closeAt !== null || qty <= 0) return;
  const sku = findSku(round.skuStocks, selections);
  if (sku) {
    await tx.roundSkuStock.update({
      where: { id: sku.id },
      data: { stock: { increment: qty }, available: { increment: qty } },
    });
  }
  await tx.productRound.update({
    where: { id: round.id },
    data: { stock: { increment: qty }, available: { increment: qty } },
  });
  await maybeMarkSoldOut(tx, round.id);
}

export function selectionsFromItem(item: {
  selections: unknown;
  size: string | null;
  color: string | null;
}): Record<string, string> {
  const fromJson = selectionsOf(item.selections);
  if (Object.keys(fromJson).length > 0) return fromJson;
  const out: Record<string, string> = {};
  if (item.size) out['Хэмжээ'] = item.size;
  if (item.color) out['Өнгө'] = item.color;
  return out;
}

export function skuKeyFromItem(item: {
  selections: unknown;
  size: string | null;
  color: string | null;
}): string {
  return skuKeyOf(selectionsFromItem(item));
}
