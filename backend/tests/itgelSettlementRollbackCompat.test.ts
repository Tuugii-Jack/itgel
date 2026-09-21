import { describe, expect, it } from 'vitest';

type Settlement = {
  id: string;
  status: string;
  remainingAmount: number;
  paidAmount: number;
  lockPaymentId: string | null;
};

type Payment = {
  id: string;
  status: string;
  amount: number;
};

/** HEAD confirm: төлбөрийг CONFIRMED болгоод өрийг зөвхөн remainingAmount === line.amount үед PAID хаадаг. */
function oldConfirm(settlement: Settlement, payment: Payment, lineAmount: number) {
  if (payment.status !== 'PENDING') return { settlement, payment, mismatch: false };
  payment.status = 'CONFIRMED';
  if (
    settlement.lockPaymentId === payment.id &&
    ['INVOICED', 'PENDING_BANK'].includes(settlement.status) &&
    settlement.remainingAmount === lineAmount
  ) {
    settlement.status = 'PAID';
    settlement.paidAmount += lineAmount;
    settlement.remainingAmount = 0;
    settlement.lockPaymentId = null;
    return { settlement, payment, mismatch: false };
  }
  return { settlement, payment, mismatch: true };
}

function newConfirm(settlement: Settlement, payment: Payment, lineAmount: number) {
  if (payment.status !== 'PENDING') return { settlement, payment, mismatch: false };
  payment.status = 'CONFIRMED';
  if (
    settlement.lockPaymentId === payment.id &&
    ['INVOICED', 'PENDING_BANK'].includes(settlement.status) &&
    settlement.remainingAmount >= lineAmount
  ) {
    settlement.paidAmount += lineAmount;
    settlement.remainingAmount -= lineAmount;
    settlement.status = settlement.remainingAmount === 0 ? 'PAID' : 'OPEN';
    settlement.lockPaymentId = null;
    return { settlement, payment, mismatch: false };
  }
  return { settlement, payment, mismatch: true };
}

describe('хуучин backend vs шинэ хэсэгчилсэн төлбөр', () => {
  it('хуучин confirm хэсэгчилсэн PENDING-ийг бүтэн хаадаггүй, гэхдээ төлбөрийг CONFIRMED болгоно', () => {
    const settlement: Settlement = {
      id: 's1',
      status: 'INVOICED',
      remainingAmount: 35_000,
      paidAmount: 0,
      lockPaymentId: 'p-partial',
    };
    const payment: Payment = { id: 'p-partial', status: 'PENDING', amount: 10_000 };
    const result = oldConfirm(settlement, payment, 10_000);
    expect(result.payment.status).toBe('CONFIRMED');
    expect(result.settlement.status).toBe('INVOICED');
    expect(result.settlement.remainingAmount).toBe(35_000);
    expect(result.settlement.paidAmount).toBe(0);
    expect(result.mismatch).toBe(true);
  });

  it('шинэ confirm хэсэгчилснийг OPEN үлдэгдэлтэй хаадаг', () => {
    const settlement: Settlement = {
      id: 's1',
      status: 'INVOICED',
      remainingAmount: 35_000,
      paidAmount: 0,
      lockPaymentId: 'p-partial',
    };
    const payment: Payment = { id: 'p-partial', status: 'PENDING', amount: 10_000 };
    const result = newConfirm(settlement, payment, 10_000);
    expect(result.payment.status).toBe('CONFIRMED');
    expect(result.settlement.status).toBe('OPEN');
    expect(result.settlement.remainingAmount).toBe(25_000);
    expect(result.settlement.paidAmount).toBe(10_000);
    expect(result.mismatch).toBe(false);
  });

  it('хуучин код үлдсэн өрийг дахин түгжиж бүтэн үлдэгдлээр хааж чадна', () => {
    const settlement: Settlement = {
      id: 's1',
      status: 'INVOICED',
      remainingAmount: 25_000,
      paidAmount: 10_000,
      lockPaymentId: 'p-rest',
    };
    const payment: Payment = { id: 'p-rest', status: 'PENDING', amount: 25_000 };
    const result = oldConfirm(settlement, payment, 25_000);
    expect(result.mismatch).toBe(false);
    expect(result.settlement.status).toBe('PAID');
    expect(result.settlement.remainingAmount).toBe(0);
  });

  it('PENDING-ийг цуцлах нь хоцорсон QPay-ийг арилгахгүй тул rollback биш', () => {
    const settlement: Settlement = {
      id: 's1',
      status: 'OPEN',
      remainingAmount: 35_000,
      paidAmount: 0,
      lockPaymentId: null,
    };
    const payment: Payment = { id: 'p-partial', status: 'SUPERSEDED', amount: 10_000 };
    const late = oldConfirm(settlement, payment, 10_000);
    expect(late.payment.status).toBe('SUPERSEDED');
    expect(late.settlement.remainingAmount).toBe(35_000);
    expect(late.settlement.paidAmount).toBe(0);
  });
});
