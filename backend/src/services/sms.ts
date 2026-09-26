import { env, isProd } from '../env.js';
import { normalizePhone, PHONE_RE } from '../lib/code.js';
import { DEFAULT_LEASING_SMS_TEMPLATES, fillLeasingSmsTemplate } from '../lib/leasing.js';
import { SHOP_URL } from './mailLayout.js';

export interface SmsMessage {
  phone: string;
  text: string;
}

/** queued/pending = хүлээн авсан. delivered = DLR батлагдсан. failed = үйлчилгээ татгалзсан/эцсийн алдаа. unknown = үр дүн тодорхойгүй. */
export type SmsLifecycleStatus = 'queued' | 'pending' | 'delivered' | 'failed' | 'unknown';

export const OPEN_SMS_STATUSES: SmsLifecycleStatus[] = ['queued', 'pending'];
export const TERMINAL_SMS_STATUSES: SmsLifecycleStatus[] = ['delivered', 'failed'];

export function smsStatusLabel(status: SmsLifecycleStatus, failedReason?: string | null): string {
  if (status === 'delivered') return 'Хүргэгдсэн';
  if (status === 'failed') {
    const reason = failedReason?.trim();
    return reason ? `Хүргэлт амжилтгүй: ${reason}` : 'Хүргэлт амжилтгүй';
  }
  if (status === 'unknown') return 'Хүргэлтийн төлөв одоогоор тодорхойгүй';
  return 'Хүргэлт хүлээгдэж байна';
}

export interface SmsSendResult {
  /** Үйлчилгээ хүсэлтийг хүлээн авсан эсэх. Утсанд хүрсэн эсэх биш. */
  accepted: boolean;
  status: SmsLifecycleStatus;
  id?: string;
  error?: string;
}

export interface SmsDeliveryReport {
  status: SmsLifecycleStatus;
  error?: string;
}

/** Провайдер солиход зөвхөн энэ интерфейсийг шинээр хэрэгжүүлнэ. */
export interface SmsProvider {
  readonly name: string;
  /** Хүргэлтийн тайлан шалгах API байвал true. */
  readonly tracksDelivery?: boolean;
  send(message: SmsMessage): Promise<SmsSendResult>;
  delivery?(messageId: string): Promise<SmsDeliveryReport>;
}

export const CALLPRO_SMS_BASE_URL = 'https://api-text.callpro.mn/v1/sms';
export const SMS_HTTP_TIMEOUT_MS = 8_000;

/** POST /send — base аль хэдийн /send-ээр төгссөн бол давхар нэмэхгүй. */
export function callProSendUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return /\/send$/i.test(base) ? base : `${base}/send`;
}

export function callProDetailUrl(baseUrl: string, messageId: string): string {
  const base = baseUrl.replace(/\/+$/, '').replace(/\/send$/i, '');
  return `${base}/${encodeURIComponent(messageId)}`;
}

export type SmsChannel = 'leasing' | 'shop';
export type SmsProviderName = 'console' | 'http' | 'callpro';

export function smsResult(input: {
  accepted: boolean;
  status: SmsLifecycleStatus;
  id?: string;
  error?: string;
}): SmsSendResult {
  return {
    accepted: input.accepted,
    status: input.status,
    id: input.id,
    error: input.error,
  };
}

/**
 * CallPro Text POST /v1/sms/send — батлагдсан талбар:
 * HTTP 200 + `message_id`, `status` ихэвчлэн `queued` (fleetbase CallProSmsService, erxes).
 * `success`/`successful`-ийг delivered гэж үзэхгүй.
 */
export function callProSendOutcome(status: number, body: Record<string, unknown>): SmsSendResult {
  if (status >= 500) {
    return smsResult({
      accepted: false,
      status: 'unknown',
      error: smsErrorFromBody(status, body),
    });
  }
  if (status < 200 || status >= 300) {
    return smsResult({
      accepted: false,
      status: 'failed',
      error: smsErrorFromBody(status, body),
    });
  }

  const id = messageIdOf(body);
  if (!id) {
    return smsResult({
      accepted: false,
      status: 'unknown',
      error: 'CallPro message_id алга.',
    });
  }

  const named = lifecycleFromNamedStatus(body.status);
  if (named === 'failed') {
    return smsResult({ accepted: false, status: 'failed', id, error: smsErrorFromBody(status, body) });
  }

  return smsResult({ accepted: true, status: named === 'queued' ? 'queued' : 'pending', id });
}

const CALLPRO_EVENT_QUEUED = new Set(['queued']);
const CALLPRO_EVENT_DELIVERED = new Set(['delivered']);
const CALLPRO_EVENT_UNDELIVERED = new Set(['undelivered']);
const CALLPRO_EVENT_INCONCLUSIVE = new Set(['changed', 'rate']);

function callProEventName(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().toLowerCase();
}

function eventsOfMessage(message: unknown): string[] | null {
  if (!message || typeof message !== 'object') return null;
  const events = (message as { events?: unknown }).events;
  if (!Array.isArray(events)) return null;
  const names: string[] = [];
  for (const item of events) {
    const name =
      callProEventName(item) ??
      (item && typeof item === 'object'
        ? callProEventName((item as { type?: unknown }).type) ??
          callProEventName((item as { event?: unknown }).event) ??
          callProEventName((item as { name?: unknown }).name) ??
          callProEventName((item as { status?: unknown }).status)
        : null);
    if (!name) return null;
    names.push(name);
  }
  return names;
}

/**
 * CallPro GET /v1/sms/:id — `delivered` болон `messages[].events`.
 * QUEUED = хүлээгдэж байна. DELIVERED = хүргэлт батлагдсан. UNDELIVERED = хүргэлт амжилтгүй.
 * CHANGED, RATE-ийг хүрсэн/хүрээгүй гэж таамаглахгүй. delivered:false дангаараа failed биш.
 * Олон сегмент бүгд DELIVERED байвал л delivered. Дутуу/зөрчилтэй хариу unknown.
 */
export function callProDeliveryOutcome(body: Record<string, unknown>): SmsDeliveryReport {
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (messages && messages.length > 0) {
    const perMessage: SmsLifecycleStatus[] = [];
    for (const message of messages) {
      const events = eventsOfMessage(message);
      if (!events) return { status: 'unknown' };
      perMessage.push(lifecycleFromEvents(events));
    }
    if (perMessage.some((status) => status === 'unknown')) return { status: 'unknown' };
    if (perMessage.every((status) => status === 'delivered')) return { status: 'delivered' };
    if (perMessage.every((status) => status === 'failed')) {
      return { status: 'failed', error: 'Хүргэлт амжилтгүй.' };
    }
    if (perMessage.every((status) => status === 'queued' || status === 'pending')) {
      return { status: perMessage.some((status) => status === 'pending') ? 'pending' : 'queued' };
    }
    return { status: 'unknown' };
  }

  const topEvents = eventsOfMessage(body);
  if (topEvents && topEvents.length > 0) {
    return { status: lifecycleFromEvents(topEvents), ...(lifecycleFromEvents(topEvents) === 'failed' ? { error: 'Хүргэлт амжилтгүй.' } : {}) };
  }

  const named = lifecycleFromNamedStatus(body.status);
  if (named === 'delivered') {
    if (body.delivered === false) return { status: 'unknown' };
    return { status: 'delivered' };
  }
  if (named === 'failed') return { status: 'failed', error: 'Хүргэлт амжилтгүй.' };
  if (named === 'queued' || named === 'pending') return { status: named };

  if (body.delivered === true) return { status: 'delivered' };
  if (body.delivered === false) return { status: 'pending' };
  return { status: 'unknown' };
}

function lifecycleFromNamedStatus(status: unknown): SmsLifecycleStatus | null {
  const name = callProEventName(status);
  if (!name) return null;
  if (CALLPRO_EVENT_DELIVERED.has(name)) return 'delivered';
  if (CALLPRO_EVENT_UNDELIVERED.has(name)) return 'failed';
  if (CALLPRO_EVENT_QUEUED.has(name)) return 'queued';
  if (CALLPRO_EVENT_INCONCLUSIVE.has(name)) return 'unknown';
  return null;
}

function lifecycleFromEvents(events: string[]): SmsLifecycleStatus {
  if (events.length === 0) return 'unknown';
  if (events.some((name) => CALLPRO_EVENT_INCONCLUSIVE.has(name))) return 'unknown';
  const last = events[events.length - 1]!;
  if (CALLPRO_EVENT_DELIVERED.has(last) && events.every((name) => CALLPRO_EVENT_QUEUED.has(name) || CALLPRO_EVENT_DELIVERED.has(name))) {
    return 'delivered';
  }
  if (CALLPRO_EVENT_UNDELIVERED.has(last) && events.every((name) => CALLPRO_EVENT_QUEUED.has(name) || CALLPRO_EVENT_UNDELIVERED.has(name))) {
    return 'failed';
  }
  if (events.every((name) => CALLPRO_EVENT_QUEUED.has(name))) return 'queued';
  if (CALLPRO_EVENT_DELIVERED.has(last) && events.some((name) => CALLPRO_EVENT_UNDELIVERED.has(name))) {
    return 'unknown';
  }
  if (CALLPRO_EVENT_UNDELIVERED.has(last) && events.some((name) => CALLPRO_EVENT_DELIVERED.has(name))) {
    return 'unknown';
  }
  return 'unknown';
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
  readonly tracksDelivery = false;

  constructor(
    private readonly channel: SmsChannel,
    private readonly error: string,
  ) {}

  async send(_message: SmsMessage): Promise<SmsSendResult> {
    return smsResult({ accepted: false, status: 'failed', error: this.error });
  }
}

/** Зөвхөн SMS_PROVIDER=console эсвэл SHOP_SMS_PROVIDER=console үед. Мессежийн агуулгыг логлохгүй. */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';
  readonly tracksDelivery = false;

  constructor(
    private readonly channel: SmsChannel = 'leasing',
    private readonly production = isProd,
  ) {}

  async send(message: SmsMessage) {
    const to = smsPhoneOf(message.phone) ?? message.phone;
    if (this.production) {
      return smsResult({
        accepted: false,
        status: 'failed',
        error: 'Production дээр console SMS ашиглахгүй.',
      });
    }
    console.info(`[sms:${this.channel}:console] → ${to}`);
    return smsResult({ accepted: true, status: 'queued', id: `console-${Date.now()}` });
  }
}

/** Ерөнхий HTTP провайдер — Bearer + JSON { from, to, text }. Хүргэлтийн тайлан байхгүй. */
export class HttpSmsProvider implements SmsProvider {
  readonly name = 'http';
  readonly tracksDelivery = false;

  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly sender: string,
  ) {}

  async send(message: SmsMessage) {
    const to = smsPhoneOf(message.phone);
    if (!to) return smsResult({ accepted: false, status: 'failed', error: 'Утасны дугаар буруу.' });
    try {
      const res = await fetchWithTimeout(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ from: this.sender, to, text: message.text }),
      });
      if (!res.ok) {
        return smsResult({
          accepted: false,
          status: 'failed',
          error: await smsHttpError(res),
        });
      }
      return smsResult({ accepted: true, status: 'queued' });
    } catch (error) {
      return smsResult({
        accepted: false,
        status: 'unknown',
        error: fetchErrorMessage(error),
      });
    }
  }
}

/**
 * CallPro Text API — https://api-text.callpro.mn/v1/sms
 * Header: x-api-key. Body: from (72xxxxxx), to (8 орон), text.
 * /send 200 (`queued`) нь хүлээн авсан гэсэн үг. Хүргэлтийг GET /:id-аар дараа шалгана.
 */
export class CallProSmsProvider implements SmsProvider {
  readonly name = 'callpro';
  readonly tracksDelivery = true;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly baseUrl = CALLPRO_SMS_BASE_URL,
  ) {}

  async send(message: SmsMessage): Promise<SmsSendResult> {
    const to = smsPhoneOf(message.phone);
    if (!to) return smsResult({ accepted: false, status: 'failed', error: 'Утасны дугаар буруу.' });
    const from = this.from.replace(/\D/g, '');
    if (!from) {
      return smsResult({ accepted: false, status: 'failed', error: 'CallPro илгээгч дугаар алга.' });
    }

    return this.postSend(from, to, message.text);
  }

  private async postSend(from: string, to: string, text: string): Promise<SmsSendResult> {
    try {
      const res = await fetchWithTimeout(callProSendUrl(this.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({ from, to, text }),
      });
      const body = await readJson(res);
      return callProSendOutcome(res.status, body);
    } catch (error) {
      return smsResult({
        accepted: false,
        status: 'unknown',
        error: fetchErrorMessage(error),
      });
    }
  }

  /** Хүргэлтийн төлөв — /send-ээс ирсэн message_id. Timeout/5xx нь failed биш. */
  async delivery(messageId: string): Promise<SmsDeliveryReport> {
    const id = messageId.trim();
    if (!id) return { status: 'unknown', error: 'message_id алга.' };
    try {
      const res = await fetchWithTimeout(callProDetailUrl(this.baseUrl, id), {
        method: 'GET',
        headers: { 'x-api-key': this.apiKey },
      });
      const body = await readJson(res);
      if (res.status === 401 || res.status === 403) {
        return { status: 'unknown', error: smsErrorFromBody(res.status, body) };
      }
      if (res.status === 404) {
        return { status: 'unknown', error: smsErrorFromBody(res.status, body) };
      }
      if (!res.ok) {
        return { status: 'unknown', error: smsErrorFromBody(res.status, body) };
      }
      return callProDeliveryOutcome(body);
    } catch (error) {
      return { status: 'unknown', error: fetchErrorMessage(error) };
    }
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SMS_HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function fetchErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'SMS хүсэлт timeout.';
  return String(error);
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

function messageIdOf(body: Record<string, unknown>): string | undefined {
  if (typeof body.message_id === 'string' && body.message_id.trim()) return body.message_id.trim();
  if (typeof body.message_id === 'number' && Number.isFinite(body.message_id)) {
    return String(body.message_id);
  }
  return undefined;
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

/** Дэлгүүрийн OTP + шоп админы бараа ирсэн SMS. Лизингийн түлхүүр/илгээгч ашиглахгүй. */
export const shopSms: SmsProvider = buildSmsProvider({
  channel: 'shop',
  provider: env.SHOP_SMS_PROVIDER ?? env.SMS_PROVIDER,
  apiKey: env.SHOP_SMS_API_KEY,
  from: env.SHOP_SMS_FROM,
  apiUrl: env.SHOP_SMS_API_URL,
  sender: env.SHOP_SMS_FROM ?? env.SMS_SENDER,
});

/** Лизингийн SMS. Шоп OTP / бараа ирсэнд `shopSms`. */
export const sms: SmsProvider = leasingSms;

export function smsProviderOf(channel: SmsChannel): SmsProvider {
  return channel === 'shop' ? shopSms : leasingSms;
}

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
