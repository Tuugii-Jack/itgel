import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import {
  SUGGESTED_LEASING_FEE_TIERS,
  SMS_TEMPLATE_MAX,
  assertLeasingFeeTiers,
  assertLeasingPayGaps,
  leasingCopyOf,
  leasingSmsTemplatesOf,
} from '../../lib/leasing.js';
import {
  parseLeasingChatUrl,
  parseLeasingContactPhone,
  parseLeasingPublicName,
  publicLeasingContactOf,
} from '../../lib/leasingContact.js';
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
  smsDueToday: z.string().max(SMS_TEMPLATE_MAX).optional(),
  smsOverdue: z.string().max(SMS_TEMPLATE_MAX).optional(),
  smsArrivedUnpaid: z.string().max(SMS_TEMPLATE_MAX).optional(),
  bankName: z.string().trim().max(60).optional(),
  bankAccountNumber: z.string().trim().max(40).optional(),
  bankAccountName: z.string().trim().max(80).optional(),
  paymentNote: z.string().trim().max(300).optional(),
  publicName: z.string().max(80).optional(),
  contactPhone: z.string().trim().max(20).optional(),
  chatUrl: z.string().trim().max(300).optional(),
});

function serializeLeasingSettings(
  settings: Awaited<ReturnType<typeof getSettings>>,
  settlementAdmin: { id: string; name: string; email: string; isActive: boolean } | null,
) {
  const copy = leasingCopyOf(settings);
  const sms = leasingSmsTemplatesOf(settings);
  return {
    feeTiers: leasingTiersOf(settings),
    suggestedFeeTiers: SUGGESTED_LEASING_FEE_TIERS,
    payGaps: leasingPayGapsOf(settings),
    choiceHint: copy.choiceHint,
    termsTitle: copy.termsTitle,
    termsBody: copy.termsBody,
    smsDueToday: sms.dueToday,
    smsOverdue: sms.overdue,
    smsArrivedUnpaid: sms.arrivedUnpaid,
    bankName: settings.leasingBankName,
    bankAccountNumber: settings.leasingBankAccountNumber,
    bankAccountName: settings.leasingBankAccountName,
    paymentNote: settings.leasingPaymentNote,
    publicName: settings.leasingPublicName,
    contactPhone: settings.leasingContactPhone,
    chatUrl: settings.leasingChatUrl,
    contact: publicLeasingContactOf(settings),
    settlementAdmin,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

async function settlementAdminOf(id: string | null) {
  if (!id) return null;
  return prisma.adminUser.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, isActive: true },
  });
}

leasingSettingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const settings = await getSettings();
    res.json({
      data: serializeLeasingSettings(
        settings,
        await settlementAdminOf(settings.leasingSettlementAdminId),
      ),
    });
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
        ...(body.smsDueToday != null ? { leasingSmsDueToday: body.smsDueToday.trim() } : {}),
        ...(body.smsOverdue != null ? { leasingSmsOverdue: body.smsOverdue.trim() } : {}),
        ...(body.smsArrivedUnpaid != null ? { leasingSmsArrivedUnpaid: body.smsArrivedUnpaid.trim() } : {}),
        ...(body.bankName != null ? { leasingBankName: body.bankName } : {}),
        ...(body.bankAccountNumber != null ? { leasingBankAccountNumber: body.bankAccountNumber } : {}),
        ...(body.bankAccountName != null ? { leasingBankAccountName: body.bankAccountName } : {}),
        ...(body.paymentNote != null ? { leasingPaymentNote: body.paymentNote } : {}),
        ...(body.publicName != null ? { leasingPublicName: parseLeasingPublicName(body.publicName) } : {}),
        ...(body.contactPhone != null ? { leasingContactPhone: parseLeasingContactPhone(body.contactPhone) } : {}),
        ...(body.chatUrl != null ? { leasingChatUrl: parseLeasingChatUrl(body.chatUrl) } : {}),
      },
    });
    invalidateSettingsCache();

    const settlementAdmin = await settlementAdminOf(after.leasingSettlementAdminId);
    await audit({
      actor: actorOf(req),
      action: 'UPDATE',
      entity: 'Setting',
      entityId: 'leasing',
      before: serializeLeasingSettings(before, await settlementAdminOf(before.leasingSettlementAdminId)),
      after: serializeLeasingSettings(after, settlementAdmin),
    });

    res.json({ data: serializeLeasingSettings(after, settlementAdmin) });
  }),
);
