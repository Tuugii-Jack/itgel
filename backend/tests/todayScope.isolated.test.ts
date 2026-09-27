import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/prisma.js';
import { startApp } from './helpers/httpApp.js';
import { seedAdmin, seedCatalog } from './helpers/seedAdmin.js';
import { startOfUbDay, ubDateString } from '../src/lib/date.js';

let server: { url: string; close: () => Promise<void> };

beforeAll(async () => {
  server = await startApp();
});

afterAll(async () => {
  await server?.close();
});

async function seedLeasingOrder(operatorId: string, code: string, amounts: {
  paidAmount: number;
  shopPaidAmount?: number;
  dueAmount: number;
}) {
  const catalog = await seedCatalog();
  const order = await prisma.order.create({
    data: {
      code,
      customerId: catalog.customer.id,
      status: 'CONFIRMED',
      isLeasing: true,
      payeeKind: 'LEASING',
      leasingOperatorAdminId: operatorId,
      subtotal: 100_000,
      leasingFee: 10_000,
      cargoFee: 10_000,
      paidAmount: amounts.paidAmount,
      shopPaidAmount: amounts.shopPaidAmount ?? 0,
      dueAmount: amounts.dueAmount,
      confirmedAt: new Date(),
      createdAt: startOfUbDay(new Date()),
    },
  });
  return { ...catalog, order };
}

describe('өнөөдрийн ажил — лизингийн эзэн + due_today', () => {
  it('LEASING A/B болон OWNER шүүлт код/дүн/SMS задрахгүй', async () => {
    const a = await seedAdmin('LEASING');
    const b = await seedAdmin('LEASING');
    const owner = await seedAdmin('OWNER');
    const orderA = await seedLeasingOrder(a.admin.id, `PA-${randomUUID().slice(0, 6).toUpperCase()}`, {
      paidAmount: 10_000,
      dueAmount: 100_000,
    });
    const orderB = await seedLeasingOrder(b.admin.id, `PB-${randomUUID().slice(0, 6).toUpperCase()}`, {
      paidAmount: 50_000,
      dueAmount: 60_000,
    });
    await prisma.payment.create({
      data: {
        orderId: orderB.order.id,
        kind: 'PAYMENT',
        amount: 50_000,
        method: 'BANK_TRANSFER',
        payeeKind: 'LEASING',
        actor: `admin:${b.admin.id}`,
      },
    });
    const smsB = await prisma.smsDispatch.create({
      data: {
        channel: 'leasing',
        purpose: 'leasing_pay',
        provider: 'console',
        phone: '99110011',
        status: 'failed',
        relatedType: 'order',
        relatedId: orderB.order.id,
        idempotencyKey: `sms-b-${randomUUID()}`,
        error: 'secret-b-fail',
      },
    });
    await prisma.smsDispatch.create({
      data: {
        channel: 'leasing',
        purpose: 'leasing_custom',
        provider: 'console',
        phone: '99000000',
        status: 'failed',
        relatedType: 'custom',
        relatedId: 'unscoped',
        idempotencyKey: `sms-u-${randomUUID()}`,
        error: 'unattributed-secret',
      },
    });

    const asA = await fetch(`${server.url}/api/leasing/work/today`, { headers: a.headers });
    expect(asA.status).toBe(200);
    const bodyA = (await asA.json()) as { data: { cards: { key: string; count: number; amount: number | null }[] } };
    const textA = JSON.stringify(bodyA);
    expect(textA).not.toContain(orderB.order.code);
    expect(textA).not.toContain(orderB.order.id);
    expect(textA).not.toContain(smsB.id);
    expect(textA).not.toContain('secret-b-fail');
    expect(textA).not.toContain('unattributed-secret');

    const smsRowsA = await fetch(`${server.url}/api/leasing/work/today?card=sms_failed`, { headers: a.headers });
    const smsA = (await smsRowsA.json()) as { data: { id: string; relatedId?: string; error?: string }[] };
    const smsTextA = JSON.stringify(smsA);
    expect(smsTextA).not.toContain(orderB.order.id);
    expect(smsTextA).not.toContain(smsB.id);
    expect(smsTextA).not.toContain('unattributed-secret');
    expect(smsA.data.every((row) => row.relatedId === orderA.order.id || row.relatedId == null)).toBe(true);

    const collectedA = await fetch(`${server.url}/api/leasing/work/today?card=collected_today`, { headers: a.headers });
    const collectedBodyA = (await collectedA.json()) as { data: { code?: string; amount?: number }[] };
    expect(JSON.stringify(collectedBodyA)).not.toContain(orderB.order.code);
    expect(collectedBodyA.data.some((row) => row.amount === 50_000)).toBe(false);

    const collectedOwner = await fetch(
      `${server.url}/api/leasing/work/today?card=collected_today`,
      { headers: owner.headers },
    );
    const collectedOwnerBody = JSON.stringify(await collectedOwner.json());
    expect(collectedOwnerBody).toContain(orderB.order.code);

    const asOwnerACollected = await fetch(
      `${server.url}/api/leasing/work/today?card=collected_today&ownerAdminId=${a.admin.id}`,
      { headers: owner.headers },
    );
    expect(JSON.stringify(await asOwnerACollected.json())).not.toContain(orderB.order.code);

    const asOwnerA = await fetch(
      `${server.url}/api/leasing/work/today?card=due_today&ownerAdminId=${a.admin.id}`,
      { headers: owner.headers },
    );
    const ownerA = JSON.stringify(await asOwnerA.json());
    expect(ownerA).toContain(orderA.order.code);
    expect(ownerA).not.toContain(orderB.order.code);
  });

  it('бүрэн төлөгдсөн өнөөдрийн хуваарь нийт/төлсөн/үлдсэн харагдана', async () => {
    const leasing = await seedAdmin('LEASING');
    const paid = await seedLeasingOrder(leasing.admin.id, `PF-${randomUUID().slice(0, 6).toUpperCase()}`, {
      paidAmount: 10_000,
      dueAmount: 100_000,
    });
    await prisma.order.update({
      where: { id: paid.order.id },
      data: { paidAmount: 10_000, dueAmount: 100_000, shopPaidAmount: 0 },
    });
    const cardsRes = await fetch(`${server.url}/api/leasing/work/today`, { headers: leasing.headers });
    const cards = (await cardsRes.json()) as {
      data: { day: string; cards: { key: string; count: number; amount: number | null; paidAmount?: number; remainingAmount?: number }[] };
    };
    expect(cards.data.day).toBe(ubDateString(new Date()));
    const due = cards.data.cards.find((card) => card.key === 'due_today');
    expect(due?.count).toBe(1);
    expect(due?.amount).toBe(10_000);
    expect(due?.paidAmount).toBe(10_000);
    expect(due?.remainingAmount).toBe(0);

    const listRes = await fetch(`${server.url}/api/leasing/work/today?card=due_today`, {
      headers: leasing.headers,
    });
    const list = (await listRes.json()) as {
      data: { code: string; amount: number; paidAmount: number; remainingAmount: number }[];
    };
    expect(list.data).toHaveLength(1);
    expect(list.data[0]?.code).toBe(paid.order.code);
    expect(list.data[0]?.amount).toBe(10_000);
    expect(list.data[0]?.paidAmount).toBe(10_000);
    expect(list.data[0]?.remainingAmount).toBe(0);
  });
});
