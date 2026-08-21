import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { listShopAds } from '../../services/shopCatalog.js';

export const publicAdsRouter = Router();

/** GET /api/ads — идэвхтэй баннерууд. */
publicAdsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const ads = await listShopAds();
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    res.json({ data: ads });
  }),
);
