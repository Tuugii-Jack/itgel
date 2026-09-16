import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/lib/errors.js';

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock('../src/prisma.js', () => ({ prisma: { order: { findFirst } } }));

import { assertLeasingOrder } from '../src/modules/leasing/guards.js';

describe('Лизингийн захиалгын хамгаалалт', () => {
  beforeEach(() => {
    findFirst.mockReset();
  });

  it('дэлгүүрийн энгийн захиалгыг лизингийн API-д нээхгүй', async () => {
    findFirst.mockResolvedValue(null);
    await expect(assertLeasingOrder('shop-order')).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<AppError>);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'shop-order',
        OR: [
          { isLeasing: true, NOT: { status: 'NEW', paidAmount: 0 } },
          { payeeKind: 'LEASING', isLeasing: false },
        ],
      },
      select: { id: true },
    });
  });

  it('хуваарьт лизинг болон бэлэн борлуулалтыг зөвшөөрнө', async () => {
    findFirst.mockResolvedValue({ id: 'lease-1' });
    await expect(assertLeasingOrder('lease-1')).resolves.toEqual({ id: 'lease-1' });
  });
});
