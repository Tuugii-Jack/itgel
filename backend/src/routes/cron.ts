import { Router } from 'express';
import { env, isProd } from '../env.js';
import { unauthorized } from '../lib/errors.js';
import { asyncHandler } from '../middleware/validate.js';
import { pollSmsDeliveries } from '../services/smsDeliveryJob.js';

export const cronRouter = Router();

function assertCron(req: { headers: { authorization?: string } }) {
  const expected = env.CRON_SECRET;
  if (!expected) {
    if (isProd) throw unauthorized('CRON_SECRET тохиргоо дутуу.');
    return;
  }
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== expected) throw unauthorized('Cron эрхгүй.');
}

/** GET/POST /api/cron/sms-delivery — Vercel Cron. Хүргэлт шалгана, SMS дахин илгээхгүй. */
cronRouter.get(
  '/sms-delivery',
  asyncHandler(async (req, res) => {
    assertCron(req);
    const result = await pollSmsDeliveries();
    res.json({ data: result });
  }),
);

cronRouter.post(
  '/sms-delivery',
  asyncHandler(async (req, res) => {
    assertCron(req);
    const result = await pollSmsDeliveries();
    res.json({ data: result });
  }),
);
