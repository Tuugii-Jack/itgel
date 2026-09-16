import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  orderItem: { findMany: vi.fn() },
  customer: { findUnique: vi.fn() },
  order: { update: vi.fn() },
  dispatchSms: vi.fn(),
  hasOpenDispatch: vi.fn(),
}));

vi.mock('../src/prisma.js', () => ({
  prisma: {
    orderItem: mocks.orderItem,
    customer: mocks.customer,
    order: mocks.order,
  },
}));
vi.mock('../src/services/smsDispatch.js', () => ({
  dispatchSms: (...args: unknown[]) => mocks.dispatchSms(...args),
  hasOpenDispatch: (...args: unknown[]) => mocks.hasOpenDispatch(...args),
}));

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
    mocks.hasOpenDispatch.mockResolvedValue(false);
    mocks.dispatchSms.mockResolvedValue({
      send: { accepted: true, status: 'queued', id: 'm1' },
      dispatch: { id: 'd1' },
    });
    mocks.order.update.mockResolvedValue({});
  });

  it('илгээгдээгүй SMS-д arrivalNotifiedAt тавихгүй', async () => {
    mocks.dispatchSms.mockResolvedValue({
      send: { accepted: false, status: 'failed', error: 'CallPro тохиргоо дутуу' },
      dispatch: { id: 'd1' },
    });
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
    expect(mocks.dispatchSms).not.toHaveBeenCalled();
    expect(mocks.order.update).not.toHaveBeenCalled();
  });

  it('хүлээн авсан үед arrivalNotifiedAt тавина, delivered гэж үзэхгүй', async () => {
    const result = await notifyArrival(arrivedOrder as never);
    expect(result).toEqual({ ok: true, status: 'queued' });
    expect(mocks.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { arrivalNotifiedAt: expect.any(Date) },
    });
  });

  it('pending байхад давхар илгээхгүй', async () => {
    mocks.hasOpenDispatch.mockResolvedValue(true);
    const result = await notifyArrival(arrivedOrder as never);
    expect(result).toMatchObject({ ok: true, skipped: true });
    expect(mocks.dispatchSms).not.toHaveBeenCalled();
  });
});
