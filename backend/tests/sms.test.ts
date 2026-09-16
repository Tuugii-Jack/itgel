import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  CALLPRO_DELIVERY_POLL_MS,
  CallProSmsProvider,
  ConsoleSmsProvider,
  DisabledSmsProvider,
  buildSmsProvider,
  parseSmsPhones,
  prepareCustomSms,
  smsDeliveryState,
  smsPhoneOf,
  stripSmsUrls,
} from '../src/services/sms.js';

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function stubCallPro(opts?: {
  send?: Record<string, unknown> | ((n: number) => Record<string, unknown>);
  sendStatus?: number | ((n: number) => number);
  delivery?: Record<string, unknown> | ((n: number) => Record<string, unknown>);
}) {
  let sendN = 0;
  let deliveryN = 0;
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith('/send')) {
      sendN += 1;
      const body = typeof opts?.send === 'function' ? opts.send(sendN) : opts?.send;
      const status =
        typeof opts?.sendStatus === 'function' ? opts.sendStatus(sendN) : (opts?.sendStatus ?? 200);
      return jsonRes(body ?? { status: 'queued', message_id: 'm1' }, status);
    }
    deliveryN += 1;
    const body = typeof opts?.delivery === 'function' ? opts.delivery(deliveryN) : opts?.delivery;
    return jsonRes(body ?? { uniqueId: 'm1', delivered: true, messages: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('CallPro SMS', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('утасны дугаарыг 8 орон болгоно', () => {
    expect(smsPhoneOf('9911-2233')).toBe('99112233');
    expect(smsPhoneOf('+97699112233')).toBe('99112233');
    expect(smsPhoneOf('123')).toBeNull();
  });

  it('send нь x-api-key болон from/to/text илгээнэ, хүргэлт амжилттай бол ok', async () => {
    const fetchMock = stubCallPro();
    const provider = new CallProSmsProvider('secret-key', '72123456');
    const result = await provider.send({ phone: '9911-2233', text: 'сайн байна уу' });
    expect(result).toEqual({ ok: true, id: 'm1' });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api-text.callpro.mn/v1/sms/send');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('secret-key');
    expect(JSON.parse(String(init.body))).toEqual({
      from: '72123456',
      to: '99112233',
      text: 'сайн байна уу',
    });
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe(
      'https://api-text.callpro.mn/v1/sms/m1',
    );
  });

  it('queued хэвээр бол амжилт гэж тооцохгүй', async () => {
    const fetchMock = stubCallPro({
      delivery: { uniqueId: 'm1', delivered: false, status: 'queued' },
    });
    const provider = new CallProSmsProvider('secret-key', '72123456');
    const result = await provider.send({ phone: '99112233', text: 'hi' });
    expect(result.ok).toBe(false);
    expect(result.id).toBe('m1');
    expect(result.error).toBe('Утас руу хүргэгдсэнгүй.');
    expect(fetchMock.mock.calls.length).toBe(1 + 1 + CALLPRO_DELIVERY_POLL_MS.length);
  });

  it('хүргэлт failed бол шууд алдаа', async () => {
    const fetchMock = stubCallPro({
      delivery: { uniqueId: 'm1', delivered: false, status: 'failed' },
    });
    const provider = new CallProSmsProvider('secret-key', '72123456');
    const result = await provider.send({ phone: '99112233', text: 'hi' });
    expect(result).toEqual({ ok: false, id: 'm1', error: 'Утас руу хүргэгдсэнгүй.' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('message_id байхгүй 200-ийг амжилт гэж үзэхгүй', async () => {
    const fetchMock = stubCallPro({ send: { status: 'queued' } });
    const provider = new CallProSmsProvider('secret-key', '72123456');
    const result = await provider.send({ phone: '99112233', text: 'hi' });
    expect(result).toEqual({ ok: false, error: 'CallPro message_id алга.' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('402 төлбөр дутуу бол алдаа буцаана', async () => {
    stubCallPro({ send: { error: 'Payment not paid' }, sendStatus: 402 });
    const provider = new CallProSmsProvider('secret-key', '72123456');
    const result = await provider.send({ phone: '99112233', text: 'hi' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Payment not paid');
  });

  it('delivery нь message_id-аар шалгана', async () => {
    const fetchMock = stubCallPro({
      delivery: { uniqueId: 'm1', delivered: true, messages: [] },
    });
    const provider = new CallProSmsProvider('secret-key', '72123456');
    const result = await provider.delivery('m1');
    expect(result).toMatchObject({ ok: true, delivered: true, failed: false });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://api-text.callpro.mn/v1/sms/m1',
    );
  });

  it('queued дараа delivered болсон үед л амжилт', async () => {
    stubCallPro({
      delivery: (n) =>
        n < 3
          ? { uniqueId: 'm1', delivered: false, status: 'queued' }
          : { uniqueId: 'm1', delivered: true, status: 'delivered' },
    });
    const provider = new CallProSmsProvider('secret-key', '72123456');
    const result = await provider.send({ phone: '99112233', text: 'hi' });
    expect(result).toEqual({ ok: true, id: 'm1' });
  });

  it('холбоос эсвэл 500 алдаатай бол холбоосгүйгээр дахин илгээнэ', async () => {
    const fetchMock = stubCallPro({
      send: (n) =>
        n === 1 ? { error: 'Internal server error' } : { status: 'queued', message_id: 'm2' },
      sendStatus: (n) => (n === 1 ? 500 : 200),
      delivery: { uniqueId: 'm2', delivered: true },
    });
    const provider = new CallProSmsProvider('secret-key', '72123456');
    const result = await provider.send({
      phone: '99112233',
      text: 'itgel PH-R9PZNW бараа ирлээ. https://itgelshop.mn/t/PH-R9PZNW',
    });
    expect(result).toEqual({ ok: true, id: 'm2' });
    const sendCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/send'));
    expect(sendCalls).toHaveLength(2);
    expect(JSON.parse(String((sendCalls[1] as unknown as [string, RequestInit])[1].body))).toEqual({
      from: '72123456',
      to: '99112233',
      text: 'itgel PH-R9PZNW бараа ирлээ.',
    });
  });

  it('smsDeliveryState — delivered yes / status delivered / failed', () => {
    expect(smsDeliveryState({ delivered: true })).toEqual({ delivered: true, failed: false, status: undefined });
    expect(smsDeliveryState({ delivered: 'yes' })).toEqual({ delivered: true, failed: false, status: undefined });
    expect(smsDeliveryState({ status: 'delivered' })).toEqual({
      delivered: true,
      failed: false,
      status: 'delivered',
    });
    expect(smsDeliveryState({ status: 'queued', delivered: false })).toEqual({
      delivered: false,
      failed: false,
      status: 'queued',
    });
    expect(smsDeliveryState({ status: 'rejected' })).toEqual({
      delivered: false,
      failed: true,
      status: 'rejected',
    });
  });

  it('холбоос хасна', () => {
    expect(stripSmsUrls('itgel PH-R9PZNW бараа ирлээ. https://itgelshop.mn/t/PH-R9PZNW')).toBe(
      'itgel PH-R9PZNW бараа ирлээ.',
    );
  });

  it('чөлөөт SMS холбоос хасаад хоосон болгохгүй', () => {
    expect(prepareCustomSms('  сайн байна уу  https://x.mn  ')).toBe('сайн байна уу');
  });

  it('олон дугаарыг таслал, мөрөөр ялгана', () => {
    expect(parseSmsPhones('99112233, 8811-2233\n99112233')).toEqual({
      phones: ['99112233', '88112233'],
      invalid: [],
    });
    expect(parseSmsPhones(['123', '99112233']).invalid).toEqual(['123']);
  });
});

describe('SMS суваг', () => {
  it('шоп түлхүүр хоосон callpro нь disabled, console биш', async () => {
    const shop = buildSmsProvider({
      channel: 'shop',
      provider: 'callpro',
      sender: 'itgel',
    });
    expect(shop).toBeInstanceOf(DisabledSmsProvider);
    expect(shop.name).toBe('disabled');
    const result = await shop.send({ phone: '99112233', text: 'OTP 123456' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/SHOP_SMS/);
  });

  it('зөвхөн console гэж заасан үед console ашиглана', () => {
    const shop = buildSmsProvider({
      channel: 'shop',
      provider: 'console',
      sender: 'itgel',
    });
    expect(shop).toBeInstanceOf(ConsoleSmsProvider);
  });

  it('console production-д OTP логлохгүй; test/dev дээр илгээлт харагдана', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const provider = new ConsoleSmsProvider('shop');
    const result = await provider.send({ phone: '99112233', text: 'OTP 123456 нууц' });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/SHOP_SMS_API_KEY|SMS_API_KEY/);
    spy.mockRestore();
  });

  it('лизинг түлхүүртэй бол CallPro', () => {
    const leasing = buildSmsProvider({
      channel: 'leasing',
      provider: 'callpro',
      apiKey: 'leasing-key',
      from: '72111111',
      sender: 'itgel',
    });
    expect(leasing).toBeInstanceOf(CallProSmsProvider);
  });

  it('шоп түлхүүртэй бол тусдаа CallPro', () => {
    const shop = buildSmsProvider({
      channel: 'shop',
      provider: 'callpro',
      apiKey: 'shop-key',
      from: '72222222',
      sender: 'itgel',
    });
    expect(shop).toBeInstanceOf(CallProSmsProvider);
  });
});
