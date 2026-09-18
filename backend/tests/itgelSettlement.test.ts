import { describe, expect, it } from 'vitest';
import { serializeSettlement, settlementStatusLabel } from '../src/services/itgelSettlement.js';
import { pickSettlementOwnerId, resolveAutoSettlementOwner } from '../src/lib/settlementOwner.js';

describe('Итгэлд төлөх тооцоо', () => {
  it('төлөвийн шошгыг хэрэглэгчийн төлбөрөөс тусад нь гаргана', () => {
    expect(settlementStatusLabel('OPEN')).toBe('Итгэлд төлөөгүй');
    expect(settlementStatusLabel('PAID')).toBe('Итгэлд төлсөн');
    expect(settlementStatusLabel('PENDING_BANK')).toBe('Баталгаажуулалт хүлээж байна');
    expect(settlementStatusLabel('INVOICED')).toBe('QPay хүлээгдэж байна');
  });

  it('snapshot дүнг хадгална', () => {
    const row = serializeSettlement({
      id: 's1',
      ownerAdminId: 'adm',
      sourceOrderId: 'o1',
      sourceOrderCode: 'PH-1',
      customerId: 'c1',
      customerName: 'Бат',
      productName: 'Цамц',
      qty: 2,
      unitPrice: 40_000,
      amount: 80_000,
      confirmedAt: new Date('2026-09-18T04:00:00.000Z'),
      status: 'OPEN',
      paidAmount: 0,
      remainingAmount: 80_000,
      readyTransferId: null,
      lockPaymentId: null,
    });
    expect(row.amount).toBe(80_000);
    expect(row.qty).toBe(2);
    expect(row.orderCode).toBe('PH-1');
    expect(row.statusLabel).toBe('Итгэлд төлөөгүй');
  });

  it('эзнийг snapshot-оор авч, эхний идэвхтэй админ руу буцахгүй', () => {
    expect(pickSettlementOwnerId('snap-a', 'cfg-b')).toBe('snap-a');
    expect(pickSettlementOwnerId(null, 'cfg-b')).toBe('cfg-b');
    expect(pickSettlementOwnerId('', 'cfg-b')).toBe('cfg-b');
    expect(pickSettlementOwnerId(null, null)).toBe(null);
    expect(pickSettlementOwnerId(undefined, undefined)).toBe(null);
  });

  it('OWNER_MISSING бүртгэгдсэн бол одоогийн тохиргоог автоматаар авахгүй', () => {
    expect(
      resolveAutoSettlementOwner({
        snapshot: null,
        configuredActiveId: 'cfg-new',
        hasOpenOwnerMissing: true,
      }),
    ).toBe(null);
    expect(
      resolveAutoSettlementOwner({
        snapshot: 'snap-old',
        configuredActiveId: 'cfg-new',
        hasOpenOwnerMissing: true,
      }),
    ).toBe('snap-old');
    expect(
      resolveAutoSettlementOwner({
        snapshot: null,
        configuredActiveId: 'cfg-new',
        hasOpenOwnerMissing: false,
      }),
    ).toBe('cfg-new');
  });
});
