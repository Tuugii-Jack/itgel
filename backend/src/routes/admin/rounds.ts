import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, validate } from '../../middleware/validate.js';
import { adminRound } from '../../services/serialize.js';
import { productStatus, roundFields } from './products.js';

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

    const after = await prisma.productRound.update({
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
      },
      include: roundInclude,
    });

    await audit({
      actor: actorOf(req),
      action: 'UPDATE',
      entity: 'ProductRound',
      entityId: after.id,
      before: adminRound(before),
      after: adminRound(after),
    });

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
