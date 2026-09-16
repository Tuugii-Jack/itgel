import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  customer: { findUnique: vi.fn(), update: vi.fn() },
  phoneOtp: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
  smsSend: vi.fn(),
  dispatchSms: vi.fn(),
}));

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
  return { ...actual, generateOtp: () => '654321' };
});

import { issuePhoneChange, verifyPhoneChange } from '../src/services/phoneChange.js';

const live = {
  id: 'cust-1',
  email: 'me@example.com',
  phone: '99112233',
  phoneVerifiedAt: new Date('2026-01-01'),
  name: 'Me',
  passwordHash: null,
};

describe('нэвтрэх утас солих', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dispatchSms.mockResolvedValue({
      send: { accepted: true, status: 'queued', id: 'm1' },
      dispatch: { id: 'd1' },
    });
    mocks.$executeRaw.mockResolvedValue(undefined);
    mocks.$transaction.mockImplementation(async (fn: (tx: typeof mocks) => unknown) => fn(mocks));
    mocks.phoneOtp.findFirst.mockResolvedValue(null);
    mocks.phoneOtp.updateMany.mockResolvedValue({ count: 1 });
    mocks.phoneOtp.create.mockImplementation(async ({ data }) => ({
      id: 'otp-change',
      createdAt: new Date(),
      usedAt: null,
      attempts: 0,
      ...data,
    }));
    mocks.customer.findUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) => {
      if (where.id === live.id) return { ...live };
      if (where.phone === live.phone) return { ...live };
      return null;
    });
    mocks.customer.update.mockImplementation(async ({ data }) => ({ ...live, ...data }));
  });

  it('OTP илгээхэд хуучин дугаар хэвээр үлдэнэ', async () => {
    const result = await issuePhoneChange(live as never, '88112233');
    expect(result.phone).toBe('88112233');
    expect(mocks.customer.update).not.toHaveBeenCalled();
    expect(mocks.dispatchSms).toHaveBeenCalledOnce();
    expect(mocks.phoneOtp.create.mock.calls[0]![0].data).toMatchObject({
      phone: '88112233',
      purpose: 'CHANGE_PHONE',
      customerId: 'cust-1',
      previousPhone: '99112233',
    });
  });

  it('баталгаажсан эзэмшигчийн дугаар руу солихыг татна', async () => {
    mocks.customer.findUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) => {
      if (where.phone === '88112233') {
        return {
          id: 'other',
          phone: '88112233',
          phoneVerifiedAt: new Date(),
        };
      }
      return { ...live };
    });
    await expect(issuePhoneChange(live as never, '88112233')).rejects.toMatchObject({ status: 409 });
    expect(mocks.smsSend).not.toHaveBeenCalled();
  });

  it('OTP амжилттай болсны дараа л дугаар солигдоно', async () => {
    mocks.phoneOtp.findFirst.mockResolvedValue({
      id: 'otp-change',
      phone: '88112233',
      code: '654321',
      purpose: 'CHANGE_PHONE',
      customerId: 'cust-1',
      previousPhone: '99112233',
      usedAt: null,
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const updated = await verifyPhoneChange(live as never, '88112233', '654321');
    expect(updated.phone).toBe('88112233');
    expect(updated.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(mocks.phoneOtp.updateMany).toHaveBeenCalled();
  });
});
