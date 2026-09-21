import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  changeOrderStatus: vi.fn(),
  createItgelSettlementsForOrder: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock('../src/prisma.js', () => ({
  prisma: {
    order: { findFirst: mocks.findFirst },
  },
}));
vi.mock('../src/services/orders.js', () => ({
  changeOrderStatus: (...args: unknown[]) => mocks.changeOrderStatus(...args),
}));
vi.mock('../src/services/itgelSettlement.js', () => ({
  createItgelSettlementsForOrder: (...args: unknown[]) => mocks.createItgelSettlementsForOrder(...args),
}));

import { confirmLeasingIfFeePaid } from '../src/services/payments.js';

describe('confirmLeasingIfFeePaid retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue({
      id: 'o1',
      status: 'NEW',
      subtotal: 100_000,
      leasingFee: 10_000,
      paidAmount: 10_000,
      refundedAmount: 0,
      storageFee: 0,
      cargoFee: 0,
      shopPaidAmount: 0,
      isLeasing: true,
      deletedAt: null,
      debtClosedAt: null,
    });
    mocks.createItgelSettlementsForOrder.mockResolvedValue(1);
  });

  it('батлах алдааг залгиад NEW дээр өр үүсгэхгүй', async () => {
    mocks.changeOrderStatus.mockRejectedValueOnce(new Error('status locked'));
    await expect(confirmLeasingIfFeePaid('o1', 'system:qpay')).rejects.toThrow('status locked');
    expect(mocks.createItgelSettlementsForOrder).not.toHaveBeenCalled();
  });

  it('батлагдсаны дараа retry тооцоо нөхнө, дахин батлахгүй', async () => {
    mocks.findFirst
      .mockResolvedValueOnce({
        id: 'o1',
        status: 'CONFIRMED',
        subtotal: 100_000,
        leasingFee: 10_000,
        paidAmount: 10_000,
        refundedAmount: 0,
        storageFee: 0,
        cargoFee: 0,
        shopPaidAmount: 0,
        isLeasing: true,
        deletedAt: null,
        debtClosedAt: null,
      })
      .mockResolvedValueOnce({ id: 'o1', status: 'CONFIRMED' });
    await confirmLeasingIfFeePaid('o1', 'system:qpay');
    expect(mocks.changeOrderStatus).not.toHaveBeenCalled();
    expect(mocks.createItgelSettlementsForOrder).toHaveBeenCalledWith('o1');
  });
});
