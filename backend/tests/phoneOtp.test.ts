import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const customer = { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() };
  const phoneOtp = {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  };
  const $executeRaw = vi.fn();
  const tx = { customer, phoneOtp, $executeRaw };
  return {
    customer,
    phoneOtp,
    $executeRaw,
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    smsSend: vi.fn(),
    dispatchSms: vi.fn(),
  };
});

vi.mock('../src/prisma.js', () => ({
  prisma: {
    customer: mocks.customer,
    phoneOtp: mocks.phoneOtp,
    $executeRaw: mocks.$executeRaw,
    $transaction: mocks.$transaction,
  },
}));
vi.mock('../src/services/sms.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/sms.js')>();
  return { ...actual, shopSms: { name: 'mock', send: mocks.smsSend } };
});
vi.mock('../src/services/smsDispatch.js', () => ({
  dispatchSms: (...args: unknown[]) => mocks.dispatchSms(...args),
}));
vi.mock('../src/lib/code.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/code.js')>();
  return { ...actual, generateOtp: () => '123456' };
});

import { consumePhoneOtp, issuePhoneOtp } from '../src/services/phoneOtp.js';
import { smsTemplates } from '../src/services/sms.js';

describe('phone OTP', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.$transaction.mockImplementation(async (fn) =>
      fn({ customer: mocks.customer, phoneOtp: mocks.phoneOtp, $executeRaw: mocks.$executeRaw }),
    );
    mocks.$executeRaw.mockResolvedValue(undefined);
    mocks.dispatchSms.mockResolvedValue({
      send: { accepted: true, status: 'queued', id: 'm1' },
      dispatch: { id: 'd1' },
    });
    mocks.phoneOtp.findFirst.mockResolvedValue(null);
    mocks.phoneOtp.findUnique.mockResolvedValue({ attempts: 1 });
    mocks.phoneOtp.updateMany.mockResolvedValue({ count: 1 });
    mocks.phoneOtp.count.mockResolvedValue(0);
    mocks.phoneOtp.create.mockImplementation(async ({ data }) => ({
      id: 'otp-1',
      createdAt: new Date(),
      usedAt: null,
      attempts: 0,
      ...data,
    }));
    mocks.phoneOtp.update.mockImplementation(async ({ data }) => ({
      id: 'otp-1',
      phone: '99112233',
      code: '123456',
      createdAt: new Date(),
      usedAt: null,
      attempts: 0,
      ...data,
    }));
  });

  it('+976 болон зайтай дугаарыг 8 орон болгож, нэргүй ч илгээнэ', async () => {
    mocks.customer.findUnique.mockResolvedValue(null);
    const result = await issuePhoneOtp({ phone: '+976 9911-2233' });
    expect(result.phone).toBe('99112233');
    expect(mocks.dispatchSms).toHaveBeenCalledWith({
      channel: 'shop',
      purpose: 'otp_login',
      phone: '99112233',
      text: smsTemplates.otp('123456'),
      relatedType: 'phone_otp',
      relatedId: 'otp-1',
    });
    expect(mocks.customer.create).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('isNew');
  });

  it('шинэ хэрэглэгчид нэргүй ч код илгээнэ, бүртгэл үүсгэхгүй', async () => {
    mocks.customer.findUnique.mockResolvedValue(null);
    const result = await issuePhoneOtp({ phone: '99112233' });
    expect(result.phone).toBe('99112233');
    expect(result).not.toHaveProperty('isNew');
    expect(mocks.dispatchSms).toHaveBeenCalledOnce();
    expect(mocks.customer.create).not.toHaveBeenCalled();
  });

  it('шинэ хэрэглэгчид нэртэй бол SMS илгээнэ', async () => {
    mocks.customer.findUnique.mockResolvedValue(null);
    const result = await issuePhoneOtp({ phone: '9911-2233', name: 'Бат' });
    expect(result.phone).toBe('99112233');
    expect(mocks.dispatchSms).toHaveBeenCalledWith({
      channel: 'shop',
      purpose: 'otp_login',
      phone: '99112233',
      text: smsTemplates.otp('123456'),
      relatedType: 'phone_otp',
      relatedId: 'otp-1',
    });
    expect(mocks.phoneOtp.create).toHaveBeenCalled();
    expect(result).not.toHaveProperty('devCode');
    expect(result).not.toHaveProperty('isNew');
  });

  it('баталгаажсан дугаарт нэргүй ч код илгээнэ', async () => {
    mocks.customer.findUnique.mockResolvedValue({
      id: 'c1',
      phone: '99112233',
      phoneVerifiedAt: new Date(),
      name: 'Бат',
    });
    await issuePhoneOtp({ phone: '99112233' });
    expect(mocks.dispatchSms).toHaveBeenCalledOnce();
  });

  it('SMS failed бол кодыг хадгалаад алдаа буцаана', async () => {
    mocks.customer.findUnique.mockResolvedValue(null);
    mocks.dispatchSms.mockResolvedValue({
      send: { accepted: false, status: 'failed', error: 'CallPro тохиргоо дутуу' },
      dispatch: { id: 'd1' },
    });
    await expect(issuePhoneOtp({ phone: '99112233' })).rejects.toMatchObject({
      status: 400,
    });
    expect(mocks.phoneOtp.create).toHaveBeenCalled();
    expect(mocks.customer.create).not.toHaveBeenCalled();
  });

  it('хүргэлт pending байхад зөв кодоор нэвтэрнэ', async () => {
    mocks.phoneOtp.findFirst.mockResolvedValue({
      id: 'otp-1',
      phone: '99112233',
      code: '123456',
      purpose: 'LOGIN',
      name: null,
      attempts: 0,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    mocks.customer.findUnique.mockResolvedValue(null);
    mocks.customer.create.mockResolvedValue({
      id: 'c-new',
      email: null,
      phone: '99112233',
      phoneVerifiedAt: new Date(),
      name: null,
    });
    const customer = await consumePhoneOtp('99112233', '123456');
    expect(customer.id).toBe('c-new');
    expect(mocks.customer.create).toHaveBeenCalledWith({
      data: {
        email: null,
        phone: '99112233',
        phoneVerifiedAt: expect.any(Date),
        name: null,
      },
    });
  });

  it('зөв код бүртгэлгүй дугаарт баталгаажсан хэрэглэгч үүсгэнэ', async () => {
    mocks.phoneOtp.findFirst.mockResolvedValue({
      id: 'otp-1',
      phone: '99112233',
      code: '123456',
      purpose: 'LOGIN',
      name: 'Бат',
      attempts: 0,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    mocks.customer.findUnique.mockResolvedValue(null);
    mocks.customer.create.mockResolvedValue({
      id: 'c-new',
      email: null,
      phone: '99112233',
      phoneVerifiedAt: new Date(),
      name: 'Бат',
    });
    const customer = await consumePhoneOtp('99112233', '123456');
    expect(customer.id).toBe('c-new');
    expect(mocks.customer.create).toHaveBeenCalledWith({
      data: {
        email: null,
        phone: '99112233',
        phoneVerifiedAt: expect.any(Date),
        name: 'Бат',
      },
    });
  });

  it('баталгаажаагүй эзэмшигчийг салган шинэ бүртгэл үүсгэнэ, хуучныг устгахгүй', async () => {
    mocks.phoneOtp.findFirst.mockResolvedValue({
      id: 'otp-1',
      phone: '99112233',
      code: '123456',
      purpose: 'LOGIN',
      name: 'Бат',
      attempts: 0,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const squatter = {
      id: 'squatter',
      email: 'attacker@example.com',
      passwordHash: 'hash',
      phone: '99112233',
      phoneVerifiedAt: null,
      name: 'Attacker',
    };
    mocks.customer.findUnique.mockResolvedValue(squatter);
    mocks.customer.update.mockResolvedValue({ ...squatter, phone: null });
    mocks.customer.create.mockResolvedValue({
      id: 'owner',
      email: null,
      phone: '99112233',
      phoneVerifiedAt: new Date(),
      name: 'Бат',
    });
    const customer = await consumePhoneOtp('99112233', '123456');
    expect(customer.id).toBe('owner');
    expect(mocks.customer.update).toHaveBeenCalledWith({
      where: { id: 'squatter' },
      data: { phone: null },
    });
    expect(mocks.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: null, phone: '99112233', name: 'Бат' }),
    });
  });

  it('баталгаажсан бүртгэл рүү нэвтэрнэ, шинэ мөр үүсгэхгүй', async () => {
    mocks.phoneOtp.findFirst.mockResolvedValue({
      id: 'otp-1',
      phone: '99112233',
      code: '123456',
      purpose: 'LOGIN',
      name: 'Бат',
      attempts: 0,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    mocks.customer.findUnique.mockResolvedValue({
      id: 'c1',
      phone: '99112233',
      phoneVerifiedAt: new Date(),
      name: 'Бат',
    });
    const customer = await consumePhoneOtp('99112233', '123456');
    expect(customer.id).toBe('c1');
    expect(mocks.customer.create).not.toHaveBeenCalled();
  });

  it('буруу код оролдлогыг нэмнэ', async () => {
    mocks.phoneOtp.findFirst.mockResolvedValue({
      id: 'otp-1',
      phone: '99112233',
      code: '123456',
      purpose: 'LOGIN',
      name: 'Бат',
      attempts: 0,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(consumePhoneOtp('99112233', '000000')).rejects.toMatchObject({
      status: 401,
    });
    expect(mocks.phoneOtp.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'otp-1', usedAt: null }),
      data: { attempts: { increment: 1 } },
    });
  });

  it('CHANGE_PHONE кодоор нэвтрүүлэхгүй', async () => {
    mocks.phoneOtp.findFirst.mockResolvedValue(null);
    await expect(consumePhoneOtp('99112233', '123456')).rejects.toMatchObject({
      status: 400,
    });
    expect(mocks.customer.create).not.toHaveBeenCalled();
  });

  it('дахин илгээхэд хуучин кодыг хүчингүй болгож шинэ код гаргана', async () => {
    mocks.customer.findUnique.mockResolvedValue({
      id: 'c1',
      phone: '99112233',
      phoneVerifiedAt: new Date(),
      name: 'Бат',
    });
    mocks.phoneOtp.findFirst.mockResolvedValue({
      id: 'otp-old',
      phone: '99112233',
      code: '111111',
      purpose: 'LOGIN',
      name: 'Бат',
      attempts: 0,
      usedAt: null,
      createdAt: new Date(Date.now() - 61_000),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await issuePhoneOtp({ phone: '99112233' });
    expect(mocks.dispatchSms).toHaveBeenCalledWith({
      channel: 'shop',
      purpose: 'otp_login',
      phone: '99112233',
      text: smsTemplates.otp('123456'),
      relatedType: 'phone_otp',
      relatedId: 'otp-1',
    });
    expect(mocks.phoneOtp.updateMany).toHaveBeenCalledWith({
      where: { usedAt: null, phone: '99112233', purpose: 'LOGIN' },
      data: { usedAt: expect.any(Date) },
    });
    expect(mocks.phoneOtp.create.mock.calls[0]![0].data.code).toBe('123456');
  });

  it('цагийн хязгаарыг DB count-оор шалгана', async () => {
    mocks.phoneOtp.count.mockResolvedValue(5);
    await expect(issuePhoneOtp({ phone: '99112233' })).rejects.toMatchObject({ status: 429 });
    expect(mocks.phoneOtp.create).not.toHaveBeenCalled();
  });

  it('зэрэг хүсэлт нэг хүчинтэй код, нэг SMS гаргана', async () => {
    let unused: { id: string; phone: string; code: string; purpose: string; usedAt: null; createdAt: Date; expiresAt: Date; name: string | null } | null = null;
    let gate = Promise.resolve();
    // concurrent in-memory store is not the default Mock client shape
    mocks.$transaction.mockImplementation((async (fn: (tx: unknown) => unknown) => {
      const run = gate.then(() =>
        fn({
          customer: mocks.customer,
          phoneOtp: {
            findFirst: async () => unused,
            findUnique: mocks.phoneOtp.findUnique,
            updateMany: mocks.phoneOtp.updateMany,
            count: mocks.phoneOtp.count,
            update: mocks.phoneOtp.update,
            create: async ({ data }: { data: Record<string, unknown> }) => {
              const created = {
                id: 'otp-1',
                phone: '99112233',
                code: '123456',
                purpose: 'LOGIN',
                usedAt: null,
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 300_000),
                name: null,
                ...data,
              } as NonNullable<typeof unused>;
              unused = created;
              return created;
            },
          },
          $executeRaw: mocks.$executeRaw,
        }),
      );
      gate = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    }) as never);
    const results = await Promise.all([
      issuePhoneOtp({ phone: '99112233' }),
      issuePhoneOtp({ phone: '99112233' }),
    ]);
    expect(mocks.dispatchSms).toHaveBeenCalledOnce();
    expect(results[0]!.phone).toBe('99112233');
    expect(results[1]!.phone).toBe('99112233');
  });

  it('IP хязгаарыг DB count-оор шалгана', async () => {
    mocks.phoneOtp.count.mockResolvedValueOnce(0).mockResolvedValueOnce(60);
    await expect(issuePhoneOtp({ phone: '99112233', ip: '1.1.1.1' })).rejects.toMatchObject({
      status: 429,
    });
  });
});

describe('SMS copy', () => {
  it('бараа ирсэн мессеж кирилл сегментэд багтана', () => {
    const text = smsTemplates.arrived('PH-ABC123');
    expect(text).toContain('бараа ирлээ');
    expect(text).not.toContain('http');
    expect([...text].length).toBeLessThanOrEqual(70);
  });

  it('OTP кирилл сегментэд багтана', () => {
    expect([...smsTemplates.otp('123456')].length).toBeLessThanOrEqual(70);
  });

  it('өнөөдөр төлөх сануулга нэр, дүн, огноо орно', () => {
    const text = smsTemplates.leasingDueToday('Бат', 50_000, '9-р сарын 12');
    expect(text).toContain('Бат');
    expect(text).toContain('50,000₮');
    expect(text).toContain('9-р сарын 12');
    expect(text).toContain('ИтгэлШоп');
  });

  it('хоцорсон сануулга хоног орно', () => {
    const text = smsTemplates.leasingOverdue('Бат', 50_000, 3);
    expect(text).toContain('3 хоногийн');
    expect(text).toContain('50,000₮');
  });

  it('ирсэн төлөөгүй сануулга нэр, үлдэгдэл орно', () => {
    const text = smsTemplates.leasingArrivedUnpaid('Бат', 80_000);
    expect(text).toContain('ИтгэлШоп');
    expect(text).toContain('Бат');
    expect(text).toContain('80,000₮-өө');
    expect(text).toContain('амжилттай ирлээ');
    expect(text).not.toContain('http');
  });
});
