import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  orderItem: { findMany: vi.fn() },
  customer: { findUnique: vi.fn() },
  order: { update: vi.fn() },
  smsSend: vi.fn(),
}));

vi.mock('../src/prisma.js', () => ({
  prisma: {
    orderItem: mocks.orderItem,
    customer: mocks.customer,
    order: mocks.order,
  },
}));
vi.mock('../src/services/sms.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/sms.js')>();
  return { ...actual, shopSms: { name: 'mock', send: mocks.smsSend } };
});

import { notifyArrival } from '../src/services/orders.js';

const arrivedOrder = {
  id: 'order-1',
  code: 'PH-ABC123',
  customerId: 'cust-1',
  status: 'ARRIVED' as const,
  deletedAt: null,
  arrivalNotifiedAt: null,
  items: [
    {
      cancelledAt: null,
      arrivedAt: new Date(),
      arrivedQty: 1,
      qty: 1,
      handedOverAt: null,
    },
  ],
};

describe('notifyArrival', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.customer.findUnique.mockResolvedValue({ id: 'cust-1', phone: '99112233' });
    mocks.smsSend.mockResolvedValue({ ok: true, id: 'm1' });
    mocks.order.update.mockResolvedValue({});
  });

  it('илгээгдээгүй SMS-д arrivalNotifiedAt тавихгүй', async () => {
    mocks.smsSend.mockResolvedValue({ ok: false, error: 'CallPro тохиргоо дутуу' });
    const result = await notifyArrival(arrivedOrder as never);
    expect(result).toMatchObject({ ok: false, error: 'CallPro тохиргоо дутуу' });
    expect(mocks.order.update).not.toHaveBeenCalled();
  });

  it('ирээгүй бараанд SMS илгээхгүй', async () => {
    const result = await notifyArrival({
      ...arrivedOrder,
      items: [
        {
          cancelledAt: null,
          arrivedAt: null,
          arrivedQty: 0,
          qty: 1,
          handedOverAt: null,
        },
      ],
    } as never);
    expect(result.ok).toBe(false);
    expect(mocks.smsSend).not.toHaveBeenCalled();
    expect(mocks.order.update).not.toHaveBeenCalled();
  });

  it('амжилттай илгээсэн үед arrivalNotifiedAt тавина', async () => {
    const result = await notifyArrival(arrivedOrder as never);
    expect(result).toEqual({ ok: true });
    expect(mocks.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { arrivalNotifiedAt: expect.any(Date) },
    });
  });
});
