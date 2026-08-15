import { Router } from 'express';
import { z } from 'zod';
import { isPayoutDay } from '../../lib/date.js';
import { badRequest } from '../../lib/errors.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import { listReturns, returnsCalendar } from '../../services/returns.js';

export const adminReturnsRouter = Router();

/** GET /returns/calendar?year=&month= — захиалгаас хийсэн буцаалттай өдрүүд. */
adminReturnsRouter.get(
  '/calendar',
  validate({
    query: z.object({
      year: z.coerce.number().int().min(2000).max(2100),
      month: z.coerce.number().int().min(1).max(12),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ year: number; month: number }>(req);
    res.json({ data: await returnsCalendar(q.year, q.month) });
  }),
);

/** GET /returns?days=YYYY-MM-DD,YYYY-MM-DD — мөрөөр буцаасан бараа + данс. */
adminReturnsRouter.get(
  '/',
  validate({
    query: z.object({
      days: z.string().trim().min(10).max(400),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { days: raw } = query<{ days: string }>(req);
    const days = [...new Set(raw.split(',').map((d) => d.trim()).filter(Boolean))];
    if (days.length === 0 || days.length > 3) {
      throw badRequest('1–3 буцаалтын өдөр (10, 20, 30) сонгоно уу.');
    }
    for (const value of days) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !isPayoutDay(value)) {
        throw badRequest('Буцаалтын өдөр 10, 20, 30 байх ёстой.');
      }
    }
    res.json({ data: await listReturns(days) });
  }),
);
