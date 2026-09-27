import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/prisma.js';
import { startApp } from './helpers/httpApp.js';
import { seedAdmin, seedCatalog } from './helpers/seedAdmin.js';
import { randomUUID } from 'node:crypto';
import { recalcOrderTotals } from '../src/services/money.js';

let server: { url: string; close: () => Promise<void> };

beforeAll(async () => {
  server = await startApp();
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION itgel_test_reject_payment() RETURNS trigger AS $$
    BEGIN
      IF NEW.note = 'FAIL_PAYMENT_WRITE' THEN
        RAISE EXCEPTION 'test payment write fail';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await prisma.$executeRawUnsafe(`
    DROP TRIGGER IF EXISTS itgel_test_reject_payment ON "Payment"
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER itgel_test_reject_payment
    BEFORE INSERT ON "Payment"
    FOR EACH ROW EXECUTE FUNCTION itgel_test_reject_payment()
  `);
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS itgel_test_reject_payment ON "Payment";`).catch(() => undefined);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS itgel_test_reject_payment();`).catch(() => undefined);
  await server?.close();
});

async function seedArrivedOrder(opts: {
  subtotal?: number;
  paidAmount?: number;
  dueAmount?: number;
  cargoFee?: number;
  leasingFee?: number;
  shopPaidAmount?: number;
  isLeasing?: boolean;
  payeeKind?: 'SHOP' | 'LEASING' | null;
  items: { qty: number; arrivedQty: number; unitPrice?: number }[];
}) {
  const catalog = await seedCatalog();
  await prisma.productRound.update({
    where: { id: catalog.round.id },
    data: { closeAt: new Date() },
  });
  const order = await prisma.order.create({
    data: {
      code: `PH-${catalog.t.slice(0, 6).toUpperCase()}`,
      customer: { connect: { id: catalog.customer.id } },
      status: 'ARRIVED',
      subtotal: opts.subtotal ?? opts.items.reduce((sum, item) => sum + (item.unitPrice ?? 20_000) * item.qty, 0),
      paidAmount: opts.paidAmount ?? 0,
      dueAmount: opts.dueAmount ?? 0,
      cargoFee: opts.cargoFee ?? 0,
      leasingFee: opts.leasingFee ?? 0,
      shopPaidAmount: opts.shopPaidAmount ?? 0,
      isLeasing: opts.isLeasing ?? false,
      ...(opts.payeeKind ? { payeeKind: opts.payeeKind } : {}),
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
          handedOverQty: 0,
        },
      }),
    );
  }
  const shopPaid = opts.shopPaidAmount ?? 0;
  const leasingPaid = Math.max(0, (opts.paidAmount ?? 0) - shopPaid);
  if (leasingPaid > 0) {
    await prisma.payment.create({
      data: {
        orderId: order.id,
        kind: 'PAYMENT',
        amount: leasingPaid,
        method: 'BANK_TRANSFER',
        actor: 'seed',
        payeeKind: opts.isLeasing ? 'LEASING' : null,
      },
    });
  }
  if (shopPaid > 0) {
    await prisma.payment.create({
      data: {
        orderId: order.id,
        kind: 'PAYMENT',
        amount: shopPaid,
        method: 'CASH',
        actor: 'seed',
        payeeKind: 'SHOP',
      },
    });
  }
  await recalcOrderTotals(prisma, order.id);
  const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  return { ...catalog, order: fresh, items };
}

describe('олголт+төлбөр атомик (HTTP + Postgres)', () => {
  it('ижил key зэрэг хүсэлт нэг олголт, нэг Payment', async () => {
    const staff = await seedAdmin('STAFF');
    const seed = await seedArrivedOrder({
      paidAmount: 30_000,
      items: [{ qty: 2, arrivedQty: 2, unitPrice: 20_000 }],
    });
    const key = `idem-${randomUUID()}`;
    const body = {
      items: [{ itemId: seed.items[0]!.id, qty: 2, expectedHandedQty: 0 }],
      collectedAmount: 10_000,
      method: 'CASH',
      idempotencyKey: key,
    };
    const [a, b] = await Promise.all([
      fetch(`${server.url}/api/admin/handover/partial`, {
        method: 'POST',
        headers: { ...staff.headers, 'Idempotency-Key': key },
        body: JSON.stringify(body),
      }),
      fetch(`${server.url}/api/admin/handover/partial`, {
        method: 'POST',
        headers: { ...staff.headers, 'Idempotency-Key': key },
        body: JSON.stringify(body),
      }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 200]);
    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: seed.items[0]!.id } });
    expect(item.handedOverQty).toBe(2);
    const pays = await prisma.payment.findMany({
      where: { orderId: seed.order.id, kind: 'PAYMENT', payeeKind: 'SHOP' },
    });
    expect(pays).toHaveLength(1);
    expect(pays[0]?.amount).toBe(10_000);
  });

  it('өөр payload ижил key → 409', async () => {
    const staff = await seedAdmin('STAFF');
    const seed = await seedArrivedOrder({
      paidAmount: 40_000,
      items: [{ qty: 2, arrivedQty: 2 }],
    });
    const key = `idem-${randomUUID()}`;
    const first = await fetch(`${server.url}/api/admin/handover/partial`, {
      method: 'POST',
      headers: { ...staff.headers, 'Idempotency-Key': key },
      body: JSON.stringify({
        items: [{ itemId: seed.items[0]!.id, qty: 1, expectedHandedQty: 0 }],
        method: 'CASH',
        idempotencyKey: key,
      }),
    });
    expect(first.status).toBe(200);
    const second = await fetch(`${server.url}/api/admin/handover/partial`, {
      method: 'POST',
      headers: { ...staff.headers, 'Idempotency-Key': key },
      body: JSON.stringify({
        items: [{ itemId: seed.items[0]!.id, qty: 1, expectedHandedQty: 0 }],
        method: 'CARD',
        idempotencyKey: key,
      }),
    });
    expect(second.status).toBe(409);
    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: seed.items[0]!.id } });
    expect(item.handedOverQty).toBe(1);
  });

  it('өөр мөрүүдийн зэрэг олголт нэг захиалгын өрийг хоёр удаа авахгүй', async () => {
    const staff = await seedAdmin('STAFF');
    const seed = await seedArrivedOrder({
      paidAmount: 30_000,
      items: [
        { qty: 1, arrivedQty: 1 },
        { qty: 1, arrivedQty: 1 },
      ],
    });
    const [a, b] = await Promise.all([
      fetch(`${server.url}/api/admin/handover/partial`, {
        method: 'POST',
        headers: staff.headers,
        body: JSON.stringify({
          items: [{ itemId: seed.items[0]!.id, qty: 1, expectedHandedQty: 0 }],
          collectedAmount: 10_000,
          method: 'CASH',
          idempotencyKey: `a-${randomUUID()}`,
        }),
      }),
      fetch(`${server.url}/api/admin/handover/partial`, {
        method: 'POST',
        headers: staff.headers,
        body: JSON.stringify({
          items: [{ itemId: seed.items[1]!.id, qty: 1, expectedHandedQty: 0 }],
          collectedAmount: 10_000,
          method: 'CASH',
          idempotencyKey: `b-${randomUUID()}`,
        }),
      }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 200]);
    const pays = await prisma.payment.findMany({
      where: { orderId: seed.order.id, kind: 'PAYMENT', payeeKind: 'SHOP' },
    });
    expect(pays).toHaveLength(1);
    expect(pays[0]?.amount).toBe(10_000);
  });

  it('төлбөр бичихэд алдаа гарвал олголт хагас хадгалагдахгүй', async () => {
    const staff = await seedAdmin('STAFF');
    const seed = await seedArrivedOrder({
      paidAmount: 30_000,
      items: [{ qty: 2, arrivedQty: 2 }],
    });
    const res = await fetch(`${server.url}/api/admin/handover/partial`, {
      method: 'POST',
      headers: staff.headers,
      body: JSON.stringify({
        items: [{ itemId: seed.items[0]!.id, qty: 2, expectedHandedQty: 0 }],
        collectedAmount: 10_000,
        method: 'CASH',
        note: 'FAIL_PAYMENT_WRITE',
        idempotencyKey: `fail-${randomUUID()}`,
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: seed.items[0]!.id } });
    expect(item.handedOverQty).toBe(0);
    const shopPays = await prisma.payment.findMany({
      where: { orderId: seed.order.id, payeeKind: 'SHOP' },
    });
    expect(shopPays).toHaveLength(0);
  });

  it('карго төлөгдсөн, үндсэн лизинг дутуу — олголт хориглоно, карго дахин нэхэхгүй', async () => {
    const staff = await seedAdmin('STAFF');
    const seed = await seedArrivedOrder({
      isLeasing: true,
      payeeKind: 'LEASING',
      subtotal: 100_000,
      leasingFee: 10_000,
      cargoFee: 10_000,
      paidAmount: 110_000,
      shopPaidAmount: 10_000,
      dueAmount: 10_000,
      items: [{ qty: 1, arrivedQty: 1, unitPrice: 100_000 }],
    });
    const lookup = await fetch(`${server.url}/api/admin/handover/lookup?code=${seed.order.code}`, {
      headers: staff.headers,
    });
    expect(lookup.status).toBe(200);
    const lookupBody = (await lookup.json()) as {
      data: { canHandOver: boolean; shopDueAmount?: number; leasingPrincipalDue?: number };
    };
    expect(lookupBody.data.canHandOver).toBe(false);

    const res = await fetch(`${server.url}/api/admin/handover/partial`, {
      method: 'POST',
      headers: staff.headers,
      body: JSON.stringify({
        items: [{ itemId: seed.items[0]!.id, qty: 1, expectedHandedQty: 0 }],
        collectedAmount: 10_000,
        method: 'CASH',
        idempotencyKey: `lease-${randomUUID()}`,
      }),
    });
    expect(res.status).toBe(409);
    const err = (await res.json()) as { error: { details?: { code?: string } } };
    expect(err.error.details?.code).toBe('LEASING_BALANCE_DUE');
    const payCount = await prisma.payment.count({ where: { orderId: seed.order.id } });
    expect(payCount).toBe(2);
    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: seed.items[0]!.id } });
    expect(item.handedOverQty).toBe(0);
  });

  it('complete зам ч олголт+мөнгийг нэгтгэнэ', async () => {
    const staff = await seedAdmin('STAFF');
    const seed = await seedArrivedOrder({
      paidAmount: 15_000,
      items: [{ qty: 1, arrivedQty: 1 }],
    });
    const res = await fetch(`${server.url}/api/admin/handover/${seed.order.id}/complete`, {
      method: 'POST',
      headers: staff.headers,
      body: JSON.stringify({
        collectedAmount: 5_000,
        method: 'CASH',
        idempotencyKey: `c-${randomUUID()}`,
      }),
    });
    expect(res.status).toBe(200);
    const pays = await prisma.payment.findMany({ where: { orderId: seed.order.id, payeeKind: 'SHOP' } });
    expect(pays).toHaveLength(1);
    expect(pays[0]?.amount).toBe(5_000);
  });
});
