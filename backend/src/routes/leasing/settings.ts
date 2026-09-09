import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import {
  SUGGESTED_LEASING_FEE_TIERS,
  assertLeasingFeeTiers,
  assertLeasingPayGaps,
  leasingCopyOf,
} from '../../lib/leasing.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, validate } from '../../middleware/validate.js';
import {
  getSettings,
  invalidateSettingsCache,
  leasingPayGapsOf,
  leasingTiersOf,
} from '../../services/settings.js';

export const leasingSettingsRouter = Router();

const tierBody = z.object({
  minAmount: z.coerce.number().int().min(0).max(100_000_000),
  ratePercent: z.coerce.number().min(0.1).max(100),
});

const patchBody = z.object({
  feeTiers: z.array(tierBody).min(1).max(12).optional(),
  payGaps: z.array(z.coerce.number().int().min(1).max(60)).min(2).max(3).optional(),
  choiceHint: z.string().max(400).optional(),
  termsTitle: z.string().max(80).optional(),
  termsBody: z.string().max(2000).optional(),
});

function serializeLeasingSettings(settings: Awaited<ReturnType<typeof getSettings>>) {
  const copy = leasingCopyOf(settings);
  return {
    feeTiers: leasingTiersOf(settings),
    suggestedFeeTiers: SUGGESTED_LEASING_FEE_TIERS,
    payGaps: leasingPayGapsOf(settings),
    choiceHint: copy.choiceHint,
    termsTitle: copy.termsTitle,
    termsBody: copy.termsBody,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

leasingSettingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ data: serializeLeasingSettings(await getSettings()) });
  }),
);

leasingSettingsRouter.patch(
  '/',
  validate({ body: patchBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof patchBody>;
    const before = await getSettings();
    const feeTiers = body.feeTiers ? assertLeasingFeeTiers(body.feeTiers) : undefined;
    const payGaps = body.payGaps ? assertLeasingPayGaps(body.payGaps) : undefined;

    const after = await prisma.setting.update({
      where: { id: 1 },
      data: {
        ...(feeTiers ? { leasingFeeTiers: feeTiers as unknown as Prisma.InputJsonValue } : {}),
        ...(payGaps ? { leasingPayGaps: payGaps as unknown as Prisma.InputJsonValue } : {}),
        ...(body.choiceHint != null ? { leasingChoiceHint: body.choiceHint.trim() } : {}),
        ...(body.termsTitle != null ? { leasingTermsTitle: body.termsTitle.trim() } : {}),
        ...(body.termsBody != null ? { leasingTermsBody: body.termsBody.trim() } : {}),
      },
    });
    invalidateSettingsCache();

    await audit({
      actor: actorOf(req),
      action: 'UPDATE',
      entity: 'Setting',
      entityId: 'leasing',
      before: serializeLeasingSettings(before),
      after: serializeLeasingSettings(after),
    });

    res.json({ data: serializeLeasingSettings(after) });
  }),
);
