import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { publicStorePayload } from '../../services/shopCatalog.js';

export const publicStoreRouter = Router();

/** GET /api/store — хаяг, цаг, утас, Facebook. Төлбөр зөвхөн QPay. */
publicStoreRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    res.json({ data: await publicStorePayload() });
  }),
);
