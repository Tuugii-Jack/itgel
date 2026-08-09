import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { badRequest } from '../../lib/errors.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, validate } from '../../middleware/validate.js';
import { getSettings } from '../../services/settings.js';

export const adminSettingsRouter = Router();

adminSettingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ data: await getSettings() });
  }),
);

const patchBody = z.object({
  storeName: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(300).optional(),
  workHours: z.string().trim().max(120).optional(),
  facebookUrl: z.string().trim().max(300).optional(),
  defaultLeadMinDays: z.coerce.number().int().min(0).max(365).optional(),
  defaultLeadMaxDays: z.coerce.number().int().min(0).max(365).optional(),
  smsOnArrival: z.boolean().optional(),
  autoCloseOnDeadline: z.boolean().optional(),
  deliveryFees: z.record(z.string().min(1), z.coerce.number().int().min(0).max(1_000_000)).optional(),
  deliveryDailyLimit: z.coerce.number().int().min(1).max(1000).optional(),
});

adminSettingsRouter.patch(
  '/',
  validate({ body: patchBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof patchBody>;
    const before = await getSettings();

    const min = body.defaultLeadMinDays ?? before.defaultLeadMinDays;
    const max = body.defaultLeadMaxDays ?? before.defaultLeadMaxDays;
    if (min > max) throw badRequest('defaultLeadMinDays нь defaultLeadMaxDays-с их байж болохгүй.');

    const after = await prisma.setting.update({ where: { id: 1 }, data: body });

    await audit({
      actor: actorOf(req),
      action: 'UPDATE',
      entity: 'Setting',
      entityId: '1',
      before,
      after,
    });

    res.json({ data: after });
  }),
);

/** Сүүлийн өөрчлөлтүүд — audit log. */
adminSettingsRouter.get(
  '/audit',
  validate({
    query: z.object({
      entity: z.string().min(1).max(40).optional(),
      entityId: z.string().min(1).max(60).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = (req as unknown as { validatedQuery: { entity?: string; entityId?: string; limit: number } })
      .validatedQuery;

    const logs = await prisma.auditLog.findMany({
      where: { ...(q.entity ? { entity: q.entity } : {}), ...(q.entityId ? { entityId: q.entityId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });

    res.json({ data: logs });
  }),
);
