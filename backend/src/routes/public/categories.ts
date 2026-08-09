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
        _count: { select: { products: { where: { status: 'ACTIVE', deletedAt: null } } } },
      },
    });

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
