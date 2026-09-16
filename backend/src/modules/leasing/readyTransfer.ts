import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { conflict, notFound } from '../../lib/errors.js';
import { lockOrder } from '../../lib/orderLock.js';
import { optionsFromVariants, selectionsOf, sizeColorFromSelections } from '../../lib/options.js';
import { skuKeyOf } from '../../lib/skuStock.js';
import { recalcOrderTotals } from '../../services/money.js';
import { syncOrderCargoFee } from '../../services/cargoFee.js';

export const READY_TRANSFER_REASON_CODE = 'READY_TRANSFER';

type Tx = Prisma.TransactionClient;

export interface TransferLineInput {
  orderItemId: string;
  qty: number;
  resaleUnitPrice: number;
}

export interface TransferEligibleItem {
  id: string;
  name: string;
  qty: number;
  availableQty: number;
  unitPrice: number;
  selections: Record<string, string>;
  handedOver: boolean;
  cancelled: boolean;
  transferred: boolean;
  reason?: string;
}

export interface TransferPreview {
  orderId: string;
  code: string;
  netPaid: number;
  paidKeptAmount: number;
  remainingActiveQty: number;
  remainingSubtotal: number;
  dueAfterTransfer: number;
  closeDebt: boolean;
  writeOffAmount: number;
  lines: {
    orderItemId: string;
    name: string;
    qty: number;
    unitPrice: number;
    resaleUnitPrice: number;
    selections: Record<string, string>;
    lineTotal: number;
  }[];
}

export function transferAvailability(item: {
  cancelledAt: Date | null;
  handedOverAt: Date | null;
  transferredAt: Date | null;
  qty: number;
}): { ok: boolean; availableQty: number; reason?: string } {
  if (item.cancelledAt) return { ok: false, availableQty: 0, reason: 'Цуцлагдсан барааг шилжүүлэх боломжгүй.' };
  if (item.handedOverAt) {
    return {
      ok: false,
      availableQty: 0,
      reason: 'Хүлээлгэн өгсөн барааг буцаалт бүртгэгдээгүй тул бэлэн бараанд шилжүүлэхгүй.',
    };
  }
  if (item.transferredAt) {
    return { ok: false, availableQty: 0, reason: 'Энэ бараа аль хэдийн бэлэн бараанд шилжсэн.' };
  }
  if (item.qty <= 0) return { ok: false, availableQty: 0, reason: 'Шилжүүлэх тоо алга.' };
  return { ok: true, availableQty: item.qty };
}

/** Үлдсэн идэвхтэй бараа байвал өрийг бүхэлд нь хаахгүй — төлбөрийг дур мэдэн хуваарилаагүй. */
export function previewDebtClose(input: {
  remainingActiveQty: number;
  dueAfterTransfer: number;
}): { closeDebt: boolean; writeOffAmount: number } {
  if (input.remainingActiveQty > 0) {
    return { closeDebt: false, writeOffAmount: 0 };
  }
  return { closeDebt: true, writeOffAmount: Math.max(0, input.dueAfterTransfer) };
}

export async function loadTransferPreview(
  orderId: string,
  lines: TransferLineInput[],
): Promise<TransferPreview> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, deletedAt: null },
    include: {
      items: true,
      payments: { select: { kind: true, amount: true } },
    },
  });
  if (!order) throw notFound('Захиалга олдсонгүй.');
  return buildPreview(order, lines);
}

function buildPreview(
  order: {
    id: string;
    code: string;
    subtotal: number;
    storageFee: number;
    cargoFee: number;
    leasingFee: number;
    paidAmount: number;
    refundedAmount: number;
    writtenOffAmount: number;
    items: {
      id: string;
      nameSnapshot: string;
      qty: number;
      unitPrice: number;
      selections: Prisma.JsonValue;
      cancelledAt: Date | null;
      handedOverAt: Date | null;
      transferredAt: Date | null;
    }[];
  },
  lines: TransferLineInput[],
): TransferPreview {
  if (lines.length === 0) throw conflict('Шилжүүлэх бараа сонгоно уу.');

  const byId = new Map(order.items.map((item) => [item.id, item]));
  const qtyByItem = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isInteger(line.qty) || line.qty < 1) {
      throw conflict('Шилжүүлэх тоо 1-ээс их бүхэл тоо байна.');
    }
    if (!Number.isInteger(line.resaleUnitPrice) || line.resaleUnitPrice < 0) {
      throw conflict('Дахин борлуулах үнэ 0-ээс багагүй байна.');
    }
    qtyByItem.set(line.orderItemId, (qtyByItem.get(line.orderItemId) ?? 0) + line.qty);
  }

  const previewLines: TransferPreview['lines'] = [];
  for (const line of lines) {
    const item = byId.get(line.orderItemId);
    if (!item) throw notFound('Захиалгын мөр олдсонгүй.');
    const avail = transferAvailability(item);
    const requested = qtyByItem.get(item.id) ?? 0;
    if (!avail.ok) throw conflict(avail.reason ?? 'Шилжүүлэх боломжгүй.');
    if (requested > avail.availableQty) {
      throw conflict(`«${item.nameSnapshot}»-аас хамгийн ихдээ ${avail.availableQty} ширхэг шилжүүлнэ.`);
    }
    previewLines.push({
      orderItemId: item.id,
      name: item.nameSnapshot,
      qty: line.qty,
      unitPrice: item.unitPrice,
      resaleUnitPrice: line.resaleUnitPrice,
      selections: selectionsOf(item.selections),
      lineTotal: item.unitPrice * line.qty,
    });
  }

  const transferQtyByItem = qtyByItem;
  let remainingActiveQty = 0;
  let remainingSubtotal = 0;
  for (const item of order.items) {
    if (item.cancelledAt) continue;
    const take = transferQtyByItem.get(item.id) ?? 0;
    const left = item.qty - take;
    if (left > 0) {
      remainingActiveQty += left;
      remainingSubtotal += item.unitPrice * left;
    }
  }

  const netPaid = order.paidAmount - order.refundedAmount;
  const remainingLeasingFee =
    remainingSubtotal <= 0
      ? 0
      : order.subtotal > 0 && order.leasingFee > 0
        ? Math.round(remainingSubtotal * (order.leasingFee / order.subtotal))
        : order.leasingFee;
  const remainingCargo = remainingActiveQty <= 0 ? 0 : order.cargoFee;
  const dueAfterTransfer =
    remainingSubtotal +
    remainingLeasingFee +
    order.storageFee +
    remainingCargo -
    netPaid -
    (order.writtenOffAmount ?? 0);
  const debt = previewDebtClose({ remainingActiveQty, dueAfterTransfer });

  return {
    orderId: order.id,
    code: order.code,
    netPaid,
    paidKeptAmount: netPaid,
    remainingActiveQty,
    remainingSubtotal,
    dueAfterTransfer,
    closeDebt: debt.closeDebt,
    writeOffAmount: debt.writeOffAmount,
    lines: previewLines,
  };
}

export async function executeReadyTransfer(input: {
  orderId: string;
  ownerAdminId: string;
  reason: string;
  lines: TransferLineInput[];
  actor: string;
}): Promise<{ preview: TransferPreview; destRoundIds: string[]; transferId: string }> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw conflict('Шилжүүлэх шалтгаанаа бичнэ үү.');

  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, input.orderId);
    const order = await tx.order.findFirst({
      where: { id: input.orderId, deletedAt: null },
      include: {
        items: {
          include: {
            product: { include: { variants: true, sizeChart: true } },
            round: true,
          },
        },
      },
    });
    if (!order) throw notFound('Захиалга олдсонгүй.');
    if (!order.isLeasing) {
      throw conflict('Зөвхөн лизингийн захиалгын барааг бэлэн бараанд шилжүүлнэ.');
    }

    const preview = buildPreview(order, input.lines);
    const now = new Date();

    const transfer = await tx.readyStockTransfer.create({
      data: {
        sourceOrderId: order.id,
        ownerAdminId: input.ownerAdminId,
        reason,
        paidKeptAmount: preview.paidKeptAmount,
        dueClosedAmount: 0,
        wroteOffDebt: false,
        remainingActiveQty: preview.remainingActiveQty,
        actor: input.actor,
      },
    });

    const destByProduct = new Map<
      string,
      { destProductId: string; destRoundId: string; sku: Map<string, { selections: Record<string, string>; stock: number; price: number }> }
    >();

    for (const line of input.lines) {
      const item = order.items.find((row) => row.id === line.orderItemId);
      if (!item) throw notFound('Захиалгын мөр олдсонгүй.');
      const claimed = await claimTransferQty(tx, item, line.qty, now, transfer.id, reason);
      const dest = await ensureDestRound(tx, destByProduct, {
        sourceProduct: item.product,
        ownerAdminId: input.ownerAdminId,
        resaleUnitPrice: line.resaleUnitPrice,
        qty: claimed.qty,
        selections: selectionsOf(item.selections),
      });
      await tx.readyStockTransferLine.create({
        data: {
          transferId: transfer.id,
          orderItemId: claimed.itemId,
          sourceRoundId: item.roundId,
          destProductId: dest.destProductId,
          destRoundId: dest.destRoundId,
          qty: claimed.qty,
          resaleUnitPrice: line.resaleUnitPrice,
          nameSnapshot: item.nameSnapshot,
          selections: selectionsOf(item.selections),
        },
      });
    }

    for (const dest of destByProduct.values()) {
      const skuRows = [...dest.sku.values()];
      if (skuRows.length === 0) continue;
      const stock = skuRows.reduce((sum, row) => sum + row.stock, 0);
      await tx.roundSkuStock.createMany({
        data: skuRows.map((row) => ({
          roundId: dest.destRoundId,
          skuKey: skuKeyOf(row.selections),
          selections: row.selections,
          stock: row.stock,
        })),
      });
      if (skuRows.some((row) => row.price !== skuRows[0]!.price)) {
        await tx.roundOptionPrice.createMany({
          data: skuRows.map((row) => ({
            roundId: dest.destRoundId,
            skuKey: skuKeyOf(row.selections),
            selections: row.selections,
            sellPrice: row.price,
            costPrice: 0,
          })),
        });
      }
      await tx.productRound.update({
        where: { id: dest.destRoundId },
        data: { stock },
      });
    }

    const remaining = await tx.orderItem.count({
      where: { orderId: order.id, cancelledAt: null },
    });
    if (remaining === 0 && order.status !== 'CANCELLED') {
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
    } else {
      await syncOrderCargoFee(tx, order.id);
    }

    let totals = await recalcOrderTotals(tx, order.id);
    let dueClosedAmount = 0;
    let wroteOffDebt = false;
    if (preview.closeDebt) {
      dueClosedAmount = Math.max(0, totals.dueAmount);
      wroteOffDebt = true;
      await tx.order.update({
        where: { id: order.id },
        data: {
          writtenOffAmount: dueClosedAmount,
          debtClosedAt: now,
          debtCloseReason: reason,
        },
      });
      totals = await recalcOrderTotals(tx, order.id);
    }

    await tx.readyStockTransfer.update({
      where: { id: transfer.id },
      data: {
        dueClosedAmount,
        wroteOffDebt,
        remainingActiveQty: preview.remainingActiveQty,
      },
    });

    await audit(
      {
        actor: input.actor,
        action: 'READY_TRANSFER',
        entity: 'Order',
        entityId: order.id,
        after: {
          transferId: transfer.id,
          reason,
          paidKeptAmount: preview.paidKeptAmount,
          dueClosedAmount,
          wroteOffDebt,
          remainingActiveQty: preview.remainingActiveQty,
          destRoundIds: [...destByProduct.values()].map((row) => row.destRoundId),
        },
      },
      tx,
    );

    return {
      preview: { ...preview, writeOffAmount: dueClosedAmount, closeDebt: wroteOffDebt },
      destRoundIds: [...destByProduct.values()].map((row) => row.destRoundId),
      transferId: transfer.id,
    };
  });
}

export async function claimTransferQty(
  tx: Tx,
  item: {
    id: string;
    orderId: string;
    roundId: string;
    productId: string;
    nameSnapshot: string;
    selections: Prisma.JsonValue;
    size: string | null;
    color: string | null;
    qty: number;
    unitPrice: number;
    costPriceSnapshot: number;
    arriveFrom: Date | null;
    arriveTo: Date | null;
    arrivedAt: Date | null;
    arrivedQty: number;
    fulfilment: Prisma.OrderItemGetPayload<{ select: { fulfilment: true } }>['fulfilment'];
    cancelledAt: Date | null;
    handedOverAt: Date | null;
    transferredAt: Date | null;
  },
  qty: number,
  now: Date,
  transferId: string,
  reason: string,
): Promise<{ itemId: string; qty: number }> {
  const avail = transferAvailability(item);
  if (!avail.ok || qty > avail.availableQty) {
    throw conflict(avail.reason ?? 'Шилжүүлэх боломжгүй.');
  }

  if (qty === item.qty) {
    const updated = await tx.orderItem.updateMany({
      where: {
        id: item.id,
        cancelledAt: null,
        handedOverAt: null,
        transferredAt: null,
        qty,
      },
      data: {
        cancelledAt: now,
        cancelReason: reason,
        transferredAt: now,
        transferredQty: qty,
        readyTransferId: transferId,
      },
    });
    if (updated.count !== 1) {
      throw conflict('Энэ бараа аль хэдийн шилжсэн эсвэл төлөв өөрчлөгдсөн байна.');
    }
    return { itemId: item.id, qty };
  }

  const shrink = await tx.orderItem.updateMany({
    where: {
      id: item.id,
      cancelledAt: null,
      handedOverAt: null,
      transferredAt: null,
      qty: item.qty,
    },
    data: {
      qty: item.qty - qty,
      arrivedQty: Math.min(item.arrivedQty, item.qty - qty),
    },
  });
  if (shrink.count !== 1) {
    throw conflict('Энэ бараа аль хэдийн шилжсэн эсвэл төлөв өөрчлөгдсөн байна.');
  }

  const selections = selectionsOf(item.selections);
  const { size, color } = sizeColorFromSelections(selections);
  const sibling = await tx.orderItem.create({
    data: {
      orderId: item.orderId,
      roundId: item.roundId,
      productId: item.productId,
      nameSnapshot: item.nameSnapshot,
      selections,
      size: size ?? item.size,
      color: color ?? item.color,
      qty,
      unitPrice: item.unitPrice,
      costPriceSnapshot: item.costPriceSnapshot,
      arriveFrom: item.arriveFrom,
      arriveTo: item.arriveTo,
      arrivedAt: null,
      arrivedQty: 0,
      fulfilment: item.fulfilment,
      cancelledAt: now,
      cancelReason: reason,
      transferredAt: now,
      transferredQty: qty,
      readyTransferId: transferId,
    },
  });
  return { itemId: sibling.id, qty };
}

async function ensureDestRound(
  tx: Tx,
  destByProduct: Map<
    string,
    { destProductId: string; destRoundId: string; sku: Map<string, { selections: Record<string, string>; stock: number; price: number }> }
  >,
  input: {
    sourceProduct: {
      id: string;
      name: string;
      description: string | null;
      categoryId: string;
      images: string[];
      variants: { kind: string; value: string; sortOrder: number }[];
      sizeChart: { size: string; heightRange: string; chestCm: string; sortOrder: number }[];
    };
    ownerAdminId: string;
    resaleUnitPrice: number;
    qty: number;
    selections: Record<string, string>;
  },
): Promise<{ destProductId: string; destRoundId: string }> {
  const existing = destByProduct.get(input.sourceProduct.id);
  if (existing) {
    const key = skuKeyOf(input.selections);
    const prev = existing.sku.get(key);
    if (prev) prev.stock += input.qty;
    else {
      existing.sku.set(key, {
        selections: input.selections,
        stock: input.qty,
        price: input.resaleUnitPrice,
      });
    }
    return existing;
  }

  const product = await tx.product.create({
    data: {
      name: input.sourceProduct.name,
      description: input.sourceProduct.description,
      categoryId: input.sourceProduct.categoryId,
      images: input.sourceProduct.images,
      ownerKind: 'LEASING',
      ownerAdminId: input.ownerAdminId,
      variants: {
        create: input.sourceProduct.variants.map((row) => ({
          kind: row.kind,
          value: row.value,
          sortOrder: row.sortOrder,
        })),
      },
      sizeChart: {
        create: input.sourceProduct.sizeChart.map((row) => ({
          size: row.size,
          heightRange: row.heightRange,
          chestCm: row.chestCm,
          sortOrder: row.sortOrder,
        })),
      },
    },
  });

  const round = await tx.productRound.create({
    data: {
      productId: product.id,
      roundNo: 1,
      costPrice: 0,
      sellPrice: input.resaleUnitPrice,
      stock: 0,
      closeAt: null,
      status: 'ACTIVE',
      ownerKind: 'LEASING',
      ownerAdminId: input.ownerAdminId,
      note: 'Лизингийн захиалгаас шилжүүлсэн бэлэн бараа',
    },
  });

  const sku = new Map<string, { selections: Record<string, string>; stock: number; price: number }>();
  const options = optionsFromVariants(input.sourceProduct.variants);
  if (options.length > 0 && Object.keys(input.selections).length > 0) {
    sku.set(skuKeyOf(input.selections), {
      selections: input.selections,
      stock: input.qty,
      price: input.resaleUnitPrice,
    });
  } else {
    await tx.productRound.update({
      where: { id: round.id },
      data: { stock: input.qty },
    });
  }

  const created = { destProductId: product.id, destRoundId: round.id, sku };
  destByProduct.set(input.sourceProduct.id, created);
  return created;
}

export function serializeTransferPreview(preview: TransferPreview) {
  return {
    code: preview.code,
    netPaid: preview.netPaid,
    paidKeptAmount: preview.paidKeptAmount,
    remainingActiveQty: preview.remainingActiveQty,
    remainingSubtotal: preview.remainingSubtotal,
    dueAfterTransfer: preview.dueAfterTransfer,
    closeDebt: preview.closeDebt,
    writeOffAmount: preview.writeOffAmount,
    refund: false,
    lines: preview.lines,
    notice: preview.closeDebt
      ? preview.writeOffAmount > 0
        ? 'Өмнө төлсөн мөнгө лизингт үлдэнэ. Үлдсэн өрийг төлөгдсөн гэж тэмдэглэхгүй, хаалтын бүртгэлээр хаана.'
        : 'Өмнө төлсөн мөнгө лизингт үлдэнэ. Хаагдах өр байхгүй.'
      : 'Үлдсэн бараа байгаа тул захиалгын өрийг бүхэлд нь хаахгүй. Төлбөрийг бараанд хуваарилаагүй.',
  };
}
