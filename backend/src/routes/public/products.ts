import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { scheduleCloseExpired } from '../../cron/index.js';
import { notFound } from '../../lib/errors.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import { publicProduct } from '../../services/serialize.js';
import { detailRoundInclude, listShopRounds } from '../../services/shopCatalog.js';

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

publicProductsRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof listQuery>>(req);
    scheduleCloseExpired();
    const result = await listShopRounds(q);
    res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=15');
    res.json(result);
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
      include: detailRoundInclude,
    });

    if (!round) throw notFound('Бараа олдсонгүй.');
    res.json({ data: publicProduct(round) });
  }),
);
