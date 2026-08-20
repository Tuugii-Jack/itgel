import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { scheduleCloseExpired } from '../../cron/index.js';
import { notFound } from '../../lib/errors.js';
import { shopRoundWhere, roundDeadlinePassed } from '../../lib/roundShop.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import { publicProduct } from '../../services/serialize.js';

export const publicProductsRouter = Router();

/**
 * Дэлгүүрт харагдах нэгж нь БАРАА биш, барааны нэг ТОЙРОГ.
 * Нэг бараа хэд хэдэн удаа гарсан бол тухай бүрд нь тусдаа мөр харагдана,
 * учир нь үнэ, хаах огноо, ирэх огноо нь өөр өөр.
 */

const listQuery = z.object({
  category: z.string().min(1).optional(),
  type: z.enum(['order', 'ready']).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(20),
  sort: z.enum(['new', 'priceAsc', 'priceDesc', 'closing']).default('new'),
});

const orderByFor = (
  sort: z.infer<typeof listQuery>['sort'],
): Prisma.ProductRoundOrderByWithRelationInput => {
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

const roundInclude = {
  product: {
    include: {
      category: true,
      variants: { orderBy: { sortOrder: 'asc' as const } },
      sizeChart: { orderBy: { sortOrder: 'asc' as const } },
    },
  },
  optionPrices: true,
  skuStocks: true,
};

publicProductsRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof listQuery>>(req);
    scheduleCloseExpired();
    const now = new Date();

    const where: Prisma.ProductRoundWhereInput = {
      ...shopRoundWhere(now),
      product: {
        deletedAt: null,
        ...(q.category ? { categoryId: q.category } : {}),
        ...(q.q
          ? {
              OR: [
                { name: { contains: q.q, mode: 'insensitive' } },
                { description: { contains: q.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      ...(q.type === 'order' ? { closeAt: { not: null } } : {}),
      ...(q.type === 'ready' ? { closeAt: null } : {}),
    };

    const [total, rounds] = await Promise.all([
      prisma.productRound.count({ where }),
      prisma.productRound.findMany({
        where,
        orderBy: orderByFor(q.sort),
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: roundInclude,
      }),
    ]);

    res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=15');
    res.json({
      data: rounds.map((r) => publicProduct(r)),
      meta: { total, page: q.page, pageSize: q.pageSize, pages: Math.ceil(total / q.pageSize) },
    });
  }),
);

publicProductsRouter.get(
  '/:id',
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    scheduleCloseExpired();
    const round = await prisma.productRound.findFirst({
      where: {
        id: req.params.id,
        deletedAt: null,
        status: { in: ['ACTIVE', 'SOLD_OUT', 'CLOSED'] },
        product: { deletedAt: null },
      },
      include: roundInclude,
    });

    if (!round) throw notFound('Бараа олдсонгүй.');
    if (roundDeadlinePassed(round.closeAt) && round.status === 'ACTIVE') {
      res.json({ data: { ...publicProduct(round), status: 'CLOSED' as const } });
      return;
    }
    res.json({ data: publicProduct(round) });
  }),
);
