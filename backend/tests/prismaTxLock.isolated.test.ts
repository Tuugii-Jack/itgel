import { describe, expect, it } from 'vitest';
import { prisma } from '../src/prisma.js';
import { seedCatalog } from './helpers/seedAdmin.js';

async function seedOrder() {
  const catalog = await seedCatalog();
  const order = await prisma.order.create({
    data: {
      code: `PH-${catalog.t.slice(0, 6).toUpperCase()}`,
      customerId: catalog.customer.id,
      status: 'ARRIVED',
      note: 'before-lock',
      subtotal: 10_000,
      paidAmount: 0,
      dueAmount: 10_000,
    },
  });
  return order;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Prisma $transaction + $extends lock', () => {
  it('extended tx write is not visible outside until COMMIT', async () => {
    const order = await seedOrder();
    let sawInsideTx = false;
    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { note: 'inside-tx' } });
      const outsider = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      sawInsideTx = outsider.note === 'inside-tx';
      expect(outsider.note).toBe('before-lock');
    });
    expect(sawInsideTx).toBe(false);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.note).toBe('inside-tx');
  });

  it('extended $queryRaw FOR UPDATE waits for the other transaction', async () => {
    const order = await seedOrder();
    const events: string[] = [];
    const first = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
      events.push('a-locked');
      await sleep(250);
      events.push('a-done');
    });
    await sleep(40);
    const t0 = Date.now();
    const second = prisma.$transaction(async (tx) => {
      events.push('b-start');
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
      events.push('b-locked');
      expect(Date.now() - t0).toBeGreaterThan(150);
    });
    await Promise.all([first, second]);
    expect(events.indexOf('a-done')).toBeLessThan(events.indexOf('b-locked'));
  });

  it('extended lock serializes two payments on the same order', async () => {
    const order = await seedOrder();
    await Promise.all([
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
        const row = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
        if ((row.paidAmount ?? 0) > 0) return;
        await tx.payment.create({
          data: {
            orderId: order.id,
            kind: 'PAYMENT',
            amount: 10_000,
            method: 'CASH',
            actor: 'lock-a',
            payeeKind: 'SHOP',
          },
        });
        await tx.order.update({ where: { id: order.id }, data: { paidAmount: 10_000 } });
      }),
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
        const row = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
        if ((row.paidAmount ?? 0) > 0) return;
        await tx.payment.create({
          data: {
            orderId: order.id,
            kind: 'PAYMENT',
            amount: 10_000,
            method: 'CASH',
            actor: 'lock-b',
            payeeKind: 'SHOP',
          },
        });
        await tx.order.update({ where: { id: order.id }, data: { paidAmount: 10_000 } });
      }),
    ]);
    const pays = await prisma.payment.findMany({
      where: { orderId: order.id, payeeKind: 'SHOP' },
    });
    expect(pays).toHaveLength(1);
  });
});
