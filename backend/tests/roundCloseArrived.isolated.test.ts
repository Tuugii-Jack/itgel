import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/prisma.js';
import { seedCatalog } from './helpers/seedAdmin.js';
import { cancelUnpaidOrdersForRound } from '../src/modules/orders/lifecycle.js';
import { closeExpiredProducts } from '../src/cron/index.js';
import { invalidateSettingsCache } from '../src/services/settings.js';
import { recalcOrderTotals } from '../src/services/money.js';

const pastClose = new Date('2026-09-01T04:00:00.000Z');

afterEach(() => {
  invalidateSettingsCache();
});

async function seedRoundOrder(opts: {
  status: 'NEW' | 'ARRIVED';
  paidAmount: number;
  leasingFee?: number;
  arrivedQty: number;
  handedOverQty: number;
  withPayment?: boolean;
}) {
  const catalog = await seedCatalog();
  await prisma.productRound.update({
    where: { id: catalog.round.id },
    data: { closeAt: pastClose, status: 'ACTIVE' },
  });
  const subtotal = 40_000;
  const leasingFee = opts.leasingFee ?? 0;
  const order = await prisma.order.create({
    data: {
      code: `RC-${catalog.t.slice(0, 6).toUpperCase()}`,
      customerId: catalog.customer.id,
      status: opts.status,
      subtotal,
      leasingFee,
      paidAmount: opts.paidAmount,
      dueAmount: Math.max(0, subtotal + leasingFee - opts.paidAmount),
      isLeasing: leasingFee > 0,
      arrivedAt: opts.status === 'ARRIVED' ? new Date() : null,
    },
  });
  const item = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      roundId: catalog.round.id,
      productId: catalog.product.id,
      nameSnapshot: catalog.product.name,
      qty: 2,
      unitPrice: 20_000,
      costPriceSnapshot: 10_000,
      arrivedQty: opts.arrivedQty,
      arrivedAt: opts.arrivedQty >= 2 ? new Date() : null,
      handedOverQty: opts.handedOverQty,
      handedOverAt: opts.handedOverQty > 0 ? new Date() : null,
    },
  });
  if (opts.withPayment && opts.paidAmount > 0) {
    await prisma.payment.create({
      data: {
        orderId: order.id,
        kind: 'PAYMENT',
        amount: opts.paidAmount,
        method: 'BANK_TRANSFER',
        actor: 'seed',
        payeeKind: leasingFee > 0 ? 'LEASING' : 'SHOP',
      },
    });
  }
  await recalcOrderTotals(prisma, order.id);
  return { catalog, order, item };
}

async function snapshot(orderId: string) {
  return prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      status: true,
      deletedAt: true,
      paidAmount: true,
      payments: { select: { id: true, amount: true } },
      items: { select: { arrivedQty: true, handedOverQty: true, cancelledAt: true, stockHold: true } },
    },
  });
}

describe('тойрог хаагдахад ARRIVED захиалга үлдэх', () => {
  it('өнгөрсөн closeAt + autoClose: ирсэн хэсэгчилсэн төлбөртэйг soft-delete хийхгүй', async () => {
    const { catalog, order } = await seedRoundOrder({
      status: 'ARRIVED',
      paidAmount: 30_000,
      arrivedQty: 2,
      handedOverQty: 0,
      withPayment: true,
    });
    await prisma.setting.upsert({
      where: { id: 1 },
      update: { autoCloseOnDeadline: true },
      create: { id: 1, autoCloseOnDeadline: true, deliveryFees: {} },
    });
    invalidateSettingsCache();

    const closed = await closeExpiredProducts(new Date('2026-09-27T04:00:00.000Z'));
    expect(closed).toBeGreaterThanOrEqual(1);

    const round = await prisma.productRound.findUniqueOrThrow({ where: { id: catalog.round.id } });
    expect(round.status).toBe('CLOSED');

    const after = await snapshot(order.id);
    expect(after.status).toBe('ARRIVED');
    expect(after.deletedAt).toBeNull();
    expect(after.paidAmount).toBe(30_000);
    expect(after.payments).toHaveLength(1);
    expect(after.items[0]?.cancelledAt).toBeNull();
    expect(after.items[0]?.arrivedQty).toBe(2);
  });

  it('хэсэгчилсэн олголттой ARRIVED үлдэнэ, төлбөр/ширхэг хэвээр', async () => {
    const { catalog, order } = await seedRoundOrder({
      status: 'ARRIVED',
      paidAmount: 20_000,
      arrivedQty: 2,
      handedOverQty: 1,
      withPayment: true,
    });
    const n = await cancelUnpaidOrdersForRound(catalog.round.id, 'system');
    expect(n).toBe(0);
    const after = await snapshot(order.id);
    expect(after.status).toBe('ARRIVED');
    expect(after.deletedAt).toBeNull();
    expect(after.items[0]?.handedOverQty).toBe(1);
    expect(after.payments).toHaveLength(1);
  });

  it('баталгаажаагүй хэсэгчилсэн төлбөртэй NEW үлдэнэ', async () => {
    const { catalog, order } = await seedRoundOrder({
      status: 'NEW',
      paidAmount: 10_000,
      arrivedQty: 0,
      handedOverQty: 0,
      withPayment: true,
    });
    const n = await cancelUnpaidOrdersForRound(catalog.round.id, 'system');
    expect(n).toBe(0);
    const after = await snapshot(order.id);
    expect(after.status).toBe('NEW');
    expect(after.deletedAt).toBeNull();
    expect(after.payments).toHaveLength(1);
  });

  it('лизингийн шимтгэл төлсөн захиалга үлдэнэ', async () => {
    const { catalog, order } = await seedRoundOrder({
      status: 'NEW',
      paidAmount: 10_000,
      leasingFee: 10_000,
      arrivedQty: 0,
      handedOverQty: 0,
      withPayment: true,
    });
    const n = await cancelUnpaidOrdersForRound(catalog.round.id, 'system');
    expect(n).toBe(0);
    const after = await snapshot(order.id);
    expect(after.status).toBe('NEW');
    expect(after.deletedAt).toBeNull();
    expect(after.paidAmount).toBe(10_000);
    expect(after.payments).toHaveLength(1);
  });

  it('үнэхээр төлөөгүй баталгаажаагүй NEW-г цуцалж soft-delete хийнэ', async () => {
    const { catalog, order } = await seedRoundOrder({
      status: 'NEW',
      paidAmount: 0,
      arrivedQty: 0,
      handedOverQty: 0,
    });
    const n = await cancelUnpaidOrdersForRound(catalog.round.id, 'system');
    expect(n).toBe(1);
    const after = await snapshot(order.id);
    expect(after.status).toBe('CANCELLED');
    expect(after.deletedAt).not.toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: order.id, action: 'SOFT_DELETE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
    const statusLog = await prisma.auditLog.findFirst({
      where: { entityId: order.id, action: 'STATUS_CHANGE' },
      orderBy: { createdAt: 'desc' },
    });
    expect((statusLog?.after as { status?: string } | null)?.status).toBe('CANCELLED');
    expect(after.payments).toHaveLength(0);
  });
});
