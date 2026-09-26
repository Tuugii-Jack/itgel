import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import { loadTodayCardRows, loadTodayWork, type TodayCardKey } from '../../modules/work/today.js';
import type { AdminRoleName } from '../../lib/adminRoles.js';

export const leasingWorkRouter = Router();

const todayQuery = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  card: z
    .enum(['due_today', 'collected_today', 'unpaid_itgel', 'money_exception', 'sms_failed', 'sms_unknown'])
    .optional(),
  page: z.coerce.number().int().min(1).optional(),
});

leasingWorkRouter.get(
  '/today',
  validate({ query: todayQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof todayQuery>>(req);
    const role = req.auth!.role as AdminRoleName;
    if (q.card) {
      res.json(
        await loadTodayCardRows({
          role,
          actorId: req.auth!.sub,
          card: q.card as TodayCardKey,
          page: q.page,
          day: q.day,
          portal: 'leasing',
        }),
      );
      return;
    }
    res.json({
      data: await loadTodayWork({
        role,
        actorId: req.auth!.sub,
        day: q.day,
        portal: 'leasing',
      }),
    });
  }),
);
