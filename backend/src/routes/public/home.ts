import { Router } from 'express';
import { scheduleCloseExpired, scheduleCancelUnpaid } from '../../cron/index.js';
import { asyncHandler } from '../../middleware/validate.js';
import { shopHome } from '../../services/shopCatalog.js';

export const publicHomeRouter = Router();

/** GET /api/home — нүүрийн бүх өгөгдөл нэг хариугаар. */
publicHomeRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    scheduleCloseExpired();
    scheduleCancelUnpaid();
    const data = await shopHome();
    res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=15');
    res.json({ data });
  }),
);
