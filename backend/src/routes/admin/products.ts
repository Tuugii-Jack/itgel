import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import { adminProduct } from '../../services/serialize.js';
import { getSettings } from '../../services/settings.js';
import { presignProductImage } from '../../services/storage.js';

export const adminProductsRouter = Router();

const idParams = z.object({ id: z.string().min(1) });

export const productStatus = z.enum([
  'ACTIVE',
  'HIDDEN',
  'DRAFT',
  'CLOSED',
  'SOLD_OUT',
  'ARCHIVED',
]);

const sizeChartSchema = z.array(
  z.object({
    size: z.string().trim().min(1).max(20),
    heightRange: z.string().trim().max(40).default(''),
    chestCm: z.string().trim().max(40).default(''),
  }),
);

/** Загварын талбарууд — тойрог болгонд давтагдахгүй хэсэг. */
const templateFields = {
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).optional(),
  categoryId: z.string().min(1),
  images: z.array(z.string().url()).max(12).default([]),
  sizes: z.array(z.string().trim().min(1).max(40)).max(40).default([]),
  colors: z.array(z.string().trim().min(1).max(40)).max(40).default([]),
  sizeChart: sizeChartSchema.max(30).default([]),
};

/** Тойргийн талбарууд — гаргалт бүрд өөр байж болно. */
export const roundFields = {
  costPrice: z.coerce.number().int().min(0),
  sellPrice: z.coerce.number().int().min(0),
  stock: z.coerce.number().int().min(0).default(0),
  closeAt: z.coerce.date().nullable().optional(),
  leadMinDays: z.coerce.number().int().min(0).max(365).optional(),
  leadMaxDays: z.coerce.number().int().min(0).max(365).optional(),
  status: productStatus.default('DRAFT'),
  note: z.string().trim().max(300).optional(),
};

/** Бараа үүсгэхэд эхний тойргийг хамт үүсгэнэ — хоёр алхам болгохгүй. */
const createBody = z.object({ ...templateFields, ...roundFields });

/** Загварыг засах — үнэ, төлөв энд БАЙХГҮЙ, тэдгээр нь тойрог дээр. */
const updateBody = z.object(templateFields).partial();

const listQuery = z.object({
  status: productStatus.optional(),
  category: z.string().min(1).optional(),
  type: z.enum(['order', 'ready']).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  includeDeleted: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const roundInclude = {
  category: true,
  variants: { orderBy: { sortOrder: 'asc' } },
  sizeChart: { orderBy: { sortOrder: 'asc' } },
  rounds: {
    where: { deletedAt: null },
    orderBy: { roundNo: 'desc' },
  },
} satisfies Prisma.ProductInclude;

/**
 * Барааны жагсаалт — загвар бүр тойргуудынхаа хамт.
 * Шүүлтүүр нь тойрог дээр ажиллана: «идэвхтэй бараа» гэдэг нь идэвхтэй
 * тойрогтой бараа гэсэн үг.
 */
adminProductsRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof listQuery>>(req);

    const roundFilter: Prisma.ProductRoundWhereInput = {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.type === 'order' ? { closeAt: { not: null } } : {}),
      ...(q.type === 'ready' ? { closeAt: null } : {}),
    };
    const filteringRounds = Boolean(q.status || q.type);

    const where: Prisma.ProductWhereInput = {
      ...(q.includeDeleted ? {} : { deletedAt: null }),
      ...(q.category ? { categoryId: q.category } : {}),
      ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
      ...(filteringRounds ? { rounds: { some: roundFilter } } : {}),
    };

    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: roundInclude,
      }),
    ]);

    res.json({
      data: products.map((p) => adminProduct(p)),
      meta: { total, page: q.page, pageSize: q.pageSize, pages: Math.ceil(total / q.pageSize) },
    });
  }),
);

adminProductsRouter.get(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: roundInclude,
    });
    if (!product) throw notFound('Бараа олдсонгүй.');
    res.json({ data: adminProduct(product) });
  }),
);

adminProductsRouter.post(
  '/',
  validate({ body: createBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createBody>;
    const settings = await getSettings();

    const category = await prisma.category.findFirst({
      where: { id: body.categoryId, deletedAt: null },
    });
    if (!category) throw badRequest('Ангилал олдсонгүй.');

    const leadMinDays = body.leadMinDays ?? settings.defaultLeadMinDays;
    const leadMaxDays = body.leadMaxDays ?? settings.defaultLeadMaxDays;
    if (leadMinDays > leadMaxDays) throw badRequest('leadMinDays нь leadMaxDays-с их байж болохгүй.');

    const product = await prisma.product.create({
      data: {
        name: body.name,
        description: body.description ?? null,
        categoryId: body.categoryId,
        images: body.images,
        variants: { create: variantRows(body.sizes, body.colors) },
        sizeChart: { create: body.sizeChart.map((row, i) => ({ ...row, sortOrder: i })) },
        rounds: {
          create: {
            roundNo: 1,
            costPrice: body.costPrice,
            sellPrice: body.sellPrice,
            stock: body.stock,
            closeAt: body.closeAt ?? null,
            leadMinDays,
            leadMaxDays,
            status: body.status,
            note: body.note ?? null,
          },
        },
      },
      include: roundInclude,
    });

    await audit({
      actor: actorOf(req),
      action: 'CREATE',
      entity: 'Product',
      entityId: product.id,
      after: adminProduct(product),
    });

    res.status(201).json({ data: adminProduct(product) });
  }),
);

/** Загварыг засах — бүх тойрогт нэгэн зэрэг нөлөөлнө (нэр, зураг, хэмжээ). */
adminProductsRouter.patch(
  '/:id',
  validate({ params: idParams, body: updateBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof updateBody>;

    const before = await prisma.product.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: roundInclude,
    });
    if (!before) throw notFound('Бараа олдсонгүй.');

    if (body.categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: body.categoryId, deletedAt: null },
      });
      if (!category) throw badRequest('Ангилал олдсонгүй.');
    }

    const after = await prisma.$transaction(async (tx) => {
      if (body.sizes || body.colors) {
        const kinds = [
          ...(body.sizes ? (['SIZE'] as const) : []),
          ...(body.colors ? (['COLOR'] as const) : []),
        ];
        await tx.productVariant.deleteMany({
          where: { productId: before.id, kind: { in: [...kinds] } },
        });
        await tx.productVariant.createMany({
          data: variantRows(body.sizes, body.colors).map((v) => ({ ...v, productId: before.id })),
        });
      }

      if (body.sizeChart) {
        await tx.sizeChartRow.deleteMany({ where: { productId: before.id } });
        await tx.sizeChartRow.createMany({
          data: body.sizeChart.map((row, i) => ({ ...row, productId: before.id, sortOrder: i })),
        });
      }

      return tx.product.update({
        where: { id: before.id },
        data: {
          name: body.name,
          description: body.description,
          categoryId: body.categoryId,
          images: body.images,
        },
        include: roundInclude,
      });
    });

    await audit({
      actor: actorOf(req),
      action: 'UPDATE',
      entity: 'Product',
      entityId: after.id,
      before: adminProduct(before),
      after: adminProduct(after),
    });

    res.json({ data: adminProduct(after) });
  }),
);

/**
 * POST /:id/rounds — «дахин гаргах».
 *
 * Хамгийн сүүлийн тойргийн үнэ, хүлээх хоногийг анхдагчаар авна, тиймээс
 * ихэнхдээ зөвхөн шинэ хаах огноогоо өгөхөд хангалттай. Хуучин тойргийг
 * огт хөндөхгүй — түүн рүү холбогдсон захиалгууд хэвээрээ үлдэнэ.
 */
adminProductsRouter.post(
  '/:id/rounds',
  validate({
    params: idParams,
    body: z
      .object({
        costPrice: roundFields.costPrice.optional(),
        sellPrice: roundFields.sellPrice.optional(),
        stock: z.coerce.number().int().min(0).optional(),
        closeAt: roundFields.closeAt,
        leadMinDays: roundFields.leadMinDays,
        leadMaxDays: roundFields.leadMaxDays,
        status: productStatus.optional(),
        note: roundFields.note,
      })
      .default({}),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof createBody>>;

    const product = await prisma.product.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: { rounds: { orderBy: { roundNo: 'desc' }, take: 1 } },
    });
    if (!product) throw notFound('Бараа олдсонгүй.');

    const last = product.rounds[0];
    const settings = await getSettings();

    const costPrice = body.costPrice ?? last?.costPrice;
    const sellPrice = body.sellPrice ?? last?.sellPrice;
    if (costPrice === undefined || sellPrice === undefined) {
      throw badRequest('Өмнөх тойрог байхгүй тул үнийг заавал өгнө үү.');
    }

    const leadMinDays = body.leadMinDays ?? last?.leadMinDays ?? settings.defaultLeadMinDays;
    const leadMaxDays = body.leadMaxDays ?? last?.leadMaxDays ?? settings.defaultLeadMaxDays;
    if (leadMinDays > leadMaxDays) throw badRequest('leadMinDays нь leadMaxDays-с их байж болохгүй.');

    // Дугаарыг зөвхөн өсгөнө — устгасан тойргийн дугаарыг дахин ашиглахгүй.
    const maxNo = await prisma.productRound.aggregate({
      where: { productId: product.id },
      _max: { roundNo: true },
    });

    const round = await prisma.productRound.create({
      data: {
        productId: product.id,
        roundNo: (maxNo._max.roundNo ?? 0) + 1,
        costPrice,
        sellPrice,
        stock: body.stock ?? 0,
        closeAt: body.closeAt === undefined ? (last?.closeAt ?? null) : body.closeAt,
        leadMinDays,
        leadMaxDays,
        status: body.status ?? 'DRAFT',
        note: body.note ?? null,
      },
    });

    await audit({
      actor: actorOf(req),
      action: 'ROUND_CREATE',
      entity: 'ProductRound',
      entityId: round.id,
      after: { productId: product.id, roundNo: round.roundNo, sellPrice, closeAt: round.closeAt },
    });

    const full = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
      include: roundInclude,
    });
    res.status(201).json({ data: adminProduct(full) });
  }),
);

/** Soft delete — захиалгын түүх хэвээр үлдэнэ. Тойргууд нь хамт хаагдана. */
adminProductsRouter.delete(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!product) throw notFound('Бараа олдсонгүй.');

    const deleted = await softDelete([product.id]);
    await audit({
      actor: actorOf(req),
      action: 'DELETE',
      entity: 'Product',
      entityId: product.id,
      before: product,
    });

    res.json({ data: { deleted } });
  }),
);

adminProductsRouter.post(
  '/bulk-delete',
  validate({ body: z.object({ ids: z.array(z.string().min(1)).min(1).max(200) }) }),
  asyncHandler(async (req, res) => {
    const { ids } = req.body as { ids: string[] };
    const deleted = await softDelete(ids);

    await audit({
      actor: actorOf(req),
      action: 'BULK_DELETE',
      entity: 'Product',
      entityId: ids.join(','),
      after: { count: deleted },
    });

    res.json({ data: { deleted } });
  }),
);

/** POST /:id/images — presigned upload URL. Зураг загвар дээр байна. */
adminProductsRouter.post(
  '/:id/images',
  validate({
    params: idParams,
    body: z.object({
      contentType: z.string().min(3).max(100),
      fileName: z.string().max(200).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!product) throw notFound('Бараа олдсонгүй.');
    if (product.images.length >= 12) throw conflict('Нэг бараанд дээд тал нь 12 зураг.');

    const presigned = await presignProductImage(product.id, req.body.contentType);
    res.json({ data: presigned });
  }),
);

/** Байршуулсны дараа зургийн URL-г бүртгэнэ. */
adminProductsRouter.patch(
  '/:id/images',
  validate({
    params: idParams,
    body: z.object({ images: z.array(z.string().url()).max(12) }),
  }),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!product) throw notFound('Бараа олдсонгүй.');

    const updated = await prisma.product.update({
      where: { id: product.id },
      data: { images: req.body.images },
    });

    await audit({
      actor: actorOf(req),
      action: 'UPDATE_IMAGES',
      entity: 'Product',
      entityId: product.id,
      before: { images: product.images },
      after: { images: updated.images },
    });

    res.json({ data: { images: updated.images } });
  }),
);

function variantRows(sizes?: string[], colors?: string[]) {
  return [
    ...(sizes ?? []).map((value, i) => ({ kind: 'SIZE' as const, value, sortOrder: i })),
    ...(colors ?? []).map((value, i) => ({ kind: 'COLOR' as const, value, sortOrder: i })),
  ];
}

/** Загвар устгахад түүний бүх тойрог хамт хаагдана. */
async function softDelete(ids: string[]): Promise<number> {
  const now = new Date();
  const [result] = await prisma.$transaction([
    prisma.product.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: now },
    }),
    prisma.productRound.updateMany({
      where: { productId: { in: ids }, deletedAt: null },
      data: { deletedAt: now, status: 'ARCHIVED' },
    }),
  ]);
  return result.count;
}
