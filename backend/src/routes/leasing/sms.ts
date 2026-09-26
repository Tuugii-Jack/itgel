import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, tooManyRequests } from '../../lib/errors.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, validate } from '../../middleware/validate.js';
import { ipLimiters, RateLimiter } from '../../lib/rateLimit.js';
import { env } from '../../env.js';
import { assertSmsText, smsPreviewToken, smsSegmentOf } from '../../lib/smsCompose.js';
import {
  parseSmsPhones,
  smsStatusLabel,
} from '../../services/sms.js';
import { dispatchSms } from '../../services/smsDispatch.js';

export const leasingSmsRouter = Router();

const smsLimiter = new RateLimiter(40, 60 * 60 * 1000);
ipLimiters.push(smsLimiter);

export const CUSTOM_SMS_MAX_RECIPIENTS = 40;

leasingSmsRouter.post(
  '/preview',
  validate({
    body: z.object({
      phone: z.string().trim().min(1).max(32).optional(),
      phones: z.array(z.string().trim().min(1).max(32)).max(CUSTOM_SMS_MAX_RECIPIENTS).optional(),
      text: z.string().min(1, 'Мессеж бичнэ үү.').max(400),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { phone?: string; phones?: string[]; text: string };
    const parsed = parseSmsPhones([...(body.phones ?? []), ...(body.phone ? [body.phone] : [])]);
    if (parsed.phones.length === 0) throw badRequest('Утасны дугаар буруу байна (8 орон).');
    const text = assertSmsText(body.text);
    const seg = smsSegmentOf(text);
    res.json({
      data: {
        sender: env.SMS_FROM ?? null,
        channel: 'leasing',
        text,
        chars: seg.chars,
        segments: seg.segments,
        encoding: seg.encoding,
        phones: parsed.phones,
        invalid: parsed.invalid,
        previewToken: smsPreviewToken(parsed.phones.map((phone) => ({ id: phone, text })), {
          channel: 'leasing',
        }),
      },
    });
  }),
);

/** POST /api/leasing/sms — нэг эсвэл олон дугаар руу чөлөөт мессеж. */
leasingSmsRouter.post(
  '/',
  validate({
    body: z.object({
      phone: z.string().trim().min(1).max(32).optional(),
      phones: z.array(z.string().trim().min(1).max(32)).max(CUSTOM_SMS_MAX_RECIPIENTS).optional(),
      text: z.string().min(1, 'Мессеж бичнэ үү.').max(400),
      previewToken: z.string().min(8).max(128),
      sendKey: z.string().trim().min(8).max(128),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      phone?: string;
      phones?: string[];
      text: string;
      previewToken: string;
      sendKey: string;
    };
    const parsed = parseSmsPhones([...(body.phones ?? []), ...(body.phone ? [body.phone] : [])]);
    if (parsed.phones.length === 0) {
      throw badRequest('Утасны дугаар буруу байна (8 орон).');
    }
    if (parsed.phones.length > CUSTOM_SMS_MAX_RECIPIENTS) {
      throw badRequest(`Нэг удаад ${CUSTOM_SMS_MAX_RECIPIENTS}-с илүү дугаар руу илгээхгүй.`);
    }

    const text = assertSmsText(body.text);
    const expected = smsPreviewToken(parsed.phones.map((phone) => ({ id: phone, text })), {
      channel: 'leasing',
    });
    if (body.previewToken !== expected) {
      throw conflict('Preview-ийн дараа мессеж эсвэл дугаар өөрчлөгдсөн. Дахин шалгана уу.');
    }

    const actor = actorOf(req);
    const sent: string[] = [];
    const failed: { phone: string; error: string }[] = [];
    let pending = 0;
    let delivered = 0;
    let unknown = 0;

    for (const phone of parsed.phones) {
      const hit = smsLimiter.hit(actor);
      if (!hit.allowed) {
        failed.push({
          phone,
          error: 'Хэт олон SMS илгээлээ. 1 цагийн дараа оролдоно уу.',
        });
        continue;
      }
      const { send } = await dispatchSms({
        channel: 'leasing',
        purpose: 'leasing_custom',
        phone,
        text,
        relatedType: 'custom',
        relatedId: phone,
        confirmKey: body.sendKey,
      });
      if (!send.accepted) {
        failed.push({ phone, error: send.error ?? 'SMS илгээгдсэнгүй.' });
        continue;
      }
      sent.push(phone);
      if (send.status === 'delivered') delivered += 1;
      else if (send.status === 'unknown') unknown += 1;
      else pending += 1;
    }

    if (sent.length === 0) {
      const first = failed[0];
      if (first?.error.includes('Хэт олон')) {
        throw tooManyRequests(first.error, { retryAfterSec: 3600 });
      }
      throw badRequest(first?.error ?? 'SMS илгээгдсэнгүй.');
    }

    await audit({
      actor,
      action: 'LEASING_CUSTOM_SMS',
      entity: 'Sms',
      entityId: sent[0]!,
      after: {
        sent: sent.length,
        failed: failed.length,
        pending,
        delivered,
        unknown,
        invalid: parsed.invalid.length,
        phones: sent,
      },
    });

    res.json({
      data: {
        ok: true,
        phone: sent[0]!,
        sent: sent.length,
        pending,
        delivered,
        failed,
        unknown,
        invalid: parsed.invalid,
        statusLabel: smsStatusLabel(
          delivered === sent.length && sent.length > 0
            ? 'delivered'
            : pending > 0
              ? 'queued'
              : unknown > 0
                ? 'unknown'
                : 'queued',
        ),
      },
    });
  }),
);
