import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/prisma.js';
import { seedAdmin, seedCatalog } from './helpers/seedAdmin.js';
import { startApp } from './helpers/httpApp.js';
import { confirmLeasingIfFeePaid, recordPayment, recordPaymentWithTotals } from '../src/services/payments.js';
import { lockOrder } from '../src/lib/orderLock.js';
import { addDays, addUbMonths, startOfUbMonth } from '../src/lib/date.js';
import { recordQpayRefund, rememberQpayInvoice } from '../src/services/qpay.js';
import { daySummary } from '../src/services/itgelSettlement.js';
import { leasingView } from '../src/lib/leasing.js';
import { recalcOrderTotals, shopDueAmount } from '../src/services/money.js';
import { syncOrderCargoFee } from '../src/services/cargoFee.js';
import { syncOrderStorageFee } from '../src/services/storageFee.js';
import { getSettings, invalidateSettingsCache } from '../src/services/settings.js';

const provider = vi.hoisted(() => ({ getPayment: vi.fn(), refund: vi.fn(), cancel: vi.fn() }));
vi.mock('../src/integrations/qpay/client.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/integrations/qpay/client.js')>(),
  getQpayPayment: provider.getPayment,
  refundQpayPayment: provider.refund,
  cancelQpayPayment: provider.cancel,
}));
let server: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => { server = await startApp(); });
afterAll(async () => { await server?.close(); });

async function seedMoneyOrder(isLeasing = false) {
  const catalog = await seedCatalog();
  await prisma.productRound.update({ where: { id: catalog.round.id }, data: { closeAt: new Date() } });
  const order = await prisma.order.create({
    data: { code: `FA-${randomUUID()}`, customerId: catalog.customer.id, status: 'CONFIRMED',
      subtotal: 100_000, dueAmount: isLeasing ? 118_000 : 100_000,
      isLeasing, payeeKind: isLeasing ? 'LEASING' : 'SHOP',
      leasingFee: isLeasing ? 10_000 : 0, cargoFee: isLeasing ? 8_000 : 0,
      items: { create: { roundId: catalog.round.id, productId: catalog.product.id,
        nameSnapshot: 'Finance audit', qty: 1, unitPrice: 100_000, costPriceSnapshot: 50_000 } } },
  });
  return { ...catalog, order };
}

describe('санхүүгийн аудит — бодит локал PostgreSQL', () => {
  it('төлбөртэй зэрэг дахин тооцоход кэш хуучин дүнгээр дарагдахгүй', async () => {
    const { order } = await seedMoneyOrder();
    let recalculation!: ReturnType<typeof recalcOrderTotals>;
    await prisma.$transaction(async (tx) => {
      await lockOrder(tx, order.id);
      recalculation = recalcOrderTotals(prisma, order.id);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await recordPaymentWithTotals(tx, { orderId: order.id, kind: 'PAYMENT', amount: 100_000, actor: 'audit' });
    });
    await recalculation;
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.paidAmount).toBe(100_000);
    expect(fresh.dueAmount).toBe(0);
  });

  it('цуцлалттай зэрэг карго бодоход цуцалсан мөрөөс өр дахин нэмэхгүй', async () => {
    const seed = await seedMoneyOrder();
    await prisma.productRound.update({ where: { id: seed.round.id }, data: { cargoFee: 8_000 } });
    let syncing!: ReturnType<typeof syncOrderCargoFee>;
    await prisma.$transaction(async (tx) => {
      await lockOrder(tx, seed.order.id);
      syncing = syncOrderCargoFee(prisma, seed.order.id);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await tx.orderItem.updateMany({ where: { orderId: seed.order.id }, data: { cancelledAt: new Date() } });
      await tx.order.update({ where: { id: seed.order.id }, data: { status: 'CANCELLED', cargoFee: 0 } });
      await recalcOrderTotals(tx, seed.order.id);
    });
    await syncing;
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: seed.order.id } });
    expect(fresh.cargoFee).toBe(0);
    expect(fresh.dueAmount).toBe(0);
  });

  it('хүргэлт сонгохтой зэрэг агуулах бодоход хуучин хураамж буцаж нэмэгдэхгүй', async () => {
    const settings = await getSettings();
    await prisma.setting.update({ where: { id: 1 }, data: { storageFreeDays: 0, storageFeePerDay: 1_000 } });
    invalidateSettingsCache();
    try {
      const seed = await seedMoneyOrder();
      await prisma.orderItem.updateMany({ where: { orderId: seed.order.id }, data: {
        arrivedQty: 1, arrivedAt: addDays(new Date(), -10), fulfilment: 'PICKUP',
      } });
      let syncing!: ReturnType<typeof syncOrderStorageFee>;
      await prisma.$transaction(async (tx) => {
        await lockOrder(tx, seed.order.id);
        syncing = syncOrderStorageFee(seed.order.id);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await tx.orderItem.updateMany({ where: { orderId: seed.order.id }, data: { fulfilment: 'DELIVERY' } });
        await tx.order.update({ where: { id: seed.order.id }, data: { fulfilment: 'DELIVERY', storageFee: 0 } });
        await recalcOrderTotals(tx, seed.order.id);
      });
      await syncing;
      const fresh = await prisma.order.findUniqueOrThrow({ where: { id: seed.order.id } });
      expect(fresh.storageFee).toBe(0);
      expect(fresh.dueAmount).toBe(100_000);
    } finally {
      await prisma.setting.update({ where: { id: 1 }, data: {
        storageFreeDays: settings.storageFreeDays, storageFeePerDay: settings.storageFeePerDay,
      } });
      invalidateSettingsCache();
    }
  });

  it('өөр захиалгын QPay төлбөрийг буцаах хүсэлт илгээхгүй', async () => {
    const admin = await seedAdmin('ADMIN');
    const a = await seedMoneyOrder();
    const b = await seedMoneyOrder();
    const invoiceId = `foreign-${randomUUID()}`;
    await rememberQpayInvoice(b.order.id, invoiceId, 'shop');
    await recordPayment({ orderId: b.order.id, kind: 'PAYMENT', amount: 100_000, actor: 'audit' });
    provider.getPayment.mockResolvedValue({ paymentId: 'foreign-payment', invoiceId, amount: 10_000 });
    provider.refund.mockClear();
    const response = await fetch(`${server.url}/api/admin/orders/${a.order.id}/qpay/payments/foreign-payment/refund`, {
      method: 'POST', headers: admin.headers,
    });
    expect(response.status).toBe(409);
    expect(provider.refund).not.toHaveBeenCalled();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: b.order.id } })).refundedAmount).toBe(0);
  });

  it('зэрэг ирсэн ижил QPay буцаалтыг нэг л удаа бичнэ', async () => {
    const { order } = await seedMoneyOrder();
    const invoiceId = `fa-${randomUUID()}`;
    await rememberQpayInvoice(order.id, invoiceId, 'shop');
    await recordPayment({ orderId: order.id, kind: 'PAYMENT', amount: 100_000, actor: 'audit' });
    const input = { invoiceId, paymentId: `p-${randomUUID()}`, amount: 40_000,
      actor: 'audit', note: 'QPay буцаалт' };
    let unlock!: () => void;
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => { locked = resolve; });
    const blocked = new Promise<void>((resolve) => { unlock = resolve; });
    const blocker = prisma.$transaction(async (tx) => {
      await lockOrder(tx, order.id);
      locked();
      await blocked;
    });
    await acquired;
    const requests = Promise.all([recordQpayRefund(input), recordQpayRefund(input)]);
    // Хоёр хүсэлт түгжээний өмнөх уншилтдаа зэрэг хүрэх боломж өгнө.
    await new Promise((resolve) => setTimeout(resolve, 100));
    unlock();
    await blocker;
    const results = await requests;
    expect(results.filter((result) => result.recorded)).toHaveLength(1);
    const refunds = await prisma.payment.findMany({ where: { orderId: order.id, kind: 'REFUND' } });
    expect(refunds).toHaveLength(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).refundedAmount).toBe(40_000);
  });

  it('хоёр сарын хэсэгчилсэн олголтыг нийт захиалгад нэг удаа тоолно', async () => {
    const admin = await seedAdmin('ADMIN');
    const seed = await seedMoneyOrder();
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: seed.order.id } });
    await prisma.orderItem.update({ where: { id: item.id }, data: {
      qty: 2, unitPrice: 50_000, arrivedQty: 2, handedOverQty: 2, handedOverAt: new Date(),
    } });
    const lastMonth = startOfUbMonth(addUbMonths(new Date(), -1));
    await prisma.auditLog.createMany({ data: [lastMonth, new Date()].map((createdAt) => ({
      actor: 'audit', action: 'HANDOVER_PARTIAL', entity: 'Order', entityId: seed.order.id,
      createdAt, after: { lines: [{ itemId: item.id, qty: 1 }] },
    })) });
    const response = await fetch(`${server.url}/api/admin/reports/revenue?period=3m&productIds=${seed.product.id}`, {
      headers: admin.headers,
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { totals: { orders: number; soldQty: number; sold: number } } };
    expect(body.data.totals.sold).toBe(100_000);
    expect(body.data.totals.soldQty).toBe(2);
    expect(body.data.totals.orders).toBe(1);
  });

  it('батлах шалгалтын дараа буцаалт орвол төлбөрийг түгжээ дотор дахин шалгана', async () => {
    const admin = await seedAdmin('ADMIN');
    const { order } = await seedMoneyOrder();
    await recordPayment({ orderId: order.id, kind: 'PAYMENT', amount: 100_000, actor: 'audit' });
    await prisma.order.update({ where: { id: order.id }, data: { status: 'NEW' } });
    let release!: () => void;
    let acquired!: () => void;
    let checked!: () => void;
    const lockReady = new Promise<void>((resolve) => { acquired = resolve; });
    const guardRead = new Promise<void>((resolve) => { checked = resolve; });
    const releaseLock = new Promise<void>((resolve) => { release = resolve; });
    const originalFindUnique = prisma.order.findUnique;
    const findUnique = originalFindUnique.bind(prisma.order);
    const spy = vi.spyOn(prisma.order, 'findUnique').mockImplementation((async (args: any) => {
      const result = await findUnique(args);
      if (args.where.id === order.id && args.select?.writtenOffAmount) checked();
      return result;
    }) as typeof prisma.order.findUnique);
    const blocker = prisma.$transaction(async (tx) => {
      await lockOrder(tx, order.id);
      acquired();
      await releaseLock;
      await recordPaymentWithTotals(tx, { orderId: order.id, kind: 'REFUND', amount: 100_000, actor: 'audit' });
    });
    let response: Response;
    try {
      await lockReady;
      const request = fetch(`${server.url}/api/admin/orders/${order.id}/status`, {
        method: 'PATCH', headers: admin.headers, body: JSON.stringify({ status: 'CONFIRMED' }),
      });
      await guardRead;
      release();
      await blocker;
      response = await request;
    } finally {
      release();
      spy.mockRestore();
      prisma.order.findUnique = originalFindUnique;
    }
    expect(response.status).toBe(409);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('NEW');
  });

  it('автомат лизингийн баталгаажуулалт зэрэг буцаасан шимтгэлийг дахин шалгана', async () => {
    const { order } = await seedMoneyOrder(true);
    await recordPayment({ orderId: order.id, kind: 'PAYMENT', amount: 10_000, payeeKind: 'LEASING', actor: 'audit' });
    await prisma.order.update({ where: { id: order.id }, data: { status: 'NEW' } });
    let release!: () => void;
    let acquired!: () => void;
    let checked!: () => void;
    const lockReady = new Promise<void>((resolve) => { acquired = resolve; });
    const guardRead = new Promise<void>((resolve) => { checked = resolve; });
    const releaseLock = new Promise<void>((resolve) => { release = resolve; });
    const originalFindFirst = prisma.order.findFirst;
    const findFirst = originalFindFirst.bind(prisma.order);
    const spy = vi.spyOn(prisma.order, 'findFirst').mockImplementation((async (args: any) => {
      const result = await findFirst(args);
      if (args.where.id === order.id && args.where.isLeasing === true) checked();
      return result;
    }) as typeof prisma.order.findFirst);
    const blocker = prisma.$transaction(async (tx) => {
      await lockOrder(tx, order.id);
      acquired();
      await releaseLock;
      await recordPaymentWithTotals(tx, { orderId: order.id, kind: 'REFUND', amount: 10_000,
        payeeKind: 'LEASING', actor: 'audit' });
    });
    try {
      await lockReady;
      const confirmation = confirmLeasingIfFeePaid(order.id, 'audit');
      // Rejection handler is attached before the blocking refund commits.
      const result = Promise.allSettled([confirmation]);
      await guardRead;
      release();
      await blocker;
      expect((await result)[0]?.status).toBe('rejected');
    } finally {
      release();
      spy.mockRestore();
      prisma.order.findFirst = originalFindFirst;
    }
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('NEW');
  });

  it('карго QPay буцаахад лизингийн шимтгэлийг буцаасан мэт бодохгүй', async () => {
    const { order } = await seedMoneyOrder(true);
    const invoiceId = `cargo-${randomUUID()}`;
    await rememberQpayInvoice(order.id, invoiceId, 'shop', prisma, { purpose: 'CARGO', amount: 8_000 });
    await recordPayment({ orderId: order.id, kind: 'PAYMENT', amount: 10_000, payeeKind: 'LEASING', actor: 'audit' });
    await recordPayment({ orderId: order.id, kind: 'PAYMENT', amount: 8_000, payeeKind: 'SHOP', actor: 'audit' });
    const refund = await recordQpayRefund({ invoiceId, paymentId: `p-${randomUUID()}`, amount: 8_000,
      actor: 'audit', note: 'Карго буцаалт' });
    expect(refund.recorded).toBe(true);
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.shopPaidAmount).toBe(0);
    expect(leasingView(fresh).feePaid).toBe(true);
    expect(leasingView(fresh).principalDue).toBe(100_000);
    expect(shopDueAmount(fresh)).toBe(8_000);
  });

  it('өдрийн нэгтгэл 2.147 тэрбум төгрөгөөс их дүнг бүрэн харуулна', async () => {
    const ownerAdminId = `audit-owner-${randomUUID()}`;
    for (let i = 0; i < 2; i++) {
      const seed = await seedMoneyOrder();
      const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: seed.order.id } });
      await prisma.itgelSettlement.create({ data: {
        sourceOrderItemId: item.id, sourceOrderId: seed.order.id, sourceOrderCode: seed.order.code,
        customerId: seed.customer.id, ownerAdminId, productId: seed.product.id, roundId: seed.round.id,
        productName: 'Large aggregate', qty: 1, unitPrice: 1_500_000_000,
        amount: 1_500_000_000, remainingAmount: 1_500_000_000, confirmedAt: new Date(),
      } });
      await prisma.itgelSettlementPayment.create({ data: {
        ownerAdminId, method: 'BANK_TRANSFER', amount: 1_500_000_000,
        status: 'CONFIRMED', confirmedAt: new Date(), claimedBy: 'audit',
      } });
    }
    const summary = await daySummary({ ownerAdminId, day: new Date() });
    expect(summary.totalUnpaidRemaining).toBe(3_000_000_000);
    expect(summary.createdOnDayAmount).toBe(3_000_000_000);
    expect(summary.paidOnDayAmount).toBe(3_000_000_000);
  });
});
