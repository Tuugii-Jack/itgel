import { Router } from 'express';
import type { Prisma, ProductStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { notFound } from '../../lib/errors.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import { publicProduct } from '../../services/serialize.js';

export const publicProductsRouter = Router();

/** Хэрэглэгчид харагдах төлвүүд — DRAFT, HIDDEN, ARCHIVED нуугдана. */
const VISIBLE_STATUSES: ProductStatus[] = ['ACTIVE', 'CLOSED', 'SOLD_OUT'];

const listQuery = z.object({
  category: z.string().min(1).optional(),
  type: z.enum(['order', 'ready']).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(20),
  sort: z.enum(['new', 'priceAsc', 'priceDesc', 'closing']).default('new'),
});

const orderByFor = (sort: z.infer<typeof listQuery>['sort']): Prisma.ProductOrderByWithRelationInput => {
  switch (sort) {
    case 'priceAsc':
      return { sellPrice: 'asc' };
    case 'priceDesc':
      return { sellPrice: 'desc' };
    case 'closing':
      return { closeAt: 'asc' };
    default:
      return { createdAt: 'desc' };
  }
};

publicProductsRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof listQuery>>(req);

    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      status: { in: VISIBLE_STATUSES },
      ...(q.category ? { categoryId: q.category } : {}),
      ...(q.type === 'order' ? { closeAt: { not: null } } : {}),
      ...(q.type === 'ready' ? { closeAt: null } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { description: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy: orderByFor(q.sort),
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { category: true, variants: { orderBy: { sortOrder: 'asc' } } },
      }),
    ]);

    res.json({
      data: products.map((p) => publicProduct(p)),
      meta: { total, page: q.page, pageSize: q.pageSize, pages: Math.ceil(total / q.pageSize) },
    });
  }),
);

publicProductsRouter.get(
  '/:id',
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, deletedAt: null, status: { in: VISIBLE_STATUSES } },
      include: {
        category: true,
        variants: { orderBy: { sortOrder: 'asc' } },
        sizeChart: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!product) throw notFound('Бараа олдсонгүй.');
    res.json({ data: publicProduct(product) });
  }),
);
