import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/prisma.js';
import { startApp } from './helpers/httpApp.js';
import { seedAdmin, seedCatalog } from './helpers/seedAdmin.js';
import { addDays, startOfUbMonth } from '../src/lib/date.js';
import { loadHandoverSales } from '../src/lib/handoverEvents.js';
import { recalcOrderTotals } from '../src/services/money.js';
import { dispatchSms } from '../src/services/smsDispatch.js';

let server: { url: string; close: () => Promise<void> };

beforeAll(async () => {
  server = await startApp();
});

afterAll(async () => {
  await server?.close();
});

async function seedArrived(opts: {
  paidAmount: number;
  fulfilment?: 'PICKUP' | 'DELIVERY';
  items: { qty: number; arrivedQty: number; unitPrice?: number }[];
}) {
  const catalog = await seedCatalog();
  await prisma.productRound.update({
    where: { id: catalog.round.id },
    data: { closeAt: new Date() },
  });
  const subtotal = opts.items.reduce((sum, item) => sum + (item.unitPrice ?? 20_000) * item.qty, 0);
  const order = await prisma.order.create({
    data: {
      code: `PH-${catalog.t.slice(0, 6).toUpperCase()}`,
      customerId: catalog.customer.id,
      status: 'ARRIVED',
      subtotal,
      paidAmount: opts.paidAmount,
      dueAmount: Math.max(0, subtotal - opts.paidAmount),
      fulfilment: opts.fulfilment ?? 'PICKUP',
      arrivedAt: new Date(),
    },
  });
  const items = [];
  for (const row of opts.items) {
    items.push(
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          roundId: catalog.round.id,
          productId: catalog.product.id,
          nameSnapshot: catalog.product.name,
          qty: row.qty,
          unitPrice: row.unitPrice ?? 20_000,
          costPriceSnapshot: 10_000,
          arrivedQty: row.arrivedQty,
          arrivedAt: new Date(),
          handedOverQty: 0,
          fulfilment: opts.fulfilment ?? 'PICKUP',
        },
      }),
    );
  }
  if (opts.paidAmount > 0) {
    await prisma.payment.create({
      data: {
        orderId: order.id,
        kind: 'PAYMENT',
        amount: opts.paidAmount,
        method: 'BANK_TRANSFER',
        actor: 'seed',
      },
    });
  }
  await recalcOrderTotals(prisma, order.id);
  const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  return { ...catalog, order: fresh, items };
}

describe('HTTP gaps — delivery / status / SMS / history', () => {
  it('delivery зэрэг баталгаа нэг олголт, нэг Payment', async () => {
    const admin = await seedAdmin('ADMIN');
    const seed = await seedArrived({
      paidAmount: 30_000,
      fulfilment: 'DELIVERY',
      items: [{ qty: 1, arrivedQty: 1, unitPrice: 40_000 }],
    });
    const delivery = await prisma.delivery.create({
      data: {
        orderId: seed.order.id,
        scheduledDay: new Date(),
        district: 'СБД',
        status: 'ASSIGNED',
      },
    });
    const body = JSON.stringify({ status: 'DELIVERED', courierName: 'Бат' });
    const [a, b] = await Promise.all([
      fetch(`${server.url}/api/admin/deliveries/${delivery.id}`, {
        method: 'PATCH',
        headers: admin.headers,
        body,
      }),
      fetch(`${server.url}/api/admin/deliveries/${delivery.id}`, {
        method: 'PATCH',
        headers: admin.headers,
        body,
      }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 200]);
    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: seed.items[0]!.id } });
    expect(item.handedOverQty).toBe(1);
    const pays = await prisma.payment.findMany({
      where: { orderId: seed.order.id, payeeKind: 'SHOP' },
    });
    expect(pays).toHaveLength(1);
    expect(pays[0]?.amount).toBe(10_000);
  });

  it('delivery төлбөр алдаа гарвал олголт хагас үлдэхгүй', async () => {
    const admin = await seedAdmin('ADMIN');
    const seed = await seedArrived({
      paidAmount: 30_000,
      fulfilment: 'DELIVERY',
      items: [{ qty: 1, arrivedQty: 1, unitPrice: 40_000 }],
    });
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION itgel_test_reject_delivery_pay() RETURNS trigger AS $$
      BEGIN
        IF NEW.note LIKE 'Хүргэлтээр авсан%' AND NEW."orderId" = '${seed.order.id}' THEN
          RAISE EXCEPTION 'test delivery payment fail';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS itgel_test_reject_delivery_pay ON "Payment"`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER itgel_test_reject_delivery_pay
      BEFORE INSERT ON "Payment"
      FOR EACH ROW EXECUTE FUNCTION itgel_test_reject_delivery_pay()
    `);
    const delivery = await prisma.delivery.create({
      data: {
        orderId: seed.order.id,
        scheduledDay: new Date(),
        district: 'СБД',
        status: 'ASSIGNED',
      },
    });
    const res = await fetch(`${server.url}/api/admin/deliveries/${delivery.id}`, {
      method: 'PATCH',
      headers: admin.headers,
      body: JSON.stringify({ status: 'DELIVERED' }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: seed.items[0]!.id } });
    expect(item.handedOverQty).toBe(0);
    const deliveryRow = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(deliveryRow.status).toBe('ASSIGNED');
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS itgel_test_reject_delivery_pay ON "Payment"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS itgel_test_reject_delivery_pay()`);
  });

  it('PATCH /status болон /status/revert олгосон тоог устгахгүй', async () => {
    const admin = await seedAdmin('ADMIN');
    const seed = await seedArrived({
      paidAmount: 40_000,
      items: [{ qty: 5, arrivedQty: 5 }],
    });
    await prisma.orderItem.update({
      where: { id: seed.items[0]!.id },
      data: { handedOverQty: 2, handedOverAt: new Date() },
    });
    const handed = await fetch(`${server.url}/api/admin/orders/${seed.order.id}/status`, {
      method: 'PATCH',
      headers: admin.headers,
      body: JSON.stringify({ status: 'HANDED_OVER', reason: 'шууд' }),
    });
    expect(handed.status).toBe(409);
    const afterHand = await prisma.orderItem.findUniqueOrThrow({ where: { id: seed.items[0]!.id } });
    expect(afterHand.handedOverQty).toBe(2);

    await prisma.order.update({
      where: { id: seed.order.id },
      data: { status: 'HANDED_OVER', handedOverAt: new Date() },
    });
    await prisma.orderItem.update({
      where: { id: seed.items[0]!.id },
      data: { handedOverQty: 5 },
    });
    const revert = await fetch(`${server.url}/api/admin/orders/${seed.order.id}/status/revert`, {
      method: 'POST',
      headers: admin.headers,
      body: JSON.stringify({ reason: 'тест' }),
    });
    expect(revert.status).toBe(409);
    const afterRevert = await prisma.orderItem.findUniqueOrThrow({ where: { id: seed.items[0]!.id } });
    expect(afterRevert.handedOverQty).toBe(5);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: seed.order.id } });
    expect(order.status).toBe('HANDED_OVER');
  });

  it('хуучин бүрэн + шинэ хэсэгчилсэн холилдоход тоо давхардахгүй', async () => {
    const catalog = await seedCatalog();
    const day1 = addDays(new Date(), -3);
    const customer = catalog.customer;
    const full = await prisma.order.create({
      data: {
        code: `FL-${catalog.t.slice(0, 6).toUpperCase()}`,
        customerId: customer.id,
        status: 'HANDED_OVER',
        subtotal: 100_000,
        paidAmount: 100_000,
        dueAmount: 0,
        handedOverAt: day1,
      },
    });
    const fullItem = await prisma.orderItem.create({
      data: {
        orderId: full.id,
        roundId: catalog.round.id,
        productId: catalog.product.id,
        nameSnapshot: 'full-legacy',
        qty: 5,
        unitPrice: 20_000,
        costPriceSnapshot: 10_000,
        arrivedQty: 5,
        handedOverQty: 5,
        handedOverAt: day1,
      },
    });
    await prisma.auditLog.create({
      data: {
        actor: 'seed',
        action: 'HANDOVER',
        entity: 'Order',
        entityId: full.id,
        after: { complete: true },
        createdAt: day1,
      },
    });

    const partial = await prisma.order.create({
      data: {
        code: `PP-${catalog.t.slice(0, 6).toUpperCase()}`,
        customerId: customer.id,
        status: 'ARRIVED',
        subtotal: 200_000,
        paidAmount: 200_000,
        dueAmount: 0,
      },
    });
    const partialItem = await prisma.orderItem.create({
      data: {
        orderId: partial.id,
        roundId: catalog.round.id,
        productId: catalog.product.id,
        nameSnapshot: 'partial-new',
        qty: 10,
        unitPrice: 20_000,
        costPriceSnapshot: 10_000,
        arrivedQty: 10,
        handedOverQty: 5,
        handedOverAt: new Date(),
      },
    });
    await prisma.auditLog.create({
      data: {
        actor: 'seed',
        action: 'HANDOVER_PARTIAL',
        entity: 'Order',
        entityId: partial.id,
        after: { lines: [{ itemId: partialItem.id, qty: 2 }] },
        createdAt: day1,
      },
    });
    await prisma.auditLog.create({
      data: {
        actor: 'seed',
        action: 'HANDOVER_PARTIAL',
        entity: 'Order',
        entityId: partial.id,
        after: { lines: [{ itemId: partialItem.id, qty: 3 }] },
        createdAt: new Date(),
      },
    });

    const mystery = await prisma.order.create({
      data: {
        code: `UN-${catalog.t.slice(0, 6).toUpperCase()}`,
        customerId: customer.id,
        status: 'ARRIVED',
        subtotal: 200_000,
        paidAmount: 200_000,
        dueAmount: 0,
      },
    });
    const mysteryItem = await prisma.orderItem.create({
      data: {
        orderId: mystery.id,
        roundId: catalog.round.id,
        productId: catalog.product.id,
        nameSnapshot: 'unknown-legacy',
        qty: 10,
        unitPrice: 20_000,
        costPriceSnapshot: 10_000,
        arrivedQty: 10,
        handedOverQty: 2,
        handedOverAt: day1,
      },
    });
    await prisma.auditLog.create({
      data: {
        actor: 'seed',
        action: 'HANDOVER_PARTIAL',
        entity: 'Order',
        entityId: mystery.id,
        after: { note: 'хуучин задаргаагүй' },
        createdAt: day1,
      },
    });

    const from = startOfUbMonth(day1);
    const sales = await loadHandoverSales({ from, to: addDays(from, 40) });
    const fullEvents = sales.events.filter((event) => event.itemId === fullItem.id);
    const partialEvents = sales.events.filter((event) => event.itemId === partialItem.id);
    const mysteryEvents = sales.events.filter((event) => event.itemId === mysteryItem.id);
    expect(fullEvents).toHaveLength(1);
    expect(fullEvents[0]?.qty).toBe(5);
    expect(fullEvents[0]?.source).toBe('legacy_full');
    expect(partialEvents.map((event) => event.qty).sort()).toEqual([2, 3]);
    expect(mysteryEvents).toHaveLength(0);
    expect(sales.unknown.some((row) => row.orderId === mystery.id)).toBe(true);
    expect(sales.unknown.some((row) => row.orderId === full.id)).toBe(false);
    expect(fullEvents[0]!.qty + partialEvents.reduce((sum, event) => sum + event.qty, 0)).toBe(10);
  });

  it('5000-аас хуучин өөрийн SMS карт/жагсаалтад үлдэж, бусдынх задрахгүй', async () => {
    const a = await seedAdmin('LEASING');
    const b = await seedAdmin('LEASING');
    const catalog = await seedCatalog();
    const orderA = await prisma.order.create({
      data: {
        code: `SA-${catalog.t.slice(0, 6).toUpperCase()}`,
        customerId: catalog.customer.id,
        status: 'CONFIRMED',
        isLeasing: true,
        payeeKind: 'LEASING',
        leasingOperatorAdminId: a.admin.id,
        subtotal: 100_000,
        leasingFee: 10_000,
        paidAmount: 10_000,
        dueAmount: 100_000,
        confirmedAt: new Date(),
      },
    });
    const orderB = await prisma.order.create({
      data: {
        code: `SB-${catalog.t.slice(0, 6).toUpperCase()}`,
        customerId: catalog.customer.id,
        status: 'CONFIRMED',
        isLeasing: true,
        payeeKind: 'LEASING',
        leasingOperatorAdminId: b.admin.id,
        subtotal: 100_000,
        leasingFee: 10_000,
        paidAmount: 10_000,
        dueAmount: 100_000,
        confirmedAt: new Date(),
      },
    });
    const old = new Date('2019-01-01T00:00:00.000Z');
    const stamp = randomUUID();
    await prisma.smsDispatch.createMany({
      data: Array.from({ length: 5001 }, (_, i) => ({
        channel: 'leasing',
        purpose: 'leasing_pay',
        provider: 'console',
        phone: '99112233',
        status: 'failed',
        relatedType: 'order',
        relatedId: orderA.id,
        idempotencyKey: `old-a-${stamp}-${i}`,
        error: 'old-a-fail',
        createdAt: old,
      })),
    });
    await prisma.smsDispatch.create({
      data: {
        channel: 'leasing',
        purpose: 'leasing_pay',
        provider: 'console',
        phone: '99445566',
        status: 'failed',
        relatedType: 'order',
        relatedId: orderB.id,
        idempotencyKey: `old-b-${stamp}`,
        error: 'secret-b',
        createdAt: old,
      },
    });
    const cards = await fetch(`${server.url}/api/leasing/work/today`, { headers: a.headers });
    const body = (await cards.json()) as { data: { cards: { key: string; count: number }[] } };
    const failed = body.data.cards.find((card) => card.key === 'sms_failed');
    expect(failed?.count).toBe(5001);
    const page = await fetch(`${server.url}/api/leasing/work/today?card=sms_failed`, { headers: a.headers });
    const list = (await page.json()) as {
      meta: { total: number; pageSize: number };
      data: { relatedId?: string; error?: string }[];
    };
    expect(list.meta.total).toBe(5001);
    expect(list.data.length).toBeLessThanOrEqual(list.meta.pageSize);
    expect(JSON.stringify(list)).not.toContain(orderB.id);
    expect(JSON.stringify(list)).not.toContain('secret-b');
    expect(list.data.every((row) => row.relatedId === orderA.id)).toBe(true);
  });

  it('pending retry-г today unknown-д харуулж дахин send хийхгүй', async () => {
    const leasing = await seedAdmin('LEASING');
    const catalog = await seedCatalog();
    const order = await prisma.order.create({
      data: {
        code: `SP-${catalog.t.slice(0, 6).toUpperCase()}`,
        customerId: catalog.customer.id,
        status: 'CONFIRMED',
        isLeasing: true,
        payeeKind: 'LEASING',
        leasingOperatorAdminId: leasing.admin.id,
        subtotal: 100_000,
        leasingFee: 10_000,
        paidAmount: 10_000,
        dueAmount: 100_000,
        confirmedAt: new Date(),
      },
    });
    const confirmKey = `ck-${randomUUID()}`;
    await prisma.smsDispatch.create({
      data: {
        channel: 'leasing',
        purpose: 'leasing_pay',
        provider: 'console',
        phone: '99110022',
        status: 'pending',
        providerMessageId: 'm-old',
        relatedType: 'order',
        relatedId: order.id,
        idempotencyKey: `confirm:leasing_pay:${confirmKey}:${order.id}`,
        attempt: 2,
        error: 'claimed-then-crash',
      },
    });
    const cards = await fetch(`${server.url}/api/leasing/work/today`, { headers: leasing.headers });
    const body = (await cards.json()) as { data: { cards: { key: string; count: number }[] } };
    expect(body.data.cards.find((card) => card.key === 'sms_unknown')?.count).toBe(1);
    const rows = await fetch(`${server.url}/api/leasing/work/today?card=sms_unknown`, {
      headers: leasing.headers,
    });
    const list = (await rows.json()) as { data: { status: string; error?: string }[] };
    expect(list.data[0]?.status).toBe('pending');
    expect(list.data[0]?.error).toBe('claimed-then-crash');
    let sends = 0;
    const retry = await dispatchSms({
      channel: 'leasing',
      purpose: 'leasing_pay',
      phone: '99110022',
      text: 'төлбөр',
      relatedType: 'order',
      relatedId: order.id,
      confirmKey,
      provider: {
        name: 'test',
        tracksDelivery: true,
        send: async () => {
          sends += 1;
          return { accepted: true, status: 'queued' as const, id: 'm-new' };
        },
      },
    });
    expect(retry.skipped).toBe(true);
    expect(sends).toBe(0);
  });
});
