import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock('../src/prisma.js', () => ({ prisma: { order: { findFirst }, adminUser: { findUnique: vi.fn() } } }));

import { assertLeasingOrderAccess, resolveReadyTransferOwner } from '../src/modules/leasing/guards.js';
import { prisma } from '../src/prisma.js';

describe('Лизингийн захиалгын эзэн хамгаалалт', () => {
  beforeEach(() => {
    findFirst.mockReset();
    vi.mocked(prisma.adminUser.findUnique).mockReset();
  });

  it('өөр LEASING админы захиалгыг 404', async () => {
    findFirst.mockResolvedValue(null);
    await expect(
      assertLeasingOrderAccess('order-a', { sub: 'lease-b', role: 'LEASING' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('OWNER хандаж болно', async () => {
    findFirst.mockResolvedValue({ id: 'order-a', leasingOperatorAdminId: 'lease-a' });
    await expect(
      assertLeasingOrderAccess('order-a', { sub: 'owner-1', role: 'OWNER' }),
    ).resolves.toMatchObject({ id: 'order-a' });
  });

  it('ready-transfer эзнийг OWNER болгохгүй', async () => {
    findFirst.mockResolvedValue({
      leasingOperatorAdminId: 'lease-a',
      items: [{ round: { ownerKind: 'LEASING', ownerAdminId: 'lease-a' } }],
    });
    vi.mocked(prisma.adminUser.findUnique).mockResolvedValue({
      role: 'LEASING',
      isActive: true,
    } as never);
    await expect(resolveReadyTransferOwner('order-a')).resolves.toBe('lease-a');
  });

  it('OWNER id-г бэлэн барааны эзэн болгохгүй', async () => {
    findFirst.mockResolvedValue({
      leasingOperatorAdminId: 'owner-1',
      items: [{ round: { ownerKind: 'LEASING', ownerAdminId: 'owner-1' } }],
    });
    vi.mocked(prisma.adminUser.findUnique).mockResolvedValue({
      role: 'OWNER',
      isActive: true,
    } as never);
    await expect(resolveReadyTransferOwner('order-a')).rejects.toMatchObject({ status: 409 });
  });
});
