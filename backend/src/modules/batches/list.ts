import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { nextBatchStage, previousBatchStage } from '../../lib/orderStatus.js';
import { batchSummary } from '../../services/serialize.js';
import { batchProgressLabel, batchProgressOf, type BatchProgress } from './progress.js';

export type BatchListQuery = {
  stage?: 'IN_TRANSIT' | 'AT_WAREHOUSE' | 'DONE';
  progress?: BatchProgress;
  q?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
};

export type BatchQtyRow = {
  orderedQty: number;
  linkedQty: number;
  unlinkedQty: number;
  arrivedQty: number;
};

export const EMPTY_BATCH_QTY: BatchQtyRow = {
  orderedQty: 0,
  linkedQty: 0,
  unlinkedQty: 0,
  arrivedQty: 0,
};

/** Захиалсан = Order.batchId. Холбосон/ирсэн = тойрог нь энэ багцад. */
export async function qtyByBatchIds(batchIds: string[]): Promise<Map<string, BatchQtyRow>> {
  const map = new Map<string, BatchQtyRow>();
  if (batchIds.length === 0) return map;
  const rows = await prisma.$queryRaw<
    {
      batchId: string;
      orderedQty: bigint;
      linkedQty: bigint;
      unlinkedQty: bigint;
      arrivedQty: bigint;
    }[]
  >`
    SELECT o."batchId" AS "batchId",
           COALESCE(SUM(i.qty), 0)::bigint AS "orderedQty",
           COALESCE(SUM(
             CASE WHEN r."batchId" = o."batchId" AND r."deletedAt" IS NULL THEN i.qty ELSE 0 END
           ), 0)::bigint AS "linkedQty",
           COALESCE(SUM(
             CASE WHEN r."batchId" = o."batchId" AND r."deletedAt" IS NULL THEN 0 ELSE i.qty END
           ), 0)::bigint AS "unlinkedQty",
           COALESCE(SUM(
             CASE WHEN r."batchId" = o."batchId" AND r."deletedAt" IS NULL THEN
               CASE WHEN i."handedOverAt" IS NOT NULL THEN i.qty
                    ELSE LEAST(i."arrivedQty", i.qty) END
             ELSE 0 END
           ), 0)::bigint AS "arrivedQty"
    FROM "Order" o
    JOIN "OrderItem" i ON i."orderId" = o.id
    LEFT JOIN "ProductRound" r ON r.id = i."roundId"
    WHERE o."batchId" IN (${Prisma.join(batchIds)})
      AND o."deletedAt" IS NULL
      AND o."batchOmittedAt" IS NULL
      AND o.status <> 'CANCELLED'
      AND i."cancelledAt" IS NULL
    GROUP BY o."batchId"
  `;
  for (const row of rows) {
    map.set(row.batchId, {
      orderedQty: Number(row.orderedQty),
      linkedQty: Number(row.linkedQty),
      unlinkedQty: Number(row.unlinkedQty),
      arrivedQty: Number(row.arrivedQty),
    });
  }
  return map;
}

function listWhere(q: BatchListQuery): Prisma.BatchWhereInput {
  const where: Prisma.BatchWhereInput = { deletedAt: null };
  if (q.stage) where.stage = q.stage;
  if (q.from || q.to) {
    where.AND = [
      {
        OR: [
          {
            createdAt: {
              ...(q.from ? { gte: q.from } : {}),
              ...(q.to ? { lte: q.to } : {}),
            },
          },
          {
            etaFrom: {
              ...(q.from ? { gte: q.from } : {}),
              ...(q.to ? { lte: q.to } : {}),
            },
          },
        ],
      },
    ];
  }
  const term = q.q?.trim();
  if (term) {
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { cargoRef: { contains: term, mode: 'insensitive' } },
      { orders: { some: { deletedAt: null, code: { contains: term, mode: 'insensitive' } } } },
      {
        rounds: {
          some: {
            deletedAt: null,
            product: { name: { contains: term, mode: 'insensitive' } },
          },
        },
      },
    ];
  }
  return where;
}

export async function listBatches(q: BatchListQuery) {
  const where = listWhere(q);
  const matches = await prisma.batch.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: { id: true, stage: true },
  });
  const qtyMap = await qtyByBatchIds(matches.map((b) => b.id));
  const summary = { in_transit: 0, partial: 0, complete: 0, mismatch: 0 };
  const withProgress = matches.map((batch) => {
    const qty = qtyMap.get(batch.id) ?? EMPTY_BATCH_QTY;
    const progress = batchProgressOf({
      stage: batch.stage,
      orderedQty: qty.linkedQty,
      arrivedQty: qty.arrivedQty,
      unlinkedQty: qty.unlinkedQty,
    });
    summary[progress] += 1;
    return { id: batch.id, progress, qty };
  });
  const filtered = q.progress ? withProgress.filter((row) => row.progress === q.progress) : withProgress;
  const total = filtered.length;
  const start = (q.page - 1) * q.pageSize;
  const page = filtered.slice(start, start + q.pageSize);
  const pageIds = page.map((row) => row.id);

  const [batches, sums] = await Promise.all([
    pageIds.length
      ? prisma.batch.findMany({
          where: { id: { in: pageIds } },
          include: {
            _count: { select: { orders: { where: { deletedAt: null, batchOmittedAt: null } } } },
          },
        })
      : Promise.resolve([]),
    pageIds.length
      ? prisma.order.groupBy({
          by: ['batchId'],
          where: { batchId: { in: pageIds }, deletedAt: null, batchOmittedAt: null },
          _sum: { subtotal: true },
        })
      : Promise.resolve([]),
  ]);
  const order = new Map(page.map((row, i) => [row.id, i]));
  batches.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const sumByBatch = new Map(sums.map((s) => [s.batchId, s._sum.subtotal ?? 0]));
  const progressById = new Map(page.map((row) => [row.id, row]));

  return {
    data: batches.map((batch) => {
      const row = progressById.get(batch.id)!;
      return {
        ...batchSummary(batch)!,
        orderCount: batch._count.orders,
        orderedQty: row.qty.orderedQty,
        linkedQty: row.qty.linkedQty,
        unlinkedQty: row.qty.unlinkedQty,
        arrivedQty: row.qty.arrivedQty,
        remainingQty: Math.max(0, row.qty.linkedQty - row.qty.arrivedQty),
        progress: row.progress,
        progressLabel: batchProgressLabel(row.progress, row.qty.unlinkedQty),
        totalValue: sumByBatch.get(batch.id) ?? 0,
        nextStage: nextBatchStage(batch.stage),
        previousStage: previousBatchStage(batch.stage),
        createdAt: batch.createdAt.toISOString(),
      };
    }),
    meta: {
      total,
      page: q.page,
      pageSize: q.pageSize,
      pages: Math.max(1, Math.ceil(total / q.pageSize)),
      summary,
    },
  };
}
