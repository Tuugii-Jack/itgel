import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  CallProSmsProvider,
  ConsoleSmsProvider,
  DisabledSmsProvider,
  HttpSmsProvider,
  buildSmsProvider,
  callProDeliveryOutcome,
  callProSendOutcome,
  parseSmsPhones,
  prepareCustomSms,
  smsPhoneOf,
  smsStatusLabel,
  stripSmsUrls,
} from '../src/services/sms.js';

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe('CallPro SMS contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('утасны дугаарыг 8 орон болгоно', () => {
    expect(smsPhoneOf('9911-2233')).toBe('99112233');
    expect(smsPhoneOf('+97699112233')).toBe('99112233');
    expect(smsPhoneOf('123')).toBeNull();
  });

  it('send queued нь хүлээн авсан, delivered биш', async () => {
    const fetchMock = vi.fn(async () => jsonRes({ status: 'queued', message_id: 'm1' }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new CallProSmsProvider('secret-key', '72123456');
    const result = await provider.send({ phone: '9911-2233', text: 'сайн байна уу' });
    expect(result).toEqual({ accepted: true, status: 'queued', id: 'm1' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api-text.callpro.mn/v1/sms/send');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('secret-key');
    expect(JSON.parse(String(init.body))).toEqual({
      from: '72123456',
      to: '99112233',
      text: 'сайн байна уу',
    });
  });

  it('message_id байхгүй 200 нь unknown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ status: 'queued' })));
    const result = await new CallProSmsProvider('k', '72123456').send({
      phone: '99112233',
      text: 'hi',
    });
    expect(result).toMatchObject({ accepted: false, status: 'unknown' });
  });

  it('402 төлбөр дутуу бол failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ error: 'Payment not paid' }, 402)));
    const result = await new CallProSmsProvider('k', '72123456').send({
      phone: '99112233',
      text: 'hi',
    });
    expect(result).toMatchObject({ accepted: false, status: 'failed', error: 'Payment not paid' });
  });

  it('timeout нь unknown, failed биш', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        init?.signal?.addEventListener('abort', () => undefined);
        throw err;
      }),
    );
    const result = await new CallProSmsProvider('k', '72123456').send({
      phone: '99112233',
      text: 'hi',
    });
    expect(result.status).toBe('unknown');
    expect(result.accepted).toBe(false);
  });

  it('GET delivered:true бол delivered', async () => {
    const fetchMock = vi.fn(async () =>
      jsonRes({ uniqueId: 'm1', delivered: true, messages: [] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await new CallProSmsProvider('k', '72123456').delivery('m1');
    expect(result).toEqual({ status: 'delivered' });
    const firstCall = fetchMock.mock.calls[0] as unknown as [string];
    expect(firstCall[0]).toBe('https://api-text.callpro.mn/v1/sms/m1');
  });

  it('GET delivered:false нь failed биш', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ uniqueId: 'm1', delivered: false })));
    const result = await new CallProSmsProvider('k', '72123456').delivery('m1');
    expect(result.status).toBe('pending');
  });

  it('GET 500 нь unknown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ error: 'boom' }, 500)));
    const result = await new CallProSmsProvider('k', '72123456').delivery('m1');
    expect(result.status).toBe('unknown');
  });

  it('холбоос эсвэл 500 алдаатай бол холбоосгүйгээр дахин илгээнэ', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ error: 'Internal server error' }, 500))
      .mockResolvedValueOnce(jsonRes({ status: 'queued', message_id: 'm2' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new CallProSmsProvider('k', '72123456').send({
      phone: '99112233',
      text: 'itgel PH-R9PZNW бараа ирлээ. https://itgelshop.mn/t/PH-R9PZNW',
    });
    expect(result).toEqual({ accepted: true, status: 'queued', id: 'm2' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({
      from: '72123456',
      to: '99112233',
      text: 'itgel PH-R9PZNW бараа ирлээ.',
    });
  });

  it('success + delivered:false-ийг delivered гэж үзэхгүй', () => {
    expect(callProDeliveryOutcome({ status: 'success', delivered: false })).toEqual({
      status: 'pending',
    });
    expect(callProSendOutcome(200, { message_id: 'm1', status: 'success', delivered: false })).toEqual({
      accepted: true,
      status: 'pending',
      id: 'm1',
    });
  });

  it('дутуу/танихгүй хариу unknown', () => {
    expect(callProDeliveryOutcome({})).toEqual({ status: 'unknown' });
    expect(callProDeliveryOutcome({ status: 'success' })).toEqual({ status: 'unknown' });
  });

  it('олон хэсэг — бүх delivered:true үед л delivered', () => {
    expect(
      callProDeliveryOutcome({
        delivered: false,
        messages: [{ delivered: true }, { delivered: true }],
      }),
    ).toEqual({ status: 'pending' });
    expect(
      callProDeliveryOutcome({
        messages: [{ delivered: true }, { delivered: true }],
      }),
    ).toEqual({ status: 'delivered' });
    expect(
      callProDeliveryOutcome({
        messages: [{ delivered: true }, { delivered: false }],
      }),
    ).toEqual({ status: 'pending' });
    expect(callProDeliveryOutcome({ messages: [{ id: 'a' }] })).toEqual({ status: 'unknown' });
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

  it('төлөвийн хаяг', () => {
    expect(smsStatusLabel('queued')).toBe('Хүргэлт хүлээгдэж байна');
    expect(smsStatusLabel('delivered')).toBe('Хүргэгдсэн');
    expect(smsStatusLabel('failed', 'Payment not paid')).toBe('Хүргэлт амжилтгүй: Payment not paid');
    expect(smsStatusLabel('unknown')).toBe('Хүргэлтийн төлөв одоогоор тодорхойгүй');
  });
});

describe('SMS суваг', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('шоп түлхүүр хоосон callpro нь disabled, console биш', async () => {
    const shop = buildSmsProvider({
      channel: 'shop',
      provider: 'callpro',
      sender: 'itgel',
    });
    expect(shop).toBeInstanceOf(DisabledSmsProvider);
    const result = await shop.send({ phone: '99112233', text: 'OTP 123456' });
    expect(result).toMatchObject({ accepted: false, status: 'failed' });
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

  it('console test/dev дээр queued, мессеж логлохгүй', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const provider = new ConsoleSmsProvider('shop', false);
    const result = await provider.send({ phone: '99112233', text: 'OTP 123456 нууц' });
    expect(result).toMatchObject({ accepted: true, status: 'queued' });
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/123456|OTP|SHOP_SMS_API_KEY/);
    spy.mockRestore();
  });

  it('production console амжилт буцаахгүй', async () => {
    const provider = new ConsoleSmsProvider('shop', true);
    const result = await provider.send({ phone: '99112233', text: 'OTP 123456' });
    expect(result).toMatchObject({ accepted: false, status: 'failed' });
    expect(result.error).toMatch(/console/);
  });

  it('HTTP 200-ийг delivered гэж дүгнэхгүй', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ ok: true })));
    const provider = new HttpSmsProvider('https://sms.example/send', 'key', '72123456');
    const result = await provider.send({ phone: '99112233', text: 'hi' });
    expect(result).toEqual({ accepted: true, status: 'queued' });
  });

  it('лизинг түлхүүртэй бол CallPro', () => {
    expect(
      buildSmsProvider({
        channel: 'leasing',
        provider: 'callpro',
        apiKey: 'leasing-key',
        from: '72111111',
        sender: 'itgel',
      }),
    ).toBeInstanceOf(CallProSmsProvider);
  });

  it('шоп түлхүүртэй бол тусдаа CallPro', () => {
    expect(
      buildSmsProvider({
        channel: 'shop',
        provider: 'callpro',
        apiKey: 'shop-key',
        from: '72222222',
        sender: 'itgel',
      }),
    ).toBeInstanceOf(CallProSmsProvider);
  });
});
