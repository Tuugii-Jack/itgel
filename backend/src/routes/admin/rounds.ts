import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { actorOf } from '../../middleware/auth.js';
import { profitOf } from '../../lib/money.js';
import { ORDER_STATUS_LABEL } from '../../lib/orderStatus.js';
import { asyncHandler, validate } from '../../middleware/validate.js';
import { computeTotals, paymentState } from '../../services/money.js';
import {
  attachOrdersForRound,
  detachOrdersForRound,
  resyncArrivalsForBatch,
} from '../../services/batches.js';
import { finalizeRoundClose } from '../../services/orders.js';
import { adminRound } from '../../services/serialize.js';
import { replaceRoundOptionPrices } from '../../lib/optionPrices.js';
import { selectionsOf, sizeColorFromSelections } from '../../lib/options.js';
import { productStatus, roundFields } from './products.js';
import { computeArrival } from '../../lib/date.js';

/**
 * Барааны тойрог — үнэ, хаах огноо, үлдэгдэл, төлөв нь энд байна.
 * Загварын нэр, зураг, хэмжээг `/admin/products` дээрээс засна.
 */
export const adminRoundsRouter = Router();

const idParams = z.object({ id: z.string().min(1) });

const roundInclude = {
  product: {
    include: {
      category: true,
      variants: { orderBy: { sortOrder: 'asc' as const } },
      sizeChart: { orderBy: { sortOrder: 'asc' as const } },
    },
  },
  optionPrices: true,
};

adminRoundsRouter.get(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const round = await prisma.productRound.findUnique({
      where: { id: req.params.id },
      include: roundInclude,
    });
    if (!round) throw notFound('Тойрог олдсонгүй.');
    res.json({ data: adminRound(round) });
  }),
);

/**
 * GET /:id/orders — энэ гаргалтыг хэн хэн авсан бэ.
 *
 * Урьдчилсан захиалгын дэлгүүрт хамгийн хэрэгтэй харагдац: нийлүүлэгч рүү
 * юу захиалахаа мэдэхийн тулд хэмжээ/өнгөөр нь задалж өгнө.
 * Цуцлагдсан мөр, цуцлагдсан захиалгыг тоонд оруулахгүй — тэднийг
 * жагсаалтад үзүүлэх боловч тэмдэглэсэн байна.
 */
adminRoundsRouter.get(
  '/:id/orders',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const round = await prisma.productRound.findUnique({
      where: { id: req.params.id },
      include: { product: { select: { id: true, name: true } } },
    });
    if (!round) throw notFound('Тойрог олдсонгүй.');

    const items = await prisma.orderItem.findMany({
      where: { roundId: round.id, order: { deletedAt: null } },
      include: { order: { include: { customer: true } } },
      orderBy: { order: { createdAt: 'desc' } },
    });

    const rows = items.map((item) => {
      const cancelled = item.cancelledAt !== null || item.order.status === 'CANCELLED';
      const selections = (() => {
        const fromJson = selectionsOf(item.selections);
        if (Object.keys(fromJson).length > 0) return fromJson;
        const legacy: Record<string, string> = {};
        if (item.size) legacy['Хэмжээ'] = item.size;
        if (item.color) legacy['Өнгө'] = item.color;
        return legacy;
      })();
      const { size, color } = sizeColorFromSelections(selections);
      return {
        orderId: item.order.id,
        code: item.order.code,
        status: item.order.status,
        statusLabel: ORDER_STATUS_LABEL[item.order.status],
        paymentState: paymentState(computeTotals(item.order)),
        dueAmount: item.order.dueAmount,
        paymentClaimedAt: item.order.paymentClaimedAt?.toISOString() ?? null,
        createdAt: item.order.createdAt.toISOString(),
        customer: {
          id: item.order.customer.id,
          name: item.order.customer.name,
          phone: item.order.customer.phone,
        },
        selections,
        size: size ?? item.size,
        color: color ?? item.color,
        qty: item.qty,
        unitPrice: item.unitPrice,
        total: item.unitPrice * item.qty,
        cancelled,
        cancelReason: item.cancelReason,
      };
    });

    const live = rows.filter((r) => !r.cancelled);

    // Сонголтоор задаргаа — нийлүүлэгч рүү явуулах жагсаалт.
    const variantMap = new Map<
      string,
      { selections: Record<string, string>; size: string | null; color: string | null; qty: number }
    >();
    for (const row of live) {
      const key = JSON.stringify(row.selections);
      const entry =
        variantMap.get(key) ?? {
          selections: row.selections,
          size: row.size,
          color: row.color,
          qty: 0,
        };
      entry.qty += row.qty;
      variantMap.set(key, entry);
    }

    const byStatus: Record<string, number> = {};
    for (const row of live) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;

    const liveItems = items.filter(
      (i) => i.cancelledAt === null && i.order.status !== 'CANCELLED',
    );

    res.json({
      data: {
        round: {
          id: round.id,
          roundNo: round.roundNo,
          productId: round.product.id,
          name: round.product.name,
          sellPrice: round.sellPrice,
          costPrice: round.costPrice,
          status: round.status,
          closeAt: round.closeAt?.toISOString() ?? null,
        },
        summary: {
          customerCount: new Set(live.map((r) => r.customer.id)).size,
          orderCount: new Set(live.map((r) => r.orderId)).size,
          qty: live.reduce((sum, r) => sum + r.qty, 0),
          revenue: live.reduce((sum, r) => sum + r.total, 0),
          profit: profitOf(liveItems),
          /** Мөнгө нь ороогүй захиалгын тоо — эдгээр эргэлзээтэй. */
          unpaidCount: live.filter((r) => r.dueAmount > 0).length,
          cancelledCount: rows.length - live.length,
          byStatus,
          byVariant: [...variantMap.values()].sort((a, b) => b.qty - a.qty),
        },
        orders: rows,
      },
    });
  }),
);

const patchBody = z
  .object({
    costPrice: roundFields.costPrice.optional(),
    sellPrice: roundFields.sellPrice.optional(),
    stock: z.coerce.number().int().min(0).optional(),
    closeAt: roundFields.closeAt,
    leadMinDays: roundFields.leadMinDays,
    leadMaxDays: roundFields.leadMaxDays,
    status: productStatus.optional(),
    note: roundFields.note.nullable(),
    /** null = багцаас салгах; string = IN_TRANSIT багцад холбох. */
    batchId: z.string().min(1).nullable().optional(),
    optionPrices: roundFields.optionPrices,
  })
  .partial();

adminRoundsRouter.patch(
  '/:id',
  validate({ params: idParams, body: patchBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof patchBody>;

    const before = await prisma.productRound.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: roundInclude,
    });
    if (!before) throw notFound('Тойрог олдсонгүй.');

    const leadMinDays = body.leadMinDays ?? before.leadMinDays;
    const leadMaxDays = body.leadMaxDays ?? before.leadMaxDays;
    if (leadMinDays > leadMaxDays) throw badRequest('leadMinDays нь leadMaxDays-с их байж болохгүй.');

    // Хугацаа нь өнгөрсөн тойргийг дахин нээхээс сэргийлнэ.
    //
    // Нээвэл ирэх огноо нь ч өнгөрсөн болж, cron дараагийн ажиллагаандаа
    // дахин хаана. Хамгийн муу нь — тэр хооронд захиалга орж ирвэл хэрэглэгчид
    // өнгөрсөн огноо амлагдана. Зөв үйлдэл нь шинэ гаргалт үүсгэх.
    // Огноогоо хамт сунгаж байгаа бол зөвшөөрнө.
    const nextStatus = body.status ?? before.status;
    const nextCloseAt = body.closeAt === undefined ? before.closeAt : body.closeAt;
    if (nextStatus === 'ACTIVE' && nextCloseAt !== null && nextCloseAt <= new Date()) {
      throw conflict(
        'Хаагдах хугацаа нь өнгөрсөн тойргийг дахин нээх боломжгүй. ' +
          'Шинэ огноо тавих, эсвэл «Дахин гаргах»-аар шинэ гаргалт үүсгэнэ үү.',
        { closeAt: nextCloseAt.toISOString() },
      );
    }

    let batchId: string | null | undefined = body.batchId;
    if (batchId) {
      const batch = await prisma.batch.findFirst({
        where: { id: batchId, deletedAt: null, stage: 'IN_TRANSIT' },
      });
      if (!batch) throw badRequest('Багц олдсонгүй, эсвэл захиалга авах шатнаас гарсан.');
    }

    if (before.closeAt === null && batchId) {
      throw badRequest('Бэлэн барааг багцад холбох боломжгүй — зөвхөн урьдчилсан.');
    }

    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.productRound.update({
        where: { id: before.id },
        data: {
          costPrice: body.costPrice,
          sellPrice: body.sellPrice,
          stock: body.stock,
          closeAt: body.closeAt === undefined ? undefined : body.closeAt,
          leadMinDays: body.leadMinDays,
          leadMaxDays: body.leadMaxDays,
          status: body.status,
          note: body.note,
          ...(batchId !== undefined ? { batchId } : {}),
        },
        include: roundInclude,
      });

      await replaceRoundOptionPrices(tx, updated.id, body.optionPrices);

      if (batchId !== undefined) {
        if (batchId) {
          await attachOrdersForRound(tx, updated.id, batchId);
        } else if (before.batchId) {
          await detachOrdersForRound(tx, updated.id, before.batchId);
        }
      }

      // Огноо/хүлээх хоног солигдвол захиалсан хүмүүсийн ирэх огноог дагана.
      const closeChanged = body.closeAt !== undefined;
      const leadChanged = body.leadMinDays !== undefined || body.leadMaxDays !== undefined;
      if ((closeChanged || leadChanged) && updated.closeAt) {
        const { arriveFrom, arriveTo } = computeArrival(
          updated.closeAt,
          updated.leadMinDays,
          updated.leadMaxDays,
        );
        await tx.orderItem.updateMany({
          where: {
            roundId: updated.id,
            cancelledAt: null,
            order: {
              deletedAt: null,
              status: { notIn: ['CANCELLED', 'HANDED_OVER'] },
            },
          },
          data: { arriveFrom, arriveTo },
        });
      } else if (batchId && updated.closeAt) {
        await resyncArrivalsForBatch(tx, { id: batchId }, [
          {
            id: updated.id,
            closeAt: updated.closeAt,
            leadMinDays: updated.leadMinDays,
            leadMaxDays: updated.leadMaxDays,
          },
        ]);
      }

      return tx.productRound.findUniqueOrThrow({
        where: { id: updated.id },
        include: roundInclude,
      });
    });

    await audit({
      actor: actorOf(req),
      action: 'UPDATE',
      entity: 'ProductRound',
      entityId: after.id,
      before: adminRound(before),
      after: adminRound(after),
    });

    // Хаагдах үед: төлөгдөөгүйг цуцлаад, төлснийг «Зам дээр» болгоно.
    if (before.status !== 'CLOSED' && after.status === 'CLOSED') {
      await finalizeRoundClose(after.id, actorOf(req));
    }

    res.json({ data: adminRound(after) });
  }),
);

adminRoundsRouter.post(
  '/bulk-status',
  validate({
    body: z.object({
      ids: z.array(z.string().min(1)).min(1).max(200),
      status: productStatus,
    }),
  }),
  asyncHandler(async (req, res) => {
    const { ids, status } = req.body as { ids: string[]; status: z.infer<typeof productStatus> };

    // Нэг нэгээр засахтай ижил дүрэм — хугацаа нь өнгөрснийг дахин нээхгүй.
    const result = await prisma.productRound.updateMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        ...(status === 'ACTIVE'
          ? { OR: [{ closeAt: null }, { closeAt: { gt: new Date() } }] }
          : {}),
      },
      data: { status },
    });

    const skipped = ids.length - result.count;

    if (status === 'CLOSED') {
      const closed = await prisma.productRound.findMany({
        where: { id: { in: ids }, deletedAt: null, status: 'CLOSED' },
        select: { id: true },
      });
      const actor = actorOf(req);
      for (const round of closed) {
        await finalizeRoundClose(round.id, actor);
      }
    }

    await audit({
      actor: actorOf(req),
      action: 'BULK_STATUS',
      entity: 'ProductRound',
      entityId: ids.join(','),
      after: { status, count: result.count, skipped },
    });

    res.json({ data: { updated: result.count, status, skipped } });
  }),
);

/**
 * Тойргийг устгах. Захиалгатай тойргийг устгахгүй — түүх тасарна.
 * Оронд нь төлвийг нь ARCHIVED болгож нуух хэрэгтэй.
 */
adminRoundsRouter.delete(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const round = await prisma.productRound.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: { _count: { select: { orderItems: true } } },
    });
    if (!round) throw notFound('Тойрог олдсонгүй.');

    if (round._count.orderItems > 0) {
      throw conflict(
        `Энэ тойрогт ${round._count.orderItems} захиалгын мөр холбогдсон тул устгах боломжгүй. ` +
          'Оронд нь төлвийг «Архивласан» болгоно уу.',
        { orderItems: round._count.orderItems },
      );
    }

    await prisma.productRound.update({
      where: { id: round.id },
      data: { deletedAt: new Date(), status: 'ARCHIVED' },
    });

    await audit({
      actor: actorOf(req),
      action: 'DELETE',
      entity: 'ProductRound',
      entityId: round.id,
      before: { roundNo: round.roundNo, productId: round.productId },
    });

    res.json({ data: { id: round.id } });
  }),
);
