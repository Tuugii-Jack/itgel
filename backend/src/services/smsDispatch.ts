import type { SmsDispatch } from '@prisma/client';
import { prisma } from '../prisma.js';
import {
  OPEN_SMS_STATUSES,
  smsPhoneOf,
  smsProviderOf,
  type SmsChannel,
  type SmsLifecycleStatus,
  type SmsProvider,
  type SmsSendResult,
} from './sms.js';

export type SmsPurpose =
  | 'otp_login'
  | 'otp_change'
  | 'arrival'
  | 'leasing_custom'
  | 'leasing_schedule'
  | 'leasing_pay';

export type SmsRelatedType = 'phone_otp' | 'order' | 'batch' | 'custom';

const OPEN: SmsLifecycleStatus[] = OPEN_SMS_STATUSES;
const SKIP_WITHOUT_RESEND: SmsLifecycleStatus[] = ['queued', 'pending', 'unknown'];

export type DispatchSmsInput = {
  channel: SmsChannel;
  purpose: SmsPurpose;
  phone: string;
  text: string;
  relatedType?: SmsRelatedType;
  relatedId?: string;
  /** Шинэ оролдлого. Хуучин pending-ийг дахин илгээхгүй. */
  resend?: boolean;
  provider?: SmsProvider;
};

export type DispatchSmsResult = {
  dispatch: SmsDispatch;
  send: SmsSendResult;
  skipped?: boolean;
};

export async function findLatestDispatch(relatedType: string, relatedId: string, purpose: SmsPurpose) {
  return prisma.smsDispatch.findFirst({
    where: { relatedType, relatedId, purpose },
    orderBy: { createdAt: 'desc' },
  });
}

export async function hasOpenDispatch(relatedType: string, relatedId: string, purpose: SmsPurpose) {
  const row = await findLatestDispatch(relatedType, relatedId, purpose);
  if (!row) return false;
  return OPEN.includes(row.status as SmsLifecycleStatus);
}

/** Илгээлтийг DB-д эхлээд бүртгээд дараа нь провайдер руу явуулна. Хүргэлт хүлээхгүй. */
export async function dispatchSms(input: DispatchSmsInput): Promise<DispatchSmsResult> {
  const phone = smsPhoneOf(input.phone);
  if (!phone) {
    const send: SmsSendResult = {
      accepted: false,
      status: 'failed',
      error: 'Утасны дугаар буруу.',
    };
    const dispatch = await prisma.smsDispatch.create({
      data: {
        channel: input.channel,
        purpose: input.purpose,
        provider: input.provider?.name ?? smsProviderOf(input.channel).name,
        phone: input.phone,
        status: 'failed',
        error: send.error,
        relatedType: input.relatedType,
        relatedId: input.relatedId,
        idempotencyKey: unusedKey(input, 'invalid-phone'),
        attempt: 1,
      },
    });
    return { dispatch, send };
  }

  if (input.relatedType && input.relatedId && !input.resend) {
    const existing = await prisma.smsDispatch.findFirst({
      where: {
        relatedType: input.relatedType,
        relatedId: input.relatedId,
        purpose: input.purpose,
        status: { in: SKIP_WITHOUT_RESEND },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing && (OPEN.includes(existing.status as SmsLifecycleStatus) || existing.providerMessageId)) {
      return {
        dispatch: existing,
        send: {
          accepted: Boolean(existing.acceptedAt || existing.providerMessageId),
          status: existing.status as SmsLifecycleStatus,
          id: existing.providerMessageId ?? undefined,
          error: existing.error ?? undefined,
        },
        skipped: true,
      };
    }
  }

  const provider = input.provider ?? smsProviderOf(input.channel);
  const attempt = await nextAttempt(input);
  const idempotencyKey = dispatchKey(input, attempt);

  let row: SmsDispatch;
  try {
    row = await prisma.smsDispatch.create({
      data: {
        channel: input.channel,
        purpose: input.purpose,
        provider: provider.name,
        phone,
        status: 'pending',
        relatedType: input.relatedType,
        relatedId: input.relatedId,
        idempotencyKey,
        attempt,
      },
    });
  } catch (error) {
    if (isUniqueConflict(error) && input.relatedType && input.relatedId) {
      const existing = await prisma.smsDispatch.findUnique({ where: { idempotencyKey } });
      if (existing) {
        return {
          dispatch: existing,
          send: {
            accepted: Boolean(existing.acceptedAt || existing.providerMessageId),
            status: existing.status as SmsLifecycleStatus,
            id: existing.providerMessageId ?? undefined,
            error: existing.error ?? undefined,
          },
          skipped: true,
        };
      }
    }
    throw error;
  }

  const send = await provider.send({ phone, text: input.text });
  const nextCheckAt =
    send.accepted && provider.tracksDelivery && send.id && send.status !== 'delivered'
      ? new Date()
      : null;

  const dispatch = await prisma.smsDispatch.update({
    where: { id: row.id },
    data: {
      status: send.status,
      providerMessageId: send.id ?? null,
      error: send.error ?? null,
      acceptedAt: send.accepted ? new Date() : null,
      deliveredAt: send.status === 'delivered' ? new Date() : null,
      nextCheckAt,
    },
  });

  return { dispatch, send };
}

async function nextAttempt(input: DispatchSmsInput): Promise<number> {
  if (!input.relatedType || !input.relatedId) return 1;
  const last = await prisma.smsDispatch.findFirst({
    where: {
      relatedType: input.relatedType,
      relatedId: input.relatedId,
      purpose: input.purpose,
    },
    orderBy: { attempt: 'desc' },
    select: { attempt: true },
  });
  return (last?.attempt ?? 0) + 1;
}

function dispatchKey(input: DispatchSmsInput, attempt: number): string {
  if (input.relatedType && input.relatedId) {
    return `${input.purpose}:${input.relatedType}:${input.relatedId}:a${attempt}`;
  }
  return unusedKey(input, String(attempt));
}

function unusedKey(input: DispatchSmsInput, extra: string): string {
  return `${input.purpose}:${input.channel}:${Date.now()}:${extra}:${Math.random().toString(36).slice(2, 10)}`;
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}

export function smsCountsOf(
  rows: { status: string }[],
): { pending: number; delivered: number; failed: number; unknown: number } {
  let pending = 0;
  let delivered = 0;
  let failed = 0;
  let unknown = 0;
  for (const row of rows) {
    if (row.status === 'delivered') delivered += 1;
    else if (row.status === 'failed') failed += 1;
    else if (row.status === 'unknown') unknown += 1;
    else pending += 1;
  }
  return { pending, delivered, failed, unknown };
}
