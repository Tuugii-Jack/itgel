import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { nextBatchStage } from '../../lib/orderStatus.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, param, query, validate } from '../../middleware/validate.js';
import { advanceBatch, attachOrdersForRound, detachOrdersForRound, resyncArrivalsForBatch } from '../../services/batches.js';
import { roundStats } from '../../services/roundStats.js';
import { batchSummary, orderStatusLabel } from '../../services/serialize.js';
import { getSettings } from '../../services/settings.js';

export const adminBatchesRouter = Router();

const idParams = z.object({ id: z.string().min(1) });

const listQuery = z.object({
  stage: z
    .enum(['COLLECTING', 'CLOSED', 'AT_SUPPLIER', 'IN_TRANSIT', 'AT_WAREHOUSE', 'DONE'])
    .optional(),
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
        createdAt: batch.createdAt.toISOString(),
      })),
      meta: { total, page: q.page, pageSize: q.pageSize, pages: Math.ceil(total / q.pageSize) },
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
        orders: {
          where: { deletedAt: null },
          include: {
            customer: { select: { id: true, name: true, phone: true } },
            items: { select: { qty: true, cancelledAt: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
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

    const stats = await roundStats(batch.rounds.map((r) => r.id));

    res.json({
      data: {
        ...batchSummary(batch)!,
        nextStage: nextBatchStage(batch.stage),
        orders: batch.orders.map((order) => ({
          id: order.id,
          code: order.code,
          status: order.status,
          statusLabel: orderStatusLabel(order.status),
          subtotal: order.subtotal,
          dueAmount: order.dueAmount,
          itemCount: order.items
            .filter((i) => i.cancelledAt === null)
            .reduce((sum, i) => sum + i.qty, 0),
          customer: { id: order.customer.id, name: order.customer.name, phone: order.customer.phone },
          createdAt: order.createdAt.toISOString(),
        })),
        /** Энэ багцад зориулж гаргасан бараанууд — тойрог тус бүрээр. */
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
            status: round.status,
            closeAt: round.closeAt?.toISOString() ?? null,
            orderedQty: s?.qty ?? 0,
            customerCount: s?.customerCount ?? 0,
          };
        }),
        totalValue: batch.orders.reduce((sum, o) => sum + o.subtotal, 0),
        totalDue: batch.orders.reduce((sum, o) => sum + Math.max(0, o.dueAmount), 0),
        createdAt: batch.createdAt.toISOString(),
      },
    });
  }),
);

/**
 * POST /batches — шинэ багц үүсгэнэ.
 *
 * Багц-түрүүлэх урсгал: багцыг ЭХЛЭЭД (хоосон) үүсгэж, дараа нь бараагаа
 * нэмнэ. Тэдгээр барааны захиалгууд баталгаажихдаа автоматаар энэ багц
 * руу орно. `orderIds` өгвөл байгаа баталгаажсан захиалгуудыг шууд хавсаргана.
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
            status: 'CONFIRMED',
            id: { in: body.orderIds },
          },
          select: { id: true },
        })
      : [];

    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.batch.create({
        data: {
          name: body.name,
          deadline: body.deadline ?? null,
          weightKg: body.weightKg ?? null,
          etaFrom: body.etaFrom ?? null,
          etaTo: body.etaTo ?? null,
        },
      });
      if (orders.length > 0) {
        await tx.order.updateMany({
          where: { id: { in: orders.map((o) => o.id) } },
          data: { batchId: created.id },
        });
      }
      return created;
    });

    await audit({
      actor: actorOf(req),
      action: 'CREATE',
      entity: 'Batch',
      entityId: batch.id,
      after: { name: batch.name, deadline: batch.deadline, orderCount: orders.length },
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
    const body = req.body as { deadline?: Date | null };

    const before = await prisma.batch.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!before) throw notFound('Багц олдсонгүй.');

    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.batch.update({ where: { id: before.id }, data: req.body });

      // Багцын хугацаа солигдвол холбогдсон бүх урьдчилсан тойргийн closeAt
      // болон захиалсан хүмүүсийн ирэх огноог дагаж шинэчилнэ.
      if (body.deadline !== undefined && body.deadline !== null) {
        await tx.productRound.updateMany({
          where: { batchId: before.id, deletedAt: null, closeAt: { not: null } },
          data: { closeAt: body.deadline },
        });
        const rounds = await tx.productRound.findMany({
          where: { batchId: before.id, deletedAt: null, closeAt: { not: null } },
          select: { id: true, closeAt: true, leadMinDays: true, leadMaxDays: true },
        });
        await resyncArrivalsForBatch(tx, updated, rounds);
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
 * POST /batches/:id/products — багцад бараа нэмнэ.
 *
 * - `roundId` өгвөл одоо байгаа урьдчилсан гаргалтыг холбоно (захиалгууд дагана).
 * - Эсвэл `productId`-аар ШИНЭ тойрог үүсгэнэ.
 */
adminBatchesRouter.post(
  '/:id/products',
  validate({
    params: idParams,
    body: z
      .object({
        roundId: z.string().min(1).optional(),
        productId: z.string().min(1).optional(),
        costPrice: z.coerce.number().int().min(0).optional(),
        sellPrice: z.coerce.number().int().min(0).optional(),
        closeAt: z.coerce.date().optional(),
        leadMinDays: z.coerce.number().int().min(0).max(365).optional(),
        leadMaxDays: z.coerce.number().int().min(0).max(365).optional(),
        note: z.string().trim().max(300).optional(),
        /** Анхдагчаар шууд идэвхтэй — багцад нэмсэн бараа дэлгүүрт гарна. */
        status: z.enum(['ACTIVE', 'DRAFT', 'HIDDEN']).default('ACTIVE'),
      })
      .refine((b) => Boolean(b.roundId || b.productId), {
        message: 'productId эсвэл roundId заавал.',
      }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      roundId?: string;
      productId?: string;
      costPrice?: number;
      sellPrice?: number;
      closeAt?: Date;
      leadMinDays?: number;
      leadMaxDays?: number;
      note?: string;
      status: 'ACTIVE' | 'DRAFT' | 'HIDDEN';
    };

    const batch = await prisma.batch.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!batch) throw notFound('Багц олдсонгүй.');
    if (batch.stage !== 'COLLECTING') {
      throw conflict('Захиалга авах шатнаас гарсан багцад бараа нэмэх боломжгүй.');
    }

    // --- Одоо байгаа урьдчилсан гаргалт холбох ---
    if (body.roundId) {
      const existing = await prisma.productRound.findFirst({
        where: { id: body.roundId, deletedAt: null },
        include: { product: { select: { id: true, name: true, images: true } } },
      });
      if (!existing) throw notFound('Гаргалт олдсонгүй.');
      if (existing.closeAt === null) {
        throw badRequest('Бэлэн барааг багцад холбох боломжгүй — зөвхөн урьдчилсан.');
      }
      if (existing.batchId === batch.id) {
        throw conflict('Энэ гаргалт багцад аль хэдийн холбогдсон.');
      }
      if (existing.batchId) {
        throw conflict('Энэ гаргалт өөр багцад холбогдсон байна.');
      }

      const linked = await prisma.$transaction(async (tx) => {
        const closeAt = body.closeAt ?? batch.deadline ?? existing.closeAt;
        const round = await tx.productRound.update({
          where: { id: existing.id },
          data: {
            batchId: batch.id,
            ...(closeAt ? { closeAt } : {}),
          },
          include: { product: { select: { id: true, name: true, images: true } } },
        });
        await attachOrdersForRound(tx, round.id, batch.id);
        await resyncArrivalsForBatch(tx, batch, [
          {
            id: round.id,
            closeAt: round.closeAt,
            leadMinDays: round.leadMinDays,
            leadMaxDays: round.leadMaxDays,
          },
        ]);
        return round;
      });

      const stats = await roundStats([linked.id]);
      const s = stats.get(linked.id);

      await audit({
        actor: actorOf(req),
        action: 'BATCH_PRODUCT_LINK',
        entity: 'ProductRound',
        entityId: linked.id,
        after: {
          batchId: batch.id,
          batchName: batch.name,
          productId: linked.product.id,
          productName: linked.product.name,
          roundNo: linked.roundNo,
        },
      });

      res.status(201).json({
        data: {
          roundId: linked.id,
          roundNo: linked.roundNo,
          productId: linked.product.id,
          name: linked.product.name,
          image: linked.product.images[0] ?? null,
          sellPrice: linked.sellPrice,
          costPrice: linked.costPrice,
          status: linked.status,
          closeAt: linked.closeAt?.toISOString() ?? null,
          orderedQty: s?.qty ?? 0,
          customerCount: s?.customerCount ?? 0,
        },
      });
      return;
    }

    // --- Шинэ тойрог үүсгэх ---
    const closeAt = body.closeAt ?? batch.deadline;
    if (!closeAt) {
      throw badRequest('Хаах огноо алга — багцын хугацааг тохируулах эсвэл огноо өгнө үү.');
    }

    const product = await prisma.product.findFirst({
      where: { id: body.productId!, deletedAt: null },
      include: { rounds: { where: { deletedAt: null }, orderBy: { roundNo: 'desc' } } },
    });
    if (!product) throw notFound('Бараа олдсонгүй.');

    if (product.rounds.some((r) => r.batchId === batch.id)) {
      throw conflict('Энэ бараа багцад аль хэдийн нэмэгдсэн байна.');
    }

    const last = product.rounds[0];
    const costPrice = body.costPrice ?? last?.costPrice;
    const sellPrice = body.sellPrice ?? last?.sellPrice;
    if (costPrice === undefined || sellPrice === undefined) {
      throw badRequest('Өмнөх тойрог байхгүй тул үнийг заавал өгнө үү.');
    }

    const settings = await getSettings();
    const leadMinDays = body.leadMinDays ?? last?.leadMinDays ?? settings.defaultLeadMinDays;
    const leadMaxDays = body.leadMaxDays ?? last?.leadMaxDays ?? settings.defaultLeadMaxDays;
    if (leadMinDays > leadMaxDays) throw badRequest('leadMinDays нь leadMaxDays-с их байж болохгүй.');

    const maxNo = await prisma.productRound.aggregate({
      where: { productId: product.id },
      _max: { roundNo: true },
    });

    const round = await prisma.productRound.create({
      data: {
        productId: product.id,
        batchId: batch.id,
        roundNo: (maxNo._max.roundNo ?? 0) + 1,
        costPrice,
        sellPrice,
        stock: 0,
        closeAt,
        leadMinDays,
        leadMaxDays,
        status: body.status,
        note: body.note ?? null,
      },
    });

    await audit({
      actor: actorOf(req),
      action: 'BATCH_PRODUCT_ADD',
      entity: 'ProductRound',
      entityId: round.id,
      after: {
        batchId: batch.id,
        batchName: batch.name,
        productId: product.id,
        productName: product.name,
        roundNo: round.roundNo,
        sellPrice,
        closeAt: round.closeAt,
      },
    });

    res.status(201).json({
      data: {
        roundId: round.id,
        roundNo: round.roundNo,
        productId: product.id,
        name: product.name,
        image: product.images[0] ?? null,
        sellPrice: round.sellPrice,
        costPrice: round.costPrice,
        status: round.status,
        closeAt: round.closeAt?.toISOString() ?? null,
        orderedQty: 0,
        customerCount: 0,
      },
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

    if (batch.stage !== 'COLLECTING' && batch.stage !== 'CLOSED') {
      throw conflict('Зам дээр гарсан багцын бүрэлдэхүүнийг өөрчлөх боломжгүй.');
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
            data: { batchId: batch.id },
          })
        : { count: 0 };

      const removed = remove.length
        ? await tx.order.updateMany({
            where: { id: { in: remove }, batchId: batch.id },
            data: { batchId: null },
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
