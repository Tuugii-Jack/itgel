import { describe, expect, it, vi, afterEach } from 'vitest';
import { CallProSmsProvider, ConsoleSmsProvider, DisabledSmsProvider, buildSmsProvider, smsPhoneOf, stripSmsUrls, prepareCustomSms, parseSmsPhones } from '../src/services/sms.js';

describe('CallPro SMS', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('утасны дугаарыг 8 орон болгоно', () => {
    expect(smsPhoneOf('9911-2233')).toBe('99112233');
    expect(smsPhoneOf('+97699112233')).toBe('99112233');
    expect(smsPhoneOf('123')).toBeNull();
  });

  it('send нь x-api-key болон from/to/text илгээнэ', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: 'queued', message_id: 'm1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new CallProSmsProvider('secret-key', '72123456');
    const result = await provider.send({ phone: '9911-2233', text: 'сайн байна уу' });
    expect(result).toEqual({ ok: true, id: 'm1' });
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

  it('402 төлбөр дутуу бол алдаа буцаана', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Payment not paid' }), { status: 402 })),
    );
    const provider = new CallProSmsProvider('secret-key', '72123456');
    const result = await provider.send({ phone: '99112233', text: 'hi' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Payment not paid');
  });

  it('delivery нь message_id-аар шалгана', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ uniqueId: 'm1', delivered: true, messages: [] }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new CallProSmsProvider('secret-key', '72123456');
    const result = await provider.delivery('m1');
    expect(result).toEqual({ ok: true, delivered: true });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://api-text.callpro.mn/v1/sms/m1',
    );
  });

  it('холбоос эсвэл 500 алдаатай бол холбоосгүйгээр дахин илгээнэ', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'queued', message_id: 'm2' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new CallProSmsProvider('secret-key', '72123456');
    const result = await provider.send({
      phone: '99112233',
      text: 'itgel PH-R9PZNW бараа ирлээ. https://itgelshop.mn/t/PH-R9PZNW',
    });
    expect(result).toEqual({ ok: true, id: 'm2' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({
      from: '72123456',
      to: '99112233',
      text: 'itgel PH-R9PZNW бараа ирлээ.',
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
