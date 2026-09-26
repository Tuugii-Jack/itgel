import { createHash } from 'node:crypto';
import { badRequest } from './errors.js';
import { CUSTOM_SMS_MAX_CHARS, prepareCustomSms } from '../services/sms.js';

export type SmsEncoding = 'gsm' | 'ucs2';

export function smsSegmentOf(text: string): {
  chars: number;
  segments: number;
  encoding: SmsEncoding;
  maxChars: number;
} {
  const chars = [...text].length;
  const encoding: SmsEncoding = /[^\u0000-\u007F]/.test(text) ? 'ucs2' : 'gsm';
  const first = encoding === 'gsm' ? 160 : 70;
  const next = encoding === 'gsm' ? 153 : 67;
  const segments = chars <= 0 ? 0 : chars <= first ? 1 : Math.ceil(chars / next);
  return { chars, segments, encoding, maxChars: CUSTOM_SMS_MAX_CHARS };
}

export function finalizeSmsText(raw: string): string {
  return prepareCustomSms(raw);
}

export function smsPreviewToken(
  rows: { id: string; text: string }[],
  extra?: { channel?: string; relatedType?: string },
): string {
  const canonical = [
    extra?.channel ?? '',
    extra?.relatedType ?? '',
    ...[...rows].map((row) => `${row.id}\n${row.text}`).sort(),
  ].join('\n--\n');
  return createHash('sha256').update(canonical).digest('hex');
}

export function assertSmsText(text: string): string {
  const finalText = finalizeSmsText(text);
  if (!finalText) throw badRequest('Мессеж хоосон байна.');
  if ([...finalText].length > CUSTOM_SMS_MAX_CHARS) {
    throw badRequest(`Мессеж ${CUSTOM_SMS_MAX_CHARS} тэмдэгтээс хэтрэхгүй.`);
  }
  return finalText;
}
