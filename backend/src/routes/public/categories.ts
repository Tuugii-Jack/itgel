import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { listShopCategories } from '../../services/shopCatalog.js';

export const publicCategoriesRouter = Router();

/** GET /api/categories — идэвхтэй, дэлгүүрт бараатай ангилал. */
publicCategoriesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const categories = await listShopCategories();
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    res.json({ data: categories });
  }),
);
