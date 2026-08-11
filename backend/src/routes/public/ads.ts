import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { asyncHandler } from '../../middleware/validate.js';

export const publicAdsRouter = Router();

/** GET /api/ads — идэвхтэй баннерууд. */
publicAdsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const ads = await prisma.ad.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        title: true,
        imageUrl: true,
        linkUrl: true,
      },
    });

    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    res.json({ data: ads });
  }),
);
