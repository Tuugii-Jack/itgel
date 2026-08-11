import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { asyncHandler } from '../../middleware/validate.js';

export const publicCategoriesRouter = Router();

/** GET /api/categories — зөвхөн идэвхтэй ангилал. */
publicCategoriesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const categories = await prisma.category.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        sortOrder: true,
        // Идэвхтэй тойрогтой бараа л тоологдоно — хаагдсан нь дэлгүүрт харагдахгүй.
        _count: {
          select: {
            products: {
              where: { deletedAt: null, rounds: { some: { status: 'ACTIVE', deletedAt: null } } },
            },
          },
        },
      },
    });

    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    res.json({
      data: categories.map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
        productCount: c._count.products,
      })),
    });
  }),
);
