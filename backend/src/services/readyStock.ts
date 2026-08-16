import type { Prisma } from '@prisma/client';
import { conflict } from '../lib/errors.js';
import { comboLabel, findSku, skuKeyOf, skuStockSum } from '../lib/skuStock.js';
import { selectionsOf } from '../lib/options.js';

type Tx = Prisma.TransactionClient;

type RoundStock = {
  id: string;
  closeAt: Date | null;
  status: string;
  stock: number;
  product: { name: string };
  skuStocks: { id: string; skuKey: string; stock: number }[];
};

/** Бэлэн барааны үлдэгдлийг сонгосон хослол (SKU) + тойргийн нийт дүнгээс хасна. */
export async function consumeReadyStock(
  tx: Tx,
  round: RoundStock,
  qty: number,
  selections: Record<string, string>,
): Promise<void> {
  if (round.closeAt !== null) return;
  if (round.skuStocks.length > 0) {
    const row = findSku(round.skuStocks, selections);
    if (!row) {
      throw conflict(`"${round.product.name}" барааны сонголтыг сонгоно уу.`);
    }
    if (row.stock < qty) {
      throw conflict(
        `"${round.product.name}" — ${comboLabel(selections) || skuKeyOf(selections)} үлдэгдэл хүрэлцэхгүй байна (${row.stock}).`,
      );
    }
    const updatedSku = await tx.roundSkuStock.updateMany({
      where: { id: row.id, stock: { gte: qty } },
      data: { stock: { decrement: qty } },
    });
    if (updatedSku.count === 0) {
      throw conflict(
        `"${round.product.name}" — ${comboLabel(selections)} үлдэгдэл хүрэлцэхгүй байна.`,
      );
    }
  }

  const updated = await tx.productRound.updateMany({
    where: { id: round.id, stock: { gte: qty } },
    data: { stock: { decrement: qty } },
  });
  if (updated.count === 0) {
    throw conflict(`"${round.product.name}" барааны үлдэгдэл хүрэлцэхгүй байна.`);
  }

  await maybeMarkSoldOut(tx, round.id);
}

export async function restoreReadyStock(
  tx: Tx,
  round: Pick<RoundStock, 'id' | 'closeAt' | 'status' | 'skuStocks'>,
  qty: number,
  selections: Record<string, string>,
): Promise<void> {
  if (round.closeAt !== null) return;
  const row = findSku(round.skuStocks, selections);
  if (row) {
    await tx.roundSkuStock.update({
      where: { id: row.id },
      data: { stock: { increment: qty } },
    });
  }
  await tx.productRound.update({
    where: { id: round.id },
    data: {
      stock: { increment: qty },
      ...(round.status === 'SOLD_OUT' ? { status: 'ACTIVE' as const } : {}),
    },
  });
}

async function maybeMarkSoldOut(tx: Tx, roundId: string): Promise<void> {
  const after = await tx.productRound.findUniqueOrThrow({
    where: { id: roundId },
    include: { skuStocks: true },
  });
  const remaining = skuStockSum(after.skuStocks) ?? after.stock;
  if (remaining <= 0 && after.status === 'ACTIVE') {
    await tx.productRound.update({
      where: { id: roundId },
      data: { status: 'SOLD_OUT' },
    });
  }
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
