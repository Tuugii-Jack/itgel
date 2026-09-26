import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import {
  canEditBatchComposition,
  nextBatchStage,
  previousBatchStage,
} from '../../lib/orderStatus.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, param, query, validate } from '../../middleware/validate.js';
import { sendBatchArrivalSms, previewBatchArrivalSms } from '../../modules/batches/arrivalSms.js';
import { loadBatchDetail } from '../../modules/batches/detail.js';
import { listEligibleMonths, listEligibleRounds } from '../../modules/batches/eligible.js';
import { listBatches } from '../../modules/batches/list.js';
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
import { confirmBatchArrivalAdds, previewBatchArrivalAdds, registerBatchArrivals } from '../../services/batchArrival.js';
import { roundStats } from '../../services/roundStats.js';
import { finalizeRoundClose } from '../../services/orders.js';
import { batchSummary } from '../../services/serialize.js';
import { syncCargoFeesForRounds } from '../../services/cargoFee.js';
import { skuKeyOf } from '../../lib/skuStock.js';

export const adminBatchesRouter = Router();

const idParams = z.object({ id: z.string().min(1) });

const listQuery = z.object({
  stage: z.enum(['IN_TRANSIT', 'AT_WAREHOUSE', 'DONE']).optional(),
  progress: z.enum(['in_transit', 'partial', 'complete', 'mismatch']).optional(),
  q: z.string().trim().max(80).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

adminBatchesRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof listQuery>>(req);
    res.json(await listBatches(q));
  }),
);

/**
 * GET /batches/eligible-months — багцад нэмэх боломжтой хаагдсан гаргалтын сарууд.
 */
adminBatchesRouter.get(
  '/eligible-months',
  asyncHandler(async (_req, res) => {
    res.json({ data: await listEligibleMonths() });
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
    res.json(await listEligibleRounds(q.year, q.month));
  }),
);

adminBatchesRouter.get(
  '/:id',
  validate({
    params: idParams,
    query: z.object({
      slim: z.enum(['1', 'true']).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ slim?: string }>(req);
    res.json({ data: await loadBatchDetail(param(req, 'id'), { includeOrders: !q.slim }) });
  }),
);

/**
 * POST /batches/:id/arrival-sms — агуулахад орсон багцын захиалагчдад SMS.
 * orderId байвал нэг хүнд (дахин илгээж болно); байхгүй бол илгээгээгүй бүгдэд.
 */
adminBatchesRouter.post(
  '/:id/arrival-sms',
  validate({
    params: idParams,
    body: z.object({
      orderId: z.string().min(1).optional(),
      resend: z.boolean().optional(),
      previewToken: z.string().min(8).max(128),
      sendKey: z.string().trim().min(8).max(128),
      commonText: z.string().max(400).optional(),
      overrides: z
        .array(z.object({ orderId: z.string().min(1), text: z.string().max(400) }))
        .max(200)
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { orderId, resend, previewToken, commonText, overrides, sendKey } = req.body as {
      orderId?: string;
      resend?: boolean;
      previewToken?: string;
      commonText?: string;
      overrides?: { orderId: string; text: string }[];
      sendKey?: string;
    };
    res.json({
      data: await sendBatchArrivalSms({
        batchId: param(req, 'id'),
        orderId,
        resend,
        actor: actorOf(req),
        previewToken,
        commonText,
        overrides,
        sendKey,
      }),
    });
  }),
);

adminBatchesRouter.get(
  '/:id/arrival-sms/preview',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    res.json({ data: await previewBatchArrivalSms(param(req, 'id')) });
  }),
);

adminBatchesRouter.post(
  '/:id/arrival-sms/preview',
  validate({
    params: idParams,
    body: z.object({
      commonText: z.string().max(400).optional(),
      overrides: z
        .array(z.object({ orderId: z.string().min(1), text: z.string().max(400) }))
        .max(200)
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      commonText?: string;
      overrides?: { orderId: string; text: string }[];
    };
    res.json({ data: await previewBatchArrivalSms(param(req, 'id'), body) });
  }),
);

adminBatchesRouter.get(
  '/:id/audit',
  validate({
    params: idParams,
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  }),
  asyncHandler(async (req, res) => {
    const limit = query<{ limit: number }>(req).limit;
    const logs = await prisma.auditLog.findMany({
      where: { entity: 'Batch', entityId: param(req, 'id') },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json({
      data: logs.map((log) => ({
        id: log.id,
        actor: log.actor,
        action: log.action,
        entity: log.entity,
        entityId: log.entityId,
        before: log.before,
        after: log.after,
        createdAt: log.createdAt.toISOString(),
      })),
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
      cargoRef: z.string().trim().max(80).nullable().optional(),
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
      cargoRef?: string | null;
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
          cargoRef: body.cargoRef || null,
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
      cargoRef: z.string().trim().max(80).nullable().optional(),
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
 * POST /batches/:id/cargo-fees — бараа/сонголт бүрийн нэгж карго үнийг хадгалж,
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
            variants: z
              .array(
                z.object({
                  selections: z.record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(40)),
                  cargoFee: z.coerce.number().int().min(0).max(10_000_000),
                }),
              )
              .max(200)
              .optional(),
          }),
        )
        .min(1)
        .max(200),
    }),
  }),
  asyncHandler(async (req, res) => {
    const batchId = param(req, 'id');
    const { items } = req.body as {
      items: {
        roundId: string;
        cargoFee: number;
        variants?: { selections: Record<string, string>; cargoFee: number }[];
      }[];
    };
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

    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        await tx.productRound.update({
          where: { id: item.roundId },
          data: { cargoFee: item.cargoFee },
        });
        await tx.roundCargoFee.deleteMany({ where: { roundId: item.roundId } });
        const variants = item.variants ?? [];
        const rows = new Map<
          string,
          { selections: Record<string, string>; cargoFee: number }
        >();
        for (const row of variants) {
          const key = skuKeyOf(row.selections);
          if (!key) continue;
          rows.set(key, { selections: row.selections, cargoFee: row.cargoFee });
        }
        if (rows.size === 0) continue;
        await tx.roundCargoFee.createMany({
          data: [...rows.entries()].map(([skuKey, row]) => ({
            roundId: item.roundId,
            skuKey,
            selections: row.selections,
            cargoFee: row.cargoFee,
          })),
        });
      }
    });
    const updatedCount = await syncCargoFeesForRounds(prisma, uniqueIds);

    await audit({
      actor: actorOf(req),
      action: 'UPDATE_CARGO_FEES',
      entity: 'Batch',
      entityId: batch.id,
      after: { items, ordersUpdated: updatedCount },
    });

    res.json({ data: { saved: uniqueIds.length, ordersUpdated: updatedCount } });
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
 * POST /batches/:id/arrivals/preview — FIFO хуваарилалтыг батлахаас өмнө харуулна.
 * SMS илгээхгүй, stock өөрчлөхгүй.
 */
adminBatchesRouter.post(
  '/:id/arrivals/preview',
  validate({
    params: idParams,
    body: z.object({
      lines: z
        .array(
          z.object({
            roundId: z.string().min(1),
            selections: z.record(z.string(), z.string()).default({}),
            addQty: z.coerce.number().int().min(0).max(100_000),
          }),
        )
        .min(1)
        .max(200),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      lines: { roundId: string; selections: Record<string, string>; addQty: number }[];
    };
    res.json({ data: await previewBatchArrivalAdds(param(req, 'id'), body.lines) });
  }),
);

/**
 * POST /batches/:id/arrivals — ирсэн НИЙТ тоог тавина, эсвэл энэ удаагийн addQty-г батална.
 */
adminBatchesRouter.post(
  '/:id/arrivals',
  validate({
    params: idParams,
    body: z.object({
      reason: z.string().trim().max(300).optional(),
      expected: z
        .array(
          z.object({
            roundId: z.string().min(1),
            selections: z.record(z.string(), z.string()).default({}),
            arrivedQty: z.coerce.number().int().min(0).max(100_000),
          }),
        )
        .max(200)
        .optional(),
      notes: z
        .array(
          z.object({
            roundId: z.string().min(1),
            selections: z.record(z.string(), z.string()).default({}),
            kind: z.enum(['DAMAGED', 'SHORT', 'EXCESS']),
            qty: z.coerce.number().int().min(1).max(100_000),
            note: z.string().trim().max(300).default(''),
          }),
        )
        .max(50)
        .optional(),
      lines: z
        .array(
          z.object({
            roundId: z.string().min(1),
            selections: z.record(z.string(), z.string()).default({}),
            arrivedQty: z.coerce.number().int().min(0).max(100_000).optional(),
            addQty: z.coerce.number().int().min(0).max(100_000).optional(),
          }),
        )
        .min(1)
        .max(200),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      reason?: string;
      expected?: { roundId: string; selections: Record<string, string>; arrivedQty: number }[];
      notes?: {
        roundId: string;
        selections: Record<string, string>;
        kind: 'DAMAGED' | 'SHORT' | 'EXCESS';
        qty: number;
        note: string;
      }[];
      lines: {
        roundId: string;
        selections: Record<string, string>;
        arrivedQty?: number;
        addQty?: number;
        qty?: number;
      }[];
    };
    const adds = body.lines.filter((l) => l.addQty != null);
    if (adds.length > 0 && !(body.expected && body.expected.length > 0)) {
      throw badRequest('Preview баталгаа алга. Эхлээд хуваарилалтыг шалгана уу.');
    }
    const result =
      adds.length > 0
        ? await confirmBatchArrivalAdds(
            param(req, 'id'),
            {
              lines: body.lines.map((l) => ({
                roundId: l.roundId,
                selections: l.selections,
                addQty: l.addQty ?? 0,
              })),
              expected: body.expected ?? [],
              notes: body.notes,
            },
            actorOf(req),
          )
        : await registerBatchArrivals(
            param(req, 'id'),
            body.lines.map((l) => ({
              roundId: l.roundId,
              selections: l.selections,
              arrivedQty: l.arrivedQty ?? l.qty ?? 0,
            })),
            actorOf(req),
            new Date(),
            { expected: body.expected, reason: body.reason, notes: body.notes },
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
