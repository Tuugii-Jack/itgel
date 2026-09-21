import { Router, raw as rawBody } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { isOwnerRole } from '../../lib/adminRoles.js';
import {
  leasingCatalogProductWhere,
  leasingCatalogRoundWhere,
  resolveLeasingCatalogOwnerId,
  type LeasingAuth,
} from '../../lib/leasingAccess.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, param, query, validate } from '../../middleware/validate.js';
import { replaceRoundOptionPrices } from '../../lib/optionPrices.js';
import { replaceRoundSkuStocks, skuStockSum, syncRoundAvailable } from '../../lib/skuStock.js';
import { selectionsOf, variantRowsFromOptions, type ProductOption } from '../../lib/options.js';
import { roundStats } from '../../services/roundStats.js';
import { adminProduct, adminRound } from '../../services/serialize.js';
import { presignProductImage, uploadProductImage } from '../../services/storage.js';
import {
  optionPriceRow,
  productStatus,
  roundFields,
  skuStockRow,
  templateFields,
} from '../../modules/catalog/productFields.js';

export const leasingProductsRouter = Router();

const idParams = z.object({ id: z.string().min(1) });

const readyRoundFields = {
  costPrice: roundFields.costPrice.optional().default(0),
  sellPrice: roundFields.sellPrice,
  stock: roundFields.stock,
  status: productStatus.default('DRAFT'),
  note: roundFields.note,
  optionPrices: z.array(optionPriceRow).max(400).optional(),
  skuStocks: z.array(skuStockRow).max(400).optional(),
};

const createBody = z.object({
  ...templateFields,
  ...readyRoundFields,
  ownerAdminId: z.string().min(1).optional(),
});

const updateProductBody = z.object(templateFields).partial();
const updateRoundBody = z.object(readyRoundFields).partial();

const listQuery = z.object({
  status: productStatus.optional(),
  category: z.string().min(1).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const roundInclude = {
  category: true,
  variants: { orderBy: { sortOrder: 'asc' as const } },
  sizeChart: { orderBy: { sortOrder: 'asc' as const } },
  rounds: {
    where: { deletedAt: null, closeAt: null },
    orderBy: { roundNo: 'desc' as const },
    include: { optionPrices: true, skuStocks: true },
  },
} satisfies Prisma.ProductInclude;

function resolveOptions(body: {
  options?: ProductOption[];
  sizes?: string[];
  colors?: string[];
}): ProductOption[] {
  if (body.options && body.options.length > 0) {
    return body.options.filter((o) => o.name.trim() && o.values.some((v) => v.trim()));
  }
  const options: ProductOption[] = [];
  if (body.sizes?.length) options.push({ name: 'Хэмжээ', values: body.sizes });
  if (body.colors?.length) options.push({ name: 'Өнгө', values: body.colors });
  return options;
}

async function ownedProduct(id: string, auth: LeasingAuth) {
  const product = await prisma.product.findFirst({
    where: { id, ...leasingCatalogProductWhere(auth) },
    include: roundInclude,
  });
  if (!product) throw notFound('Бараа олдсонгүй.');
  return product;
}

async function ownedRound(id: string, auth: LeasingAuth) {
  const round = await prisma.productRound.findFirst({
    where: { id, ...leasingCatalogRoundWhere(auth), closeAt: null },
    include: {
      product: {
        include: {
          category: true,
          variants: { orderBy: { sortOrder: 'asc' } },
          sizeChart: { orderBy: { sortOrder: 'asc' } },
        },
      },
      optionPrices: true,
      skuStocks: true,
    },
  });
  if (!round) throw notFound('Тойрог олдсонгүй.');
  return round;
}

leasingProductsRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const categories = await prisma.category.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json({
      data: categories.map((c) => ({
        id: c.id,
        name: c.name,
        isActive: c.isActive,
        sortOrder: c.sortOrder,
      })),
    });
  }),
);

leasingProductsRouter.get(
  '/owners',
  asyncHandler(async (req, res) => {
    if (isOwnerRole(req.auth!.role)) {
      const owners = await prisma.adminUser.findMany({
        where: { role: 'LEASING', isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, email: true },
      });
      res.json({ data: owners });
      return;
    }
    const self = await prisma.adminUser.findUnique({
      where: { id: req.auth!.sub },
      select: { id: true, name: true, email: true },
    });
    res.json({ data: self ? [self] : [] });
  }),
);

leasingProductsRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof listQuery>>(req);
    const catalog = leasingCatalogProductWhere(req.auth!);
    const roundFilter: Prisma.ProductRoundWhereInput = {
      ...leasingCatalogRoundWhere(req.auth!),
      closeAt: null,
      ...(q.status ? { status: q.status } : {}),
    };
    const where: Prisma.ProductWhereInput = {
      ...catalog,
      ...(q.category ? { categoryId: q.category } : {}),
      ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
      rounds: { some: roundFilter },
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
    const stats = await roundStats(products.flatMap((p) => p.rounds.map((r) => r.id)));
    res.json({
      data: products.map((p) => adminProduct(p, new Date(), stats)),
      meta: { total, page: q.page, pageSize: q.pageSize, pages: Math.ceil(total / q.pageSize) },
    });
  }),
);

leasingProductsRouter.get(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const product = await ownedProduct(param(req, 'id'), req.auth!);
    const stats = await roundStats(product.rounds.map((r) => r.id));
    res.json({ data: adminProduct(product, new Date(), stats) });
  }),
);

leasingProductsRouter.post(
  '/',
  validate({ body: createBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createBody>;
    const target = body.ownerAdminId
      ? await prisma.adminUser.findUnique({
          where: { id: body.ownerAdminId },
          select: { role: true, isActive: true },
        })
      : null;
    const adminId = resolveLeasingCatalogOwnerId(req.auth!, body.ownerAdminId, target);
    const category = await prisma.category.findFirst({
      where: { id: body.categoryId, deletedAt: null },
    });
    if (!category) throw badRequest('Ангилал олдсонгүй.');
    const options = resolveOptions(body);
    const skuRows = body.skuStocks;
    const stock = skuStockSum(skuRows) ?? body.stock ?? 0;

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          name: body.name,
          description: body.description ?? null,
          categoryId: body.categoryId,
          images: body.images,
          ownerKind: 'LEASING',
          ownerAdminId: adminId,
          variants: { create: variantRowsFromOptions(options) },
          sizeChart: { create: body.sizeChart.map((row, i) => ({ ...row, sortOrder: i })) },
        },
      });
      const round = await tx.productRound.create({
        data: {
          productId: created.id,
          roundNo: 1,
          costPrice: body.costPrice ?? 0,
          sellPrice: body.sellPrice,
          stock,
          reserved: 0,
          available: stock,
          closeAt: null,
          status: body.status ?? 'DRAFT',
          note: body.note ?? null,
          ownerKind: 'LEASING',
          ownerAdminId: adminId,
        },
      });
      await replaceRoundOptionPrices(tx, round.id, body.optionPrices);
      await replaceRoundSkuStocks(tx, round.id, skuRows);
      return created;
    });

    const full = await ownedProduct(product.id, req.auth!);
    await audit({
      actor: actorOf(req),
      action: 'CREATE',
      entity: 'Product',
      entityId: product.id,
      after: adminProduct(full),
    });
    res.status(201).json({ data: adminProduct(full) });
  }),
);

leasingProductsRouter.patch(
  '/:id',
  validate({ params: idParams, body: updateProductBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof updateProductBody>;
    const before = await ownedProduct(param(req, 'id'), req.auth!);
    if (body.categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: body.categoryId, deletedAt: null },
      });
      if (!category) throw badRequest('Ангилал олдсонгүй.');
    }
    const after = await prisma.$transaction(async (tx) => {
      if (body.options !== undefined || body.sizes !== undefined || body.colors !== undefined) {
        const options = resolveOptions({
          options: body.options,
          sizes: body.sizes,
          colors: body.colors,
        });
        await tx.productVariant.deleteMany({ where: { productId: before.id } });
        await tx.productVariant.createMany({
          data: variantRowsFromOptions(options).map((v) => ({ ...v, productId: before.id })),
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

leasingProductsRouter.patch(
  '/rounds/:id',
  validate({ params: idParams, body: updateRoundBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof updateRoundBody>;
    const before = await ownedRound(param(req, 'id'), req.auth!);
    const skuRows = body.skuStocks;
    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.productRound.update({
        where: { id: before.id },
        data: {
          costPrice: body.costPrice,
          sellPrice: body.sellPrice,
          stock: skuStockSum(skuRows) ?? body.stock,
          status: body.status,
          note: body.note,
        },
        include: {
          product: {
            include: {
              category: true,
              variants: { orderBy: { sortOrder: 'asc' } },
              sizeChart: { orderBy: { sortOrder: 'asc' } },
            },
          },
          optionPrices: true,
          skuStocks: true,
        },
      });
      if (body.optionPrices) await replaceRoundOptionPrices(tx, updated.id, body.optionPrices);
      if (skuRows) await replaceRoundSkuStocks(tx, updated.id, skuRows);
      else if (body.stock != null) await syncRoundAvailable(tx, updated.id, body.stock);
      return tx.productRound.findFirstOrThrow({
        where: { id: updated.id },
        include: {
          product: {
            include: {
              category: true,
              variants: { orderBy: { sortOrder: 'asc' } },
              sizeChart: { orderBy: { sortOrder: 'asc' } },
            },
          },
          optionPrices: true,
          skuStocks: true,
        },
      });
    });
    await audit({
      actor: actorOf(req),
      action: 'UPDATE',
      entity: 'ProductRound',
      entityId: after.id,
      after: { sellPrice: after.sellPrice, status: after.status, stock: after.stock },
    });
    res.json({ data: adminRound(after) });
  }),
);

const imageUploadBody = rawBody({
  type: (req) => {
    const t = req.headers['content-type'] ?? '';
    return t.startsWith('image/') || t.startsWith('application/octet-stream');
  },
  limit: '5mb',
});

leasingProductsRouter.post(
  '/:id/images/upload',
  imageUploadBody,
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const product = await ownedProduct(param(req, 'id'), req.auth!);
    if (product.images.length >= 12) throw conflict('Нэг бараанд дээд тал нь 12 зураг.');
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw badRequest('Зураг файл илгээнэ үү.');
    }
    const contentType = String(req.headers['content-type'] ?? 'application/octet-stream');
    const stored = await uploadProductImage(product.id, contentType, req.body);
    res.json({ data: stored });
  }),
);

leasingProductsRouter.post(
  '/:id/images',
  validate({
    params: idParams,
    body: z.object({ contentType: z.string().min(1).max(80) }),
  }),
  asyncHandler(async (req, res) => {
    const product = await ownedProduct(param(req, 'id'), req.auth!);
    if (product.images.length >= 12) throw conflict('Нэг бараанд дээд тал нь 12 зураг.');
    const presigned = await presignProductImage(product.id, req.body.contentType);
    res.json({ data: presigned });
  }),
);

leasingProductsRouter.patch(
  '/:id/images',
  validate({
    params: idParams,
    body: z.object({ images: z.array(z.string().url()).max(12) }),
  }),
  asyncHandler(async (req, res) => {
    const product = await ownedProduct(param(req, 'id'), req.auth!);
    const updated = await prisma.product.update({
      where: { id: product.id },
      data: { images: req.body.images },
    });
    res.json({ data: { images: updated.images } });
  }),
);
