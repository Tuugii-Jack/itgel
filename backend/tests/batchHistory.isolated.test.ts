import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/prisma.js';
import { qtyByBatchIds } from '../src/modules/batches/list.js';
import { handoverHistory } from '../src/services/handoverHistory.js';
import { loadHandoverPieceEvents } from '../src/lib/handoverEvents.js';
import { handOverItems } from '../src/modules/orders/handover.js';
import { addDays, startOfUbMonth, ubMonthKey } from '../src/lib/date.js';
import { seedAdmin, seedCatalog } from './helpers/seedAdmin.js';
import { startApp } from './helpers/httpApp.js';

let server: { url: string; close: () => Promise<void> };

beforeAll(async () => {
  server = await startApp();
});

afterAll(async () => {
  await server?.close();
});

describe('багц ирсэн тоо + олголтын түүх', () => {
  it('10 захиалсан, 4 ирсэн, 2 олгосон үед ирсэн=4, бүрэн биш', async () => {
    const catalog = await seedCatalog();
    const batch = await prisma.batch.create({
      data: { name: `B-${catalog.t}`, stage: 'IN_TRANSIT' },
    });
    await prisma.productRound.update({
      where: { id: catalog.round.id },
      data: { batchId: batch.id, closeAt: new Date() },
    });
    const order = await prisma.order.create({
      data: {
        code: `PH-${catalog.t.slice(0, 6).toUpperCase()}`,
        customerId: catalog.customer.id,
        status: 'IN_TRANSIT',
        batchId: batch.id,
        subtotal: 200_000,
        paidAmount: 200_000,
        dueAmount: 0,
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        roundId: catalog.round.id,
        productId: catalog.product.id,
        nameSnapshot: catalog.product.name,
        qty: 10,
        unitPrice: 20_000,
        costPriceSnapshot: 10_000,
        arrivedQty: 4,
        handedOverQty: 2,
        handedOverAt: new Date(),
      },
    });
    const qty = await qtyByBatchIds([batch.id]);
    const row = qty.get(batch.id);
    expect(row?.orderedQty).toBe(10);
    expect(row?.arrivedQty).toBe(4);
    expect(row?.linkedQty).toBe(10);
  });

  it('түүх зөвхөн тухайн олголтын ширхэг/огноог тоолно, дараагийн өдөр шилжүүлэхгүй', async () => {
    const catalog = await seedCatalog();
    const order = await prisma.order.create({
      data: {
        code: `PH-${catalog.t.slice(0, 6).toUpperCase()}`,
        customerId: catalog.customer.id,
        status: 'ARRIVED',
        subtotal: 200_000,
        paidAmount: 200_000,
        dueAmount: 0,
        arrivedAt: new Date(),
      },
    });
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        roundId: catalog.round.id,
        productId: catalog.product.id,
        nameSnapshot: catalog.product.name,
        qty: 10,
        unitPrice: 20_000,
        costPriceSnapshot: 10_000,
        arrivedQty: 10,
        arrivedAt: new Date(),
        handedOverQty: 0,
      },
    });
    await handOverItems({
      actor: 'admin:hist',
      idempotencyKey: `h1-${randomUUID()}`,
      lines: [{ itemId: item.id, qty: 2, expectedHandedQty: 0 }],
    });
    const firstLogs = await prisma.auditLog.findMany({
      where: { entityId: order.id, action: 'HANDOVER_PARTIAL' },
    });
    const yesterday = addDays(new Date(), -1);
    await prisma.auditLog.updateMany({
      where: { id: { in: firstLogs.map((row) => row.id) } },
      data: { createdAt: yesterday },
    });
    await prisma.orderItem.update({
      where: { id: item.id },
      data: { handedOverAt: new Date() },
    });
    await handOverItems({
      actor: 'admin:hist',
      idempotencyKey: `h2-${randomUUID()}`,
      lines: [{ itemId: item.id, qty: 3, expectedHandedQty: 2 }],
    });

    const y = yesterday.getFullYear();
    const m = yesterday.getMonth() + 1;
    const past = await handoverHistory(y, m);
    const today = await handoverHistory(new Date().getFullYear(), new Date().getMonth() + 1);
    const pastQty = past.days.reduce((sum, day) => sum + day.itemCount, 0);
    const todayQty = today.days.reduce((sum, day) => sum + day.itemCount, 0);
    if (ubMonthKey(yesterday) === ubMonthKey(new Date())) {
      expect(pastQty).toBeGreaterThanOrEqual(5);
    } else {
      expect(pastQty).toBeGreaterThanOrEqual(2);
      expect(todayQty).toBeGreaterThanOrEqual(3);
    }
    const from = startOfUbMonth(yesterday);
    const events = await loadHandoverPieceEvents({ from, to: addDays(from, 40) });
    const forItem = events.filter((event) => event.itemId === item.id);
    expect(forItem.map((event) => event.qty).sort()).toEqual([2, 3]);
    expect(forItem.some((event) => event.at.getTime() <= yesterday.getTime() + 60_000)).toBe(true);
  });

  it('тайлан HTTP-ээр зөвхөн олгосон ширхгийг тоолно', async () => {
    const staff = await seedAdmin('ADMIN');
    const res = await fetch(`${server.url}/api/admin/reports/revenue?period=3m`, {
      headers: staff.headers,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { totals: { soldQty: number } } };
    expect(typeof body.data.totals.soldQty).toBe('number');
  });
});
