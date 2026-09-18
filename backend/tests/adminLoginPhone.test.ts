import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adminUser: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  adminLoginPhone: { findUnique: vi.fn(), create: vi.fn() },
  phoneOtp: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  issuePhoneOtp: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('../src/prisma.js', () => ({
  prisma: {
    adminUser: mocks.adminUser,
    adminLoginPhone: mocks.adminLoginPhone,
    phoneOtp: mocks.phoneOtp,
  },
}));
vi.mock('../src/lib/audit.js', () => ({ audit: mocks.audit }));
vi.mock('../src/services/phoneOtp.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/phoneOtp.js')>();
  return { ...actual, issuePhoneOtp: mocks.issuePhoneOtp };
});

import { issueAdminLoginPhoneOtp, verifyAdminLoginPhone } from '../src/services/adminLoginPhone.js';

const target = {
  id: 'staff-1',
  email: 'staff@itgel.mn',
  name: 'Staff',
  role: 'STAFF',
  phone: null,
  isActive: true,
  loginPhones: [],
};

describe('admin login phone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adminUser.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === target.id ? { ...target } : { ...target, id: where.id, loginPhones: [] },
    );
    mocks.adminUser.findFirst.mockResolvedValue(null);
    mocks.adminLoginPhone.findUnique.mockResolvedValue(null);
    mocks.adminLoginPhone.create.mockResolvedValue({ id: 'lp-1', phone: '88112233' });
    mocks.issuePhoneOtp.mockResolvedValue({ phone: '88112233', expiresInSec: 300, resendAfterSec: 60 });
    mocks.phoneOtp.findFirst.mockResolvedValue({
      id: 'otp-1',
      phone: '88112233',
      code: '123456',
      usedAt: null,
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });
    mocks.phoneOtp.updateMany.mockResolvedValue({ count: 1 });
    mocks.phoneOtp.findUnique.mockResolvedValue({ attempts: 1 });
    mocks.adminUser.update.mockResolvedValue({
      ...target,
      phone: '88112233',
      loginPhones: [{ phone: '88112233' }],
    });
  });

  it('STAFF өөр админы дугаар нэмэхгүй', async () => {
    await expect(
      issueAdminLoginPhoneOtp({
        targetAdminId: 'other',
        phone: '88112233',
        actorAdminId: 'staff-1',
        actorRole: 'STAFF',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('давхардсан дугаарыг холбохгүй', async () => {
    mocks.adminLoginPhone.findUnique.mockResolvedValue({ adminUserId: 'other' });
    await expect(
      issueAdminLoginPhoneOtp({
        targetAdminId: 'staff-1',
        phone: '88112233',
        actorAdminId: 'adm-1',
        actorRole: 'ADMIN',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('OTP баталгаажсны дараа дугаар нэмнэ, хуучныг солихгүй', async () => {
    const withPhone = { ...target, phone: '99000001', loginPhones: [{ phone: '99000001' }] };
    mocks.adminUser.findUnique.mockResolvedValue(withPhone);
    mocks.adminUser.update.mockResolvedValue({
      ...withPhone,
      loginPhones: [{ phone: '99000001' }, { phone: '88112233' }],
    });
    const updated = await verifyAdminLoginPhone({
      targetAdminId: 'staff-1',
      phone: '88112233',
      code: '123456',
      actorAdminId: 'adm-1',
      actorRole: 'ADMIN',
    });
    expect(mocks.adminLoginPhone.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ adminUserId: 'staff-1', phone: '88112233' }),
      }),
    );
    expect(mocks.adminUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {},
      }),
    );
    expect(updated.loginPhones?.map((row) => row.phone)).toEqual(['99000001', '88112233']);
  });

  it('дугаар нэмэхэд tokenVersion өсгөхгүй', async () => {
    await verifyAdminLoginPhone({
      targetAdminId: 'staff-1',
      phone: '88112233',
      code: '123456',
      actorAdminId: 'adm-1',
      actorRole: 'ADMIN',
    });
    expect(mocks.adminUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ tokenVersion: { increment: 1 } }),
      }),
    );
  });
});
