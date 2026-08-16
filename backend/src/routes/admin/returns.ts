import { Router } from 'express';
import { z } from 'zod';
import { isPayoutDay } from '../../lib/date.js';
import { badRequest } from '../../lib/errors.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import {
  confirmRefundPayouts,
  listReturns,
  returnsCalendar,
} from '../../services/returns.js';

export const adminReturnsRouter = Router();

const dayRe = /^\d{4}-\d{2}-\d{2}$/;

function parsePayoutDays(days: string[]): string[] {
  const unique = [...new Set(days.map((d) => d.trim()).filter(Boolean))];
  if (unique.length === 0 || unique.length > 3) {
    throw badRequest('1–3 буцаалтын өдөр (10, 20, 30) сонгоно уу.');
  }
  for (const value of unique) {
    if (!dayRe.test(value) || !isPayoutDay(value)) {
      throw badRequest('Буцаалтын өдөр 10, 20, 30 байх ёстой.');
    }
  }
  return unique.sort();
}

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

/** POST /returns/payouts — данс руу шилжүүлснийг баталгаажуулна. */
adminReturnsRouter.post(
  '/payouts',
  validate({
    body: z.object({
      days: z.array(z.string().trim()).min(1).max(3),
      customerIds: z.array(z.string().trim().min(1)).min(1).max(200),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { days: string[]; customerIds: string[] };
    const days = parsePayoutDays(body.days);
    res.json({ data: await confirmRefundPayouts(days, body.customerIds, actorOf(req)) });
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
    const days = parsePayoutDays(raw.split(','));
    res.json({ data: await listReturns(days) });
  }),
);
