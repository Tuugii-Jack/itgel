import { prisma } from '../../prisma.js';
import { notFound } from '../../lib/errors.js';
import { arrivedQtyOf, handedQtyOf } from '../../lib/itemQty.js';
import { isArrivalSmsEligible } from '../../lib/arrivalSms.js';
import { canEditBatchComposition, nextBatchStage, previousBatchStage } from '../../lib/orderStatus.js';
import { attachOrdersForRound, findOrderIdsForBatch } from '../../services/batches.js';
import { summarizeRoundArrivals } from '../../services/batchArrival.js';
import { unitCargoFee } from '../../services/cargoFee.js';
import { computeTotals, paymentState, PAYMENT_STATE_LABEL } from '../../services/money.js';
import { roundStats } from '../../services/roundStats.js';
import { batchSummary, orderStatusLabel } from '../../services/serialize.js';
import { EMPTY_BATCH_QTY, qtyByBatchIds } from './list.js';
import { batchProgressLabel, batchProgressOf } from './progress.js';

export async function loadBatchDetail(id: string, opts: { includeOrders?: boolean } = {}) {
  const includeOrders = opts.includeOrders !== false;
  const batch = await prisma.batch.findUnique({
    where: { id },
    include: {
      rounds: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        include: {
          product: { select: { id: true, name: true, images: true, categoryId: true } },
          cargoFees: true,
        },
      },
    },
  });
  if (!batch) throw notFound('Багц олдсонгүй.');

  // Зам дээр байхад тойрогт захиалсан ч batchId-гүй захиалгыг хавсаргана.
  if (canEditBatchComposition(batch.stage) && batch.rounds.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const round of batch.rounds) {
        await attachOrdersForRound(tx, round.id, batch.id);
      }
    });
  }

  const roundIds = batch.rounds.map((r) => r.id);
  const [activeIds, omittedIds, qtyMap] = await Promise.all([
    findOrderIdsForBatch(prisma, batch.id, roundIds, false),
    findOrderIdsForBatch(prisma, batch.id, roundIds, true),
    qtyByBatchIds([batch.id]),
  ]);
  const allIds = [...new Set([...activeIds, ...omittedIds])];
  const qty = qtyMap.get(batch.id) ?? EMPTY_BATCH_QTY;
  const [stats, arrivals, orderRows, arrivalDispatches, arrivalNotes] = await Promise.all([
    roundStats(roundIds),
    summarizeRoundArrivals(prisma, roundIds),
    !includeOrders || allIds.length === 0
      ? Promise.resolve([])
      : prisma.order.findMany({
          where: { id: { in: allIds } },
          include: {
            customer: { select: { id: true, name: true, phone: true } },
            items: {
              where: { cancelledAt: null },
              select: {
                qty: true,
                roundId: true,
                arrivedQty: true,
                arrivedAt: true,
                handedOverAt: true,
                handedOverQty: true,
                cancelledAt: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        }),
    !includeOrders || allIds.length === 0
      ? Promise.resolve([])
      : prisma.smsDispatch.findMany({
          where: { relatedType: 'order', relatedId: { in: allIds }, purpose: 'arrival' },
          orderBy: { createdAt: 'desc' },
          select: { relatedId: true, status: true, error: true },
        }),
    prisma.batchArrivalNote.findMany({
      where: { batchId: batch.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);

  const arrivalSmsByOrder = new Map<string, { status: string; error: string | null }>();
  for (const row of arrivalDispatches) {
    if (!row.relatedId || arrivalSmsByOrder.has(row.relatedId)) continue;
    arrivalSmsByOrder.set(row.relatedId, { status: row.status, error: row.error });
  }

  const serializeOrder = (order: (typeof orderRows)[number]) => {
    const state = paymentState(computeTotals(order));
    const arrivedPieces = order.items.reduce((sum, i) => sum + arrivedQtyOf(i), 0);
    const handedOverPieces = order.items.reduce((sum, i) => sum + handedQtyOf(i), 0);
    const itemCount = order.items.reduce((sum, i) => sum + i.qty, 0);
    return {
      id: order.id,
      code: order.code,
      status: order.status,
      statusLabel: orderStatusLabel(order.status),
      subtotal: order.subtotal,
      dueAmount: order.dueAmount,
      cargoFee: order.cargoFee,
      paidAmount: order.paidAmount,
      paymentState: state,
      paymentStateLabel: PAYMENT_STATE_LABEL[state],
      batchOmittedAt: order.batchOmittedAt?.toISOString() ?? null,
      itemCount,
      arrivedPieces,
      handedOverPieces,
      warehouseArrived: arrivedPieces > 0,
      notified: Boolean(order.arrivalNotifiedAt),
      handedOver: handedOverPieces > 0 && handedOverPieces >= itemCount,
      handedOverPartial: handedOverPieces > 0 && handedOverPieces < itemCount,
      customer: { id: order.customer.id, name: order.customer.name, phone: order.customer.phone },
      arrivalNotifiedAt: order.arrivalNotifiedAt?.toISOString() ?? null,
      arrivalSmsStatus: arrivalSmsByOrder.get(order.id)?.status ?? null,
      arrivalSmsError: arrivalSmsByOrder.get(order.id)?.error ?? null,
      arrivalSmsEligible: isArrivalSmsEligible({
        deletedAt: order.deletedAt,
        status: order.status,
        items: order.items,
      }),
      createdAt: order.createdAt.toISOString(),
    };
  };

  const activeSet = new Set(activeIds);
  const orders = orderRows.filter((o) => activeSet.has(o.id)).map(serializeOrder);
  const omittedOrders = orderRows
    .filter((o) => o.batchOmittedAt != null)
    .map(serializeOrder);

  const remainingQty = Math.max(0, qty.linkedQty - qty.arrivedQty);
  const progress = batchProgressOf({
    stage: batch.stage,
    orderedQty: qty.linkedQty,
    arrivedQty: qty.arrivedQty,
    unlinkedQty: qty.unlinkedQty,
  });

  return {
    ...batchSummary(batch)!,
    nextStage: nextBatchStage(batch.stage),
    previousStage: previousBatchStage(batch.stage),
    orders,
    omittedOrders,
    products: batch.rounds.map((round) => {
      const s = stats.get(round.id);
      const variants = (arrivals.get(round.id) ?? []).map((v) => {
        const cargoFee = unitCargoFee(round, v.selections);
        return { ...v, cargoFee };
      });
      const cargoTotal = variants.length
        ? variants.reduce((sum, v) => sum + v.orderedQty * v.cargoFee, 0)
        : (s?.qty ?? 0) * round.cargoFee;
      return {
        roundId: round.id,
        roundNo: round.roundNo,
        productId: round.product.id,
        name: round.product.name,
        image: round.product.images[0] ?? null,
        sellPrice: round.sellPrice,
        costPrice: round.costPrice,
        cargoFee: round.cargoFee,
        cargoTotal,
        status: round.status,
        closeAt: round.closeAt?.toISOString() ?? null,
        orderedQty: s?.qty ?? 0,
        customerCount: s?.customerCount ?? 0,
        variants,
      };
    }),
    totalValue: orders.reduce((sum, o) => sum + o.subtotal, 0),
    totalCargo: orders.reduce((sum, o) => sum + o.cargoFee, 0),
    totalDue: orders.reduce((sum, o) => sum + Math.max(0, o.dueAmount), 0),
    createdAt: batch.createdAt.toISOString(),
    orderedQty: qty.orderedQty,
    linkedQty: qty.linkedQty,
    unlinkedQty: qty.unlinkedQty,
    arrivedQty: qty.arrivedQty,
    remainingQty,
    progress,
    progressLabel: batchProgressLabel(progress, qty.unlinkedQty),
    arrivalNotes: arrivalNotes.map((note) => ({
      id: note.id,
      roundId: note.roundId,
      kind: note.kind,
      qty: note.qty,
      note: note.note,
      actor: note.actor,
      createdAt: note.createdAt.toISOString(),
      selections: note.selections,
    })),
  };
}
