import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adminUser: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  audit: vi.fn(),
  signAdminToken: vi.fn(() => 'admin-token'),
}));

vi.mock('../src/prisma.js', () => ({ prisma: { adminUser: mocks.adminUser } }));
vi.mock('../src/lib/audit.js', () => ({ audit: mocks.audit }));
vi.mock('../src/lib/jwt.js', () => ({
  signAdminToken: mocks.signAdminToken,
}));

import {
  auditAdminPhones,
  openWorkspaceSession,
  peekWorkspace,
  revokeWorkspaceSessions,
} from '../src/services/workspaceAuth.js';

const admin = {
  id: 'adm-1',
  email: 'admin@itgel.mn',
  name: 'Админ',
  role: 'ADMIN' as const,
  tokenVersion: 4,
};

describe('workspaceAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adminUser.findFirst.mockResolvedValue(admin);
    mocks.adminUser.update.mockResolvedValue({ ...admin, tokenVersion: 5 });
  });

  it('OTP-ийн дараа идэвхтэй баталгаажсан дугаарт л session өгнө', async () => {
    const session = await openWorkspaceSession('99000001');
    expect(session?.user.role).toBe('ADMIN');
    expect(session?.token).toBe('admin-token');
    expect(mocks.signAdminToken).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'adm-1', role: 'ADMIN', tv: 5 }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'AUTH_WORKSPACE_LOGIN' }));
  });

  it('идэвхгүй/баталгаажаагүй дугаарт privileged session өгөхгүй', async () => {
    mocks.adminUser.findFirst.mockResolvedValue(null);
    await expect(openWorkspaceSession('99000001')).resolves.toBeNull();
    expect(mocks.adminUser.update).not.toHaveBeenCalled();
  });

  it('peekWorkspace шинэ token олгохгүй', async () => {
    const peeked = await peekWorkspace('99000001');
    expect(peeked).toEqual({
      id: 'adm-1',
      email: 'admin@itgel.mn',
      name: 'Админ',
      role: 'ADMIN',
    });
    expect(mocks.signAdminToken).not.toHaveBeenCalled();
  });

  it('хуучин session-ийг tokenVersion-оор хүчингүй болгоно', async () => {
    await revokeWorkspaceSessions('adm-1', 'admin:adm-1');
    expect(mocks.adminUser.update).toHaveBeenCalledWith({
      where: { id: 'adm-1' },
      data: { tokenVersion: { increment: 1 } },
    });
  });

  it('дугаар тааж оноолгүй дутуу/давхардлыг тоолно', () => {
    const report = auditAdminPhones([
      { id: 'a', phone: null, phoneVerifiedAt: null, isActive: true },
      { id: 'b', phone: '99000001', phoneVerifiedAt: new Date(), isActive: true },
      { id: 'c', phone: '99000001', phoneVerifiedAt: new Date(), isActive: false },
    ]);
    expect(report).toMatchObject({
      total: 3,
      missing: 1,
      linked: 2,
      duplicatePhoneCount: 1,
    });
  });
});
