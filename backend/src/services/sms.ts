import { env, isProd } from '../env.js';
import { normalizePhone, PHONE_RE } from '../lib/code.js';
import { DEFAULT_LEASING_SMS_TEMPLATES, fillLeasingSmsTemplate } from '../lib/leasing.js';
import { SHOP_URL } from './mailLayout.js';

export interface SmsMessage {
  phone: string;
  text: string;
}

export interface SmsSendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/** Провайдер солиход зөвхөн энэ интерфейсийг шинээр хэрэгжүүлнэ. */
export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsSendResult>;
}

export const CALLPRO_SMS_BASE_URL = 'https://api-text.callpro.mn/v1/sms';

/** /send queued-ийн дараа DLR хүлээх хоорондын завсар (нийт ~10 сек). */
export const CALLPRO_DELIVERY_POLL_MS = [500, 1000, 1500, 2500, 4000];

export type SmsChannel = 'leasing' | 'shop';
export type SmsProviderName = 'console' | 'http' | 'callpro';

const DELIVERED_STATUSES = new Set(['delivered', 'delivrd', 'success', 'successful']);
const FAILED_STATUSES = new Set([
  'failed',
  'fail',
  'rejected',
  'expired',
  'undelivered',
  'error',
  'blocked',
  'cancelled',
  'canceled',
  'spam',
  'invalid',
]);

export type SmsDeliveryState = {
  delivered: boolean;
  failed: boolean;
  status?: string;
};

/** CallPro GET /v1/sms/:id болон /send хариунаас хүргэлтийн төлөв. */
export function smsDeliveryState(body: Record<string, unknown>): SmsDeliveryState {
  const parts = flattenSmsBodies(body);
  let status: string | undefined;
  let delivered = false;
  let failed = false;
  for (const part of parts) {
    const s = smsStatusOf(part);
    if (s && !status) status = s;
    if (smsFlag(part.delivered) === true || (s != null && DELIVERED_STATUSES.has(s))) {
      delivered = true;
    } else if (s != null && FAILED_STATUSES.has(s)) {
      failed = true;
    }
  }
  if (delivered) return { delivered: true, failed: false, status };
  return { delivered: false, failed, status };
}

/** CallPro 8 оронтой дугаар авна. +976 / зай / зураас хасна. */
export function smsPhoneOf(input: string): string | null {
  const phone = normalizePhone(input);
  return PHONE_RE.test(phone) ? phone : null;
}

/** Жагсаалт/таслал/мөрөөс давхардалгүй 8 оронтой дугаар. */
export function parseSmsPhones(input: string | string[]): {
  phones: string[];
  invalid: string[];
} {
  const parts = (Array.isArray(input) ? input : input.split(/[\s,;]+/))
    .map((part) => part.trim())
    .filter(Boolean);
  const phones: string[] = [];
  const seen = new Set<string>();
  const invalid: string[] = [];
  for (const part of parts) {
    const phone = smsPhoneOf(part);
    if (!phone) {
      invalid.push(part);
      continue;
    }
    if (seen.has(phone)) continue;
    seen.add(phone);
    phones.push(phone);
  }
  return { phones, invalid };
}

export class DisabledSmsProvider implements SmsProvider {
  readonly name = 'disabled';

  constructor(
    private readonly channel: SmsChannel,
    private readonly error: string,
  ) {}

  async send(_message: SmsMessage): Promise<SmsSendResult> {
    return { ok: false, error: this.error };
  }
}

/** Зөвхөн SMS_PROVIDER=console эсвэл SHOP_SMS_PROVIDER=console үед. Мессежийн агуулгыг логлохгүй. */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';

  constructor(private readonly channel: SmsChannel = 'leasing') {}

  async send(message: SmsMessage) {
    const to = smsPhoneOf(message.phone) ?? message.phone;
    if (!isProd) {
      console.info(`[sms:${this.channel}:console] → ${to}\n${message.text}`);
    }
    return { ok: true, id: `console-${Date.now()}` };
  }
}

/** Ерөнхий HTTP провайдер — Bearer + JSON { from, to, text }. */
export class HttpSmsProvider implements SmsProvider {
  readonly name = 'http';

  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly sender: string,
  ) {}

  async send(message: SmsMessage) {
    const to = smsPhoneOf(message.phone);
    if (!to) return { ok: false, error: 'Утасны дугаар буруу.' };
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ from: this.sender, to, text: message.text }),
      });
      if (!res.ok) return { ok: false, error: await smsHttpError(res) };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }
}

/**
 * CallPro Text API — https://api-text.callpro.mn/v1/sms
 * Header: x-api-key. Body: from (72xxxxxx), to (8 орон), text.
 * /send 200 (queued) нь хүлээн авсан гэсэн үг — утас руу очсоныг GET /:id-аар шалгана.
 */
export class CallProSmsProvider implements SmsProvider {
  readonly name = 'callpro';
  private readonly pollDelaysMs: number[];

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly baseUrl = CALLPRO_SMS_BASE_URL,
    options: { pollDelaysMs?: number[] } = {},
  ) {
    this.pollDelaysMs =
      options.pollDelaysMs ??
      (process.env.NODE_ENV === 'test'
        ? CALLPRO_DELIVERY_POLL_MS.map(() => 0)
        : CALLPRO_DELIVERY_POLL_MS);
  }

  async send(message: SmsMessage): Promise<SmsSendResult> {
    const to = smsPhoneOf(message.phone);
    if (!to) return { ok: false, error: 'Утасны дугаар буруу.' };
    const from = this.from.replace(/\D/g, '');
    if (!from) return { ok: false, error: 'CallPro илгээгч дугаар алга.' };

    const first = await this.postSend(from, to, message.text);
    if (first.ok) return this.confirmDelivery(first);

    const withoutLinks = stripSmsUrls(message.text);
    if (!withoutLinks || withoutLinks === message.text) return first;
    const retry = await this.postSend(from, to, withoutLinks);
    return retry.ok ? this.confirmDelivery(retry) : first;
  }

  private async postSend(from: string, to: string, text: string): Promise<SmsSendResult> {
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/send`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({ from, to, text }),
      });
      const body = await readJson(res);
      if (!res.ok) return { ok: false, error: smsErrorFromBody(res.status, body) };
      const id = messageIdOf(body);
      if (!id) return { ok: false, error: 'CallPro message_id алга.' };
      const state = smsDeliveryState(body);
      if (state.failed) {
        return { ok: false, id, error: smsTerminalError(body) };
      }
      return { ok: true, id };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }

  /** /send хүлээн авсны дараа утас руу хүргэгдснийг хүлээнэ. */
  private async confirmDelivery(accepted: SmsSendResult): Promise<SmsSendResult> {
    const id = accepted.id?.trim();
    if (!id) return { ok: false, error: 'CallPro message_id алга.' };

    let lastError: string | undefined;
    for (let attempt = 0; attempt <= this.pollDelaysMs.length; attempt++) {
      if (attempt > 0) await sleep(this.pollDelaysMs[attempt - 1]!);
      const report = await this.delivery(id);
      if (report.delivered) return { ok: true, id };
      if (report.failed) {
        return { ok: false, id, error: report.error ?? 'Утас руу хүргэгдсэнгүй.' };
      }
      lastError = report.error;
    }

    console.warn(`[sms:callpro] ${id} утас руу хүргэгдсэнгүй`);
    return { ok: false, id, error: lastError ?? 'Утас руу хүргэгдсэнгүй.' };
  }

  /** Хүргэлтийн төлөв — /send-ээс ирсэн message_id. */
  async delivery(messageId: string): Promise<{
    ok: boolean;
    delivered?: boolean;
    failed?: boolean;
    status?: string;
    error?: string;
  }> {
    const id = messageId.trim();
    if (!id) return { ok: false, failed: true, error: 'message_id алга.' };
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/${encodeURIComponent(id)}`, {
        method: 'GET',
        headers: { 'x-api-key': this.apiKey },
      });
      const body = await readJson(res);
      if (!res.ok) {
        const error = smsErrorFromBody(res.status, body);
        const failed = res.status === 401 || res.status === 402 || res.status === 403;
        return { ok: false, failed, error };
      }
      const state = smsDeliveryState(body);
      return {
        ok: true,
        delivered: state.delivered,
        failed: state.failed,
        status: state.status,
        error: state.failed ? smsTerminalError(body) : undefined,
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text.slice(0, 200) };
  }
}

async function smsHttpError(res: Response): Promise<string> {
  return smsErrorFromBody(res.status, await readJson(res));
}

function smsErrorFromBody(status: number, body: Record<string, unknown>): string {
  const msg =
    (typeof body.error === 'string' && body.error) ||
    (typeof body.reason === 'string' && body.reason) ||
    (status === 401
      ? 'Unauthorized'
      : status === 402
        ? 'Payment not paid'
        : `HTTP ${status}`);
  return msg;
}

function smsTerminalError(body: Record<string, unknown>): string {
  return (
    (typeof body.error === 'string' && body.error) ||
    (typeof body.reason === 'string' && body.reason) ||
    'Утас руу хүргэгдсэнгүй.'
  );
}

function messageIdOf(body: Record<string, unknown>): string | undefined {
  if (typeof body.message_id === 'string' && body.message_id.trim()) return body.message_id.trim();
  if (typeof body.message_id === 'number' && Number.isFinite(body.message_id)) {
    return String(body.message_id);
  }
  if (typeof body.uniqueId === 'string' && body.uniqueId.trim()) return body.uniqueId.trim();
  return undefined;
}

function smsStatusOf(body: Record<string, unknown>): string | undefined {
  for (const key of ['status', 'result', 'state'] as const) {
    const value = body[key];
    if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase();
  }
  return undefined;
}

function smsFlag(value: unknown): boolean | undefined {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'true' || s === 'yes' || s === 'y' || s === '1') return true;
    if (s === 'false' || s === 'no' || s === 'n' || s === '0') return false;
  }
  return undefined;
}

function flattenSmsBodies(body: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [body];
  if (Array.isArray(body.messages)) {
    for (const item of body.messages) {
      if (item && typeof item === 'object') out.push(item as Record<string, unknown>);
    }
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const URL_IN_SMS_RE = /https?:\/\/\S+|www\.\S+/gi;

export function stripSmsUrls(text: string): string {
  return text
    .replace(URL_IN_SMS_RE, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

/** Кирилл 70 тэмдэгт = 1 SMS. 3 сегмент хүртэл. */
export const CUSTOM_SMS_MAX_CHARS = 210;

export function prepareCustomSms(raw: string): string {
  return stripSmsUrls(raw).replace(/\s+/g, ' ').trim();
}

export function buildSmsProvider(input: {
  channel: SmsChannel;
  provider: SmsProviderName;
  apiKey?: string;
  from?: string;
  apiUrl?: string;
  sender: string;
}): SmsProvider {
  const from = input.from ?? (PHONE_RE.test(input.sender) ? input.sender : undefined);
  if (input.provider === 'console') {
    return new ConsoleSmsProvider(input.channel);
  }
  if (input.provider === 'callpro' && input.apiKey && from) {
    return new CallProSmsProvider(input.apiKey, from, input.apiUrl ?? CALLPRO_SMS_BASE_URL);
  }
  if (input.provider === 'http' && input.apiUrl && input.apiKey) {
    return new HttpSmsProvider(input.apiUrl, input.apiKey, from ?? input.sender);
  }
  const keys =
    input.channel === 'shop'
      ? 'SHOP_SMS_API_KEY болон SHOP_SMS_FROM'
      : 'SMS_API_KEY болон SMS_FROM';
  const error =
    input.provider === 'http'
      ? `SMS HTTP тохиргоо дутуу (${input.channel}).`
      : `CallPro тохиргоо дутуу — ${keys} бөглөнө үү.`;
  console.warn(`[sms:${input.channel}] ${error}`);
  return new DisabledSmsProvider(input.channel, error);
}

/** Лизинг админ — сануулга, чөлөөт SMS. */
export const leasingSms: SmsProvider = buildSmsProvider({
  channel: 'leasing',
  provider: env.SMS_PROVIDER,
  apiKey: env.SMS_API_KEY,
  from: env.SMS_FROM,
  apiUrl: env.SMS_API_URL,
  sender: env.SMS_SENDER,
});

/** Дэлгүүрийн OTP + шоп админы бараа ирсэн SMS. Лизингийн түлхүүр ашиглахгүй. */
export const shopSms: SmsProvider = buildSmsProvider({
  channel: 'shop',
  provider: env.SHOP_SMS_PROVIDER ?? env.SMS_PROVIDER,
  apiKey: env.SHOP_SMS_API_KEY,
  from: env.SHOP_SMS_FROM,
  apiUrl: env.SHOP_SMS_API_URL ?? env.SMS_API_URL,
  sender: env.SMS_SENDER,
});

/** Лизингийн SMS. Шоп OTP / бараа ирсэнд `shopSms`. */
export const sms: SmsProvider = leasingSms;

/** Захиалгын хяналтын холбоос — SMS-д кирилл 70 тэмдэгт/segment. */
export function shopTrackUrl(code: string): string {
  return `${SHOP_URL}/t/${encodeURIComponent(code)}`;
}

export const smsTemplates = {
  otp: (code: string) => `itgel нэвтрэх код ${code}. 5 мин.`,
  orderCreated: (code: string, amount: number) =>
    `itgel: Захиалга ${code} бүртгэгдлээ. Төлөх дүн ${amount.toLocaleString('mn-MN')}₮.`,
  arrived: (code: string) => `itgel ${code} бараа ирлээ.`,
  leasingPay: (code: string, amount: number) =>
    `itgel ${code} төлөх ${amount.toLocaleString('mn-MN')}₮.`,
  leasingDueToday: (name: string, amount: number, date: string) =>
    fillLeasingSmsTemplate(DEFAULT_LEASING_SMS_TEMPLATES.dueToday, {
      ner: name,
      dun: amount,
      ognoo: date,
    }),
  leasingOverdue: (name: string, amount: number, days: number) =>
    fillLeasingSmsTemplate(DEFAULT_LEASING_SMS_TEMPLATES.overdue, {
      ner: name,
      dun: amount,
      honog: days,
    }),
  leasingArrivedUnpaid: (name: string, amount: number) =>
    fillLeasingSmsTemplate(DEFAULT_LEASING_SMS_TEMPLATES.arrivedUnpaid, {
      ner: name,
      dun: amount,
    }),
};
