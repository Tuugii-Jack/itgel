import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { addUbMonths, parseUbDay, startOfUbMonth, ubMonthKey } from '../../lib/date.js';
import {
  canEditBatchComposition,
  nextBatchStage,
  previousBatchStage,
} from '../../lib/orderStatus.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, param, query, validate } from '../../middleware/validate.js';
import {
  advanceBatch,
  attachOrdersForRound,
  detachOrdersForRound,
  findOrderIdsForBatch,
  omitOrderFromBatch,
  promoteOrdersForBatchStage,
  reinstateOrderInBatch,
  resyncArrivalsForBatch,
  revertBatch,
} from '../../services/batches.js';
import { registerBatchArrivals, summarizeRoundArrivals } from '../../services/batchArrival.js';
import { roundStats } from '../../services/roundStats.js';
import { finalizeRoundClose } from '../../services/orders.js';
import { batchSummary, orderStatusLabel } from '../../services/serialize.js';
import { computeTotals, paymentState, PAYMENT_STATE_LABEL } from '../../services/money.js';
import { syncCargoFeesForRounds } from '../../services/cargoFee.js';

export const adminBatchesRouter = Router();

const idParams = z.object({ id: z.string().min(1) });

const listQuery = z.object({
  stage: z.enum(['IN_TRANSIT', 'AT_WAREHOUSE', 'DONE']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

adminBatchesRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof listQuery>>(req);
    const where = { deletedAt: null, ...(q.stage ? { stage: q.stage } : {}) };

    const [total, batches] = await Promise.all([
      prisma.batch.count({ where }),
      prisma.batch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          _count: { select: { orders: { where: { deletedAt: null } } } },
        },
      }),
    ]);

    // Багц бүрийн нийт дүнг DB дээр нэгтгэнэ — захиалга бүрийг хариунд
    // багтаавал том багцад хариу хэт томордог.
    const sums = batches.length
      ? await prisma.order.groupBy({
          by: ['batchId'],
          where: { batchId: { in: batches.map((b) => b.id) }, deletedAt: null },
          _sum: { subtotal: true },
        })
      : [];
    const sumByBatch = new Map(sums.map((s) => [s.batchId, s._sum.subtotal ?? 0]));

    res.json({
      data: batches.map((batch) => ({
        ...batchSummary(batch)!,
        orderCount: batch._count.orders,
        totalValue: sumByBatch.get(batch.id) ?? 0,
        nextStage: nextBatchStage(batch.stage),
        previousStage: previousBatchStage(batch.stage),
        createdAt: batch.createdAt.toISOString(),
      })),
      meta: { total, page: q.page, pageSize: q.pageSize, pages: Math.ceil(total / q.pageSize) },
    });
  }),
);

/**
 * GET /batches/eligible-months — багцад нэмэх боломжтой хаагдсан гаргалтын сарууд.
 */
adminBatchesRouter.get(
  '/eligible-months',
  asyncHandler(async (_req, res) => {
    const rounds = await prisma.productRound.findMany({
      where: {
        deletedAt: null,
        batchId: null,
        closeAt: { not: null },
        status: 'CLOSED',
      },
      select: { closeAt: true },
    });

    const counts = new Map<string, number>();
    for (const r of rounds) {
      if (!r.closeAt) continue;
      const key = ubMonthKey(r.closeAt);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const months = [...counts.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, count]) => {
        const [y, m] = key.split('-');
        return { year: Number(y), month: Number(m), key, count };
      });

    res.json({ data: months });
  }),
);

/**
 * GET /batches/eligible-rounds?year=&month= — тухайн сарын хаагдсан, багцгүй гаргалт.
 */
adminBatchesRouter.get(
  '/eligible-rounds',
  validate({
    query: z.object({
      year: z.coerce.number().int().min(2020).max(2100),
      month: z.coerce.number().int().min(1).max(12),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ year: number; month: number }>(req);
    const monthStart = startOfUbMonth(
      parseUbDay(`${q.year}-${String(q.month).padStart(2, '0')}-01`),
    );
    const monthEnd = new Date(addUbMonths(monthStart, 1).getTime() - 1);

    const rounds = await prisma.productRound.findMany({
      where: {
        deletedAt: null,
        batchId: null,
        status: 'CLOSED',
        closeAt: { gte: monthStart, lte: monthEnd },
      },
      orderBy: { closeAt: 'desc' },
      include: {
        product: { select: { id: true, name: true, images: true } },
      },
    });

    const stats = await roundStats(rounds.map((r) => r.id));

    res.json({
      data: rounds.map((r) => {
        const s = stats.get(r.id);
        return {
          roundId: r.id,
          roundNo: r.roundNo,
          productId: r.product.id,
          name: r.product.name,
          image: r.product.images[0] ?? null,
          sellPrice: r.sellPrice,
          costPrice: r.costPrice,
          cargoFee: r.cargoFee,
          status: r.status,
          closeAt: r.closeAt?.toISOString() ?? null,
          orderedQty: s?.qty ?? 0,
          customerCount: s?.customerCount ?? 0,
        };
      }),
      meta: { year: q.year, month: q.month, total: rounds.length },
    });
  }),
);

adminBatchesRouter.get(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const batch = await prisma.batch.findUnique({
      where: { id: req.params.id },
      include: {
        rounds: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: {
            product: { select: { id: true, name: true, images: true, categoryId: true } },
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
    const [activeIds, omittedIds] = await Promise.all([
      findOrderIdsForBatch(prisma, batch.id, roundIds, false),
      findOrderIdsForBatch(prisma, batch.id, roundIds, true),
    ]);
    const allIds = [...new Set([...activeIds, ...omittedIds])];
    const [stats, arrivals, orderRows] = await Promise.all([
      roundStats(roundIds),
      summarizeRoundArrivals(prisma, roundIds),
      allIds.length === 0
        ? Promise.resolve([])
        : prisma.order.findMany({
            where: { id: { in: allIds } },
            include: {
              customer: { select: { id: true, name: true, phone: true } },
              items: {
                where: { cancelledAt: null },
                select: { qty: true, roundId: true },
              },
            },
            orderBy: { createdAt: 'asc' },
          }),
    ]);

    const serializeOrder = (order: (typeof orderRows)[number]) => {
      const state = paymentState(computeTotals(order));
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
        itemCount: order.items.reduce((sum, i) => sum + i.qty, 0),
        customer: { id: order.customer.id, name: order.customer.name, phone: order.customer.phone },
        createdAt: order.createdAt.toISOString(),
      };
    };

    const activeSet = new Set(activeIds);
    const orders = orderRows.filter((o) => activeSet.has(o.id)).map(serializeOrder);
    const omittedOrders = orderRows
      .filter((o) => o.batchOmittedAt != null)
      .map(serializeOrder);

    res.json({
      data: {
        ...batchSummary(batch)!,
        nextStage: nextBatchStage(batch.stage),
        previousStage: previousBatchStage(batch.stage),
        orders,
        omittedOrders,
        products: batch.rounds.map((round) => {
          const s = stats.get(round.id);
          return {
            roundId: round.id,
            roundNo: round.roundNo,
            productId: round.product.id,
            name: round.product.name,
            image: round.product.images[0] ?? null,
            sellPrice: round.sellPrice,
            costPrice: round.costPrice,
            cargoFee: round.cargoFee,
            cargoTotal: (s?.qty ?? 0) * round.cargoFee,
            status: round.status,
            closeAt: round.closeAt?.toISOString() ?? null,
            orderedQty: s?.qty ?? 0,
            customerCount: s?.customerCount ?? 0,
            variants: arrivals.get(round.id) ?? [],
          };
        }),
        totalValue: orders.reduce((sum, o) => sum + o.subtotal, 0),
        totalCargo: orders.reduce((sum, o) => sum + o.cargoFee, 0),
        totalDue: orders.reduce((sum, o) => sum + Math.max(0, o.dueAmount), 0),
        createdAt: batch.createdAt.toISOString(),
      },
    });
  }),
);

/**
 * POST /batches — шинэ багц (Зам дээр). Хаагдсан гаргалтыг дараа нь сараар нэмнэ.
 */
adminBatchesRouter.post(
  '/',
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(80),
      deadline: z.coerce.date().nullable().optional(),
      orderIds: z.array(z.string().min(1)).max(500).optional(),
      weightKg: z.coerce.number().int().min(0).max(100000).optional(),
      etaFrom: z.coerce.date().optional(),
      etaTo: z.coerce.date().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      name: string;
      deadline?: Date | null;
      orderIds?: string[];
      weightKg?: number;
      etaFrom?: Date;
      etaTo?: Date;
    };

    const orders = body.orderIds?.length
      ? await prisma.order.findMany({
          where: {
            deletedAt: null,
            batchId: null,
            status: { in: ['CONFIRMED', 'IN_BATCH'] },
            id: { in: body.orderIds },
          },
          select: { id: true },
        })
      : [];

    const actor = actorOf(req);
    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.batch.create({
        data: {
          name: body.name,
          stage: 'IN_TRANSIT',
          deadline: body.deadline ?? null,
          weightKg: body.weightKg ?? null,
          etaFrom: body.etaFrom ?? null,
          etaTo: body.etaTo ?? null,
        },
      });
      if (orders.length > 0) {
        const ids = orders.map((o) => o.id);
        await tx.order.updateMany({
          where: { id: { in: ids } },
          data: { batchId: created.id },
        });
        await promoteOrdersForBatchStage(tx, created.id, 'IN_TRANSIT', actor, ids);
      }
      return created;
    });

    await audit({
      actor,
      action: 'CREATE',
      entity: 'Batch',
      entityId: batch.id,
      after: { name: batch.name, stage: batch.stage, orderCount: orders.length },
    });

    res.status(201).json({
      data: { ...batchSummary(batch)!, orderCount: orders.length },
    });
  }),
);

adminBatchesRouter.patch(
  '/:id',
  validate({
    params: idParams,
    body: z.object({
      name: z.string().trim().min(1).max(80).optional(),
      deadline: z.coerce.date().nullable().optional(),
      weightKg: z.coerce.number().int().min(0).max(100000).nullable().optional(),
      etaFrom: z.coerce.date().nullable().optional(),
      etaTo: z.coerce.date().nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      deadline?: Date | null;
      etaFrom?: Date | null;
      etaTo?: Date | null;
    };

    const before = await prisma.batch.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!before) throw notFound('Багц олдсонгүй.');

    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.batch.update({ where: { id: before.id }, data: req.body });

      if (body.deadline !== undefined && body.deadline !== null) {
        await tx.productRound.updateMany({
          where: { batchId: before.id, deletedAt: null, closeAt: { not: null } },
          data: { closeAt: body.deadline },
        });
      }
      const etaChanged = body.etaFrom !== undefined || body.etaTo !== undefined;
      if (etaChanged || (body.deadline !== undefined && body.deadline !== null)) {
        await resyncArrivalsForBatch(tx, updated);
      }
      return updated;
    });

    await audit({
      actor: actorOf(req),
      action: 'UPDATE',
      entity: 'Batch',
      entityId: after.id,
      before,
      after,
    });

    res.json({ data: batchSummary(after) });
  }),
);

/**
 * POST /batches/:id/cargo-fees — бараа бүрийн нэгж карго үнийг хадгалж,
 * холбоотой захиалгын `cargoFee` / `dueAmount`-г шинэчилнэ.
 */
adminBatchesRouter.post(
  '/:id/cargo-fees',
  validate({
    params: idParams,
    body: z.object({
      items: z
        .array(
          z.object({
            roundId: z.string().min(1),
            cargoFee: z.coerce.number().int().min(0).max(10_000_000),
          }),
        )
        .min(1)
        .max(200),
    }),
  }),
  asyncHandler(async (req, res) => {
    const batchId = param(req, 'id');
    const { items } = req.body as { items: { roundId: string; cargoFee: number }[] };
    const batch = await prisma.batch.findFirst({
      where: { id: batchId, deletedAt: null },
    });
    if (!batch) throw notFound('Багц олдсонгүй.');
    if (!canEditBatchComposition(batch.stage)) {
      throw conflict('Агуулахад ирсэн багцын карго үнийг өөрчлөх боломжгүй.');
    }

    const roundIds = items.map((i) => i.roundId);
    const uniqueIds = [...new Set(roundIds)];
    const rounds = await prisma.productRound.findMany({
      where: { id: { in: uniqueIds }, batchId: batch.id, deletedAt: null },
      select: { id: true },
    });
    if (rounds.length !== uniqueIds.length) {
      throw badRequest('Зарим бараа энэ багцад хамаарахгүй.');
    }

    const feeByRound = new Map(items.map((i) => [i.roundId, i.cargoFee]));
    // Interactive $transaction + олон захиалга sync = pooler/timeout-оор 500 болдог.
    // Тойргийн үнийг эхлээд хадгалаад, захиалгыг дараа нь тусад нь шинэчилнэ.
    await prisma.$transaction(
      [...feeByRound.entries()].map(([roundId, cargoFee]) =>
        prisma.productRound.update({ where: { id: roundId }, data: { cargoFee } }),
      ),
    );
    const updatedCount = await syncCargoFeesForRounds(prisma, [...feeByRound.keys()]);

    await audit({
      actor: actorOf(req),
      action: 'UPDATE_CARGO_FEES',
      entity: 'Batch',
      entityId: batch.id,
      after: { items, ordersUpdated: updatedCount },
    });

    res.json({ data: { saved: feeByRound.size, ordersUpdated: updatedCount } });
  }),
);

/**
 * POST /batches/:id/products — хаагдсан гаргалтыг багцад холбоно.
 * `roundId` эсвэл `roundIds` — шинэ гаргалт үүсгэхгүй.
 */
adminBatchesRouter.post(
  '/:id/products',
  validate({
    params: idParams,
    body: z
      .object({
        roundId: z.string().min(1).optional(),
        roundIds: z.array(z.string().min(1)).max(100).optional(),
      })
      .refine((b) => Boolean(b.roundId || (b.roundIds && b.roundIds.length > 0)), {
        message: 'roundId эсвэл roundIds заавал.',
      }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { roundId?: string; roundIds?: string[] };
    const ids = [...new Set([...(body.roundIds ?? []), ...(body.roundId ? [body.roundId] : [])])];

    const batch = await prisma.batch.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!batch) throw notFound('Багц олдсонгүй.');
    if (!canEditBatchComposition(batch.stage)) {
      throw conflict('Агуулахад орсон багцад бараа нэмэх боломжгүй.');
    }

    const actor = actorOf(req);

    // Төлөгдөөгүйг цуцлаад, төлснийг «Зам дээр» болгоно (хаагдах үед хийгдээгүй бол).
    for (const id of ids) {
      await finalizeRoundClose(id, actor);
    }

    const linked = await prisma.$transaction(async (tx) => {
      const rounds = await tx.productRound.findMany({
        where: { id: { in: ids }, deletedAt: null },
        include: { product: { select: { id: true, name: true, images: true } } },
      });
      if (rounds.length !== ids.length) throw notFound('Зарим гаргалт олдсонгүй.');

      for (const existing of rounds) {
        if (existing.closeAt === null) {
          throw badRequest(`«${existing.product.name}» бэлэн бараа — багцад холбох боломжгүй.`);
        }
        if (existing.status !== 'CLOSED') {
          throw conflict(`«${existing.product.name}» хаагдаагүй — зөвхөн хаагдсан гаргалт нэмнэ.`);
        }
        if (existing.batchId === batch.id) {
          throw conflict(`«${existing.product.name}» багцад аль хэдийн холбогдсон.`);
        }
        if (existing.batchId) {
          throw conflict(`«${existing.product.name}» өөр багцад холбогдсон байна.`);
        }
      }

      const out = [];
      for (const existing of rounds) {
        const round = await tx.productRound.update({
          where: { id: existing.id },
          data: { batchId: batch.id },
          include: { product: { select: { id: true, name: true, images: true } } },
        });
        await attachOrdersForRound(tx, round.id, batch.id);
        const orderIds = await findOrderIdsForBatch(tx, batch.id, [round.id]);
        await promoteOrdersForBatchStage(tx, batch.id, batch.stage, actor, orderIds);
        out.push(round);
      }
      return out;
    });

    const stats = await roundStats(linked.map((r) => r.id));

    await audit({
      actor,
      action: 'BATCH_PRODUCT_LINK',
      entity: 'Batch',
      entityId: batch.id,
      after: {
        batchName: batch.name,
        roundIds: linked.map((r) => r.id),
        count: linked.length,
      },
    });

    res.status(201).json({
      data: linked.map((r) => {
        const s = stats.get(r.id);
        return {
          roundId: r.id,
          roundNo: r.roundNo,
          productId: r.product.id,
          name: r.product.name,
          image: r.product.images[0] ?? null,
          sellPrice: r.sellPrice,
          costPrice: r.costPrice,
          cargoFee: r.cargoFee,
          status: r.status,
          closeAt: r.closeAt?.toISOString() ?? null,
          orderedQty: s?.qty ?? 0,
          customerCount: s?.customerCount ?? 0,
        };
      }),
    });
  }),
);

/**
 * DELETE /batches/:id/products/:roundId — багцаас бараа салгах.
 * Захиалгатай бол тойргийг устгахгүй — зөвхөн багцаас салгаж, захиалгын
 * batchId-г цэвэрлэнэ. Захиалгагүй бол архивлана.
 */
adminBatchesRouter.delete(
  '/:id/products/:roundId',
  validate({ params: z.object({ id: z.string().min(1), roundId: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const batchId = req.params.id!;
    const roundId = req.params.roundId!;

    const batch = await prisma.batch.findFirst({ where: { id: batchId, deletedAt: null } });
    if (!batch) throw notFound('Багц олдсонгүй.');
    if (!canEditBatchComposition(batch.stage)) {
      throw conflict('Агуулахад орсон багцаас бараа хасах боломжгүй.');
    }

    const round = await prisma.productRound.findFirst({
      where: { id: roundId, batchId, deletedAt: null },
      include: { product: { select: { name: true } } },
    });
    if (!round) throw notFound('Багцад ийм бараа олдсонгүй.');

    const orderCount = await prisma.orderItem.count({
      where: {
        roundId: round.id,
        cancelledAt: null,
        order: { deletedAt: null, status: { not: 'CANCELLED' } },
      },
    });

    await prisma.$transaction(async (tx) => {
      await detachOrdersForRound(tx, round.id, batchId);
      if (orderCount > 0) {
        await tx.productRound.update({
          where: { id: round.id },
          data: { batchId: null },
        });
      } else {
        await tx.productRound.update({
          where: { id: round.id },
          data: { deletedAt: new Date(), status: 'ARCHIVED', batchId: null },
        });
      }
    });

    await audit({
      actor: actorOf(req),
      action: 'BATCH_PRODUCT_REMOVE',
      entity: 'ProductRound',
      entityId: round.id,
      before: { batchId, productName: round.product.name, roundNo: round.roundNo, orderCount },
    });

    res.json({ data: { removed: true, unlinked: orderCount > 0 } });
  }),
);

/**
 * POST /batches/:id/arrivals — ирсэн НИЙТ тоог сонголт бүрээр тавина (засаж болно).
 */
adminBatchesRouter.post(
  '/:id/arrivals',
  validate({
    params: idParams,
    body: z.object({
      lines: z
        .array(
          z.object({
            roundId: z.string().min(1),
            selections: z.record(z.string(), z.string()).default({}),
            arrivedQty: z.coerce.number().int().min(0).max(100_000),
          }),
        )
        .min(1)
        .max(200),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      lines: { roundId: string; selections: Record<string, string>; arrivedQty?: number; qty?: number }[];
    };
    const result = await registerBatchArrivals(
      param(req, 'id'),
      body.lines.map((l) => ({
        roundId: l.roundId,
        selections: l.selections,
        arrivedQty: l.arrivedQty ?? l.qty ?? 0,
      })),
      actorOf(req),
    );
    res.json({
      data: {
        allocated: result.allocated,
        released: result.released,
        unused: result.unused,
        ordersArrived: result.ordersArrived.length,
        ordersReverted: result.ordersReverted.length,
      },
    });
  }),
);

/**
 * POST /batches/:id/advance — дараагийн шат руу.
 * Дотор байгаа захиалгууд шатны дагуу автоматаар шилжинэ.
 */
adminBatchesRouter.post(
  '/:id/advance',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const result = await advanceBatch(param(req, 'id'), actorOf(req));

    res.json({
      data: {
        ...batchSummary(result.batch)!,
        nextStage: nextBatchStage(result.batch.stage),
        previousStage: previousBatchStage(result.batch.stage),
        ordersMoved: result.ordersMoved,
        ordersSkipped: result.ordersSkipped,
      },
    });
  }),
);

/**
 * POST /batches/:id/stage/revert — өмнөх шат руу нэг алхам буцаана.
 */
adminBatchesRouter.post(
  '/:id/stage/revert',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const result = await revertBatch(param(req, 'id'), actorOf(req));

    res.json({
      data: {
        ...batchSummary(result.batch)!,
        nextStage: nextBatchStage(result.batch.stage),
        previousStage: previousBatchStage(result.batch.stage),
        ordersMoved: result.ordersMoved,
        ordersSkipped: result.ordersSkipped,
      },
    });
  }),
);

/** POST /batches/:id/orders — захиалга нэмэх, хасах. */
adminBatchesRouter.post(
  '/:id/orders',
  validate({
    params: idParams,
    body: z.object({
      add: z.array(z.string().min(1)).max(500).default([]),
      remove: z.array(z.string().min(1)).max(500).default([]),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { add, remove } = req.body as { add: string[]; remove: string[] };

    const batch = await prisma.batch.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!batch) throw notFound('Багц олдсонгүй.');

    if (!canEditBatchComposition(batch.stage)) {
      throw conflict('Агуулахад орсон багцын бүрэлдэхүүнийг өөрчлөх боломжгүй.');
    }

    const result = await prisma.$transaction(async (tx) => {
      const added = add.length
        ? await tx.order.updateMany({
            where: {
              id: { in: add },
              deletedAt: null,
              batchId: null,
              status: { in: ['CONFIRMED', 'IN_BATCH'] },
            },
            data: { batchId: batch.id, batchOmittedAt: null },
          })
        : { count: 0 };

      const removed = remove.length
        ? await tx.order.updateMany({
            where: { id: { in: remove }, batchId: batch.id },
            data: { batchId: null, batchOmittedAt: null },
          })
        : { count: 0 };

      return { added: added.count, removed: removed.count };
    });

    await audit({
      actor: actorOf(req),
      action: 'UPDATE_ORDERS',
      entity: 'Batch',
      entityId: batch.id,
      after: result,
    });

    res.json({ data: result });
  }),
);

/**
 * POST /batches/:id/orders/:orderId/omit — багцаас хасах (төлбөр дутуу гэх мэт).
 * Зөвхөн Зам дээр байхад.
 */
adminBatchesRouter.post(
  '/:id/orders/:orderId/omit',
  validate({
    params: z.object({ id: z.string().min(1), orderId: z.string().min(1) }),
  }),
  asyncHandler(async (req, res) => {
    await omitOrderFromBatch(param(req, 'id'), param(req, 'orderId'), actorOf(req));
    res.json({ data: { omitted: true } });
  }),
);

/**
 * POST /batches/:id/orders/:orderId/reinstate — хассанг дахин оруулах.
 * Төлбөр бүрэн орсон үед (хоцорсон ч OK).
 */
adminBatchesRouter.post(
  '/:id/orders/:orderId/reinstate',
  validate({
    params: z.object({ id: z.string().min(1), orderId: z.string().min(1) }),
  }),
  asyncHandler(async (req, res) => {
    await reinstateOrderInBatch(param(req, 'id'), param(req, 'orderId'), actorOf(req));
    res.json({ data: { reinstated: true } });
  }),
);
