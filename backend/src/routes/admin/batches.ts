import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { conflict, notFound } from '../../lib/errors.js';
import {
  BATCH_STAGE_LABEL,
  nextBatchStage,
  orderStatusForBatchStage,
  stepsToStatus,
} from '../../lib/orderStatus.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import { changeOrderStatus } from '../../services/orders.js';
import { batchSummary } from '../../services/serialize.js';

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
          orders: {
            where: { deletedAt: null },
            select: { id: true, code: true, status: true, subtotal: true },
          },
        },
      }),
    ]);

    res.json({
      data: batches.map((batch) => ({
        ...batchSummary(batch)!,
        orderCount: batch.orders.length,
        totalValue: batch.orders.reduce((sum, o) => sum + o.subtotal, 0),
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
          include: { customer: true, items: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!batch) throw notFound('Багц олдсонгүй.');

    res.json({
      data: {
        ...batchSummary(batch)!,
        nextStage: nextBatchStage(batch.stage),
        orders: batch.orders.map((order) => ({
          id: order.id,
          code: order.code,
          status: order.status,
          subtotal: order.subtotal,
          itemCount: order.items.reduce((sum, i) => sum + i.qty, 0),
          customer: { name: order.customer.name, phone: order.customer.phone },
        })),
        createdAt: batch.createdAt.toISOString(),
      },
    });
  }),
);

/** POST /batches — баталгаажсан, багцгүй захиалгуудаас багц үүсгэнэ. */
adminBatchesRouter.post(
  '/',
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(80),
      orderIds: z.array(z.string().min(1)).max(500).optional(),
      weightKg: z.coerce.number().int().min(0).max(100000).optional(),
      etaFrom: z.coerce.date().optional(),
      etaTo: z.coerce.date().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      name: string;
      orderIds?: string[];
      weightKg?: number;
      etaFrom?: Date;
      etaTo?: Date;
    };

    const orders = await prisma.order.findMany({
      where: {
        deletedAt: null,
        batchId: null,
        status: 'CONFIRMED',
        ...(body.orderIds ? { id: { in: body.orderIds } } : {}),
      },
      select: { id: true, status: true },
    });

    if (orders.length === 0) {
      throw conflict('Багцлах баталгаажсан захиалга алга байна.');
    }

    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.batch.create({
        data: {
          name: body.name,
          weightKg: body.weightKg ?? null,
          etaFrom: body.etaFrom ?? null,
          etaTo: body.etaTo ?? null,
        },
      });
      await tx.order.updateMany({
        where: { id: { in: orders.map((o) => o.id) } },
        data: { batchId: created.id },
      });
      return created;
    });

    await audit({
      actor: actorOf(req),
      action: 'CREATE',
      entity: 'Batch',
      entityId: batch.id,
      after: { name: batch.name, orderCount: orders.length },
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
      weightKg: z.coerce.number().int().min(0).max(100000).nullable().optional(),
      etaFrom: z.coerce.date().nullable().optional(),
      etaTo: z.coerce.date().nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const before = await prisma.batch.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!before) throw notFound('Багц олдсонгүй.');

    const after = await prisma.batch.update({ where: { id: before.id }, data: req.body });
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
 * POST /batches/:id/advance — дараагийн шат руу.
 * Дотор байгаа захиалгууд шатны дагуу автоматаар шилжинэ.
 */
adminBatchesRouter.post(
  '/:id/advance',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const batch = await prisma.batch.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: { orders: { where: { deletedAt: null }, select: { id: true, status: true } } },
    });
    if (!batch) throw notFound('Багц олдсонгүй.');

    const next = nextBatchStage(batch.stage);
    if (!next) throw conflict('Багц эцсийн шатанд байна.');

    const updated = await prisma.batch.update({
      where: { id: batch.id },
      data: {
        stage: next,
        ...(next === 'CLOSED' && !batch.closedAt ? { closedAt: new Date() } : {}),
      },
    });

    const targetStatus = orderStatusForBatchStage(next);
    const actor = actorOf(req);
    const moved: string[] = [];

    if (targetStatus) {
      for (const order of batch.orders) {
        const steps = stepsToStatus(order.status, targetStatus);
        for (const step of steps) {
          await changeOrderStatus(order.id, step, {
            actor,
            reason: `Багц "${batch.name}" → ${BATCH_STAGE_LABEL[next]}`,
          });
        }
        if (steps.length > 0) moved.push(order.id);
      }
    }

    await audit({
      actor,
      action: 'ADVANCE',
      entity: 'Batch',
      entityId: batch.id,
      before: { stage: batch.stage },
      after: { stage: next, ordersMoved: moved.length },
    });

    res.json({
      data: {
        ...batchSummary(updated)!,
        nextStage: nextBatchStage(next),
        ordersMoved: moved.length,
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
