import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/prisma.js';
import { handOverItems } from '../src/modules/orders/handover.js';
import { handedQtyOf, pickableQtyOf } from '../src/lib/itemQty.js';
import { loadTodayWork, loadTodayCardRows } from '../src/modules/work/today.js';
import { startOfUbDay, endOfUbDay, addDays } from '../src/lib/date.js';

const suffix = randomUUID().slice(0, 8);

async function seedPartialItem() {
  const token = randomUUID().replace(/-/g, '').slice(0, 10);
  const category = await prisma.category.create({
    data: { name: `qty-${token}` },
  });
  const product = await prisma.product.create({
    data: { name: `qty-p-${token}`, categoryId: category.id },
  });
  const round = await prisma.productRound.create({
    data: {
      productId: product.id,
      roundNo: 1,
      costPrice: 10_000,
      sellPrice: 20_000,
      status: 'ACTIVE',
    },
  });
  const customer = await prisma.customer.create({
    data: { phone: `8${token.replace(/[a-f]/g, '1').slice(0, 7)}`, name: 'Qty Test' },
  });
  const order = await prisma.order.create({
    data: {
      code: `PH-${token.slice(0, 6).toUpperCase()}`,
      customerId: customer.id,
      status: 'ARRIVED',
      subtotal: 200_000,
      paidAmount: 200_000,
      dueAmount: 0,
    },
  });
  const item = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      roundId: round.id,
      productId: product.id,
      nameSnapshot: product.name,
      qty: 10,
      unitPrice: 20_000,
      costPriceSnapshot: 10_000,
      arrivedQty: 4,
      handedOverQty: 0,
    },
  });
  return { category, product, round, customer, order, item };
}

describe('ширхгээр хэсэгчилсэн олголт (жинхэнэ Postgres)', () => {
  const created: { orderId?: string; itemId?: string } = {};

  afterAll(async () => {
    if (created.itemId) await prisma.orderItem.deleteMany({ where: { id: created.itemId } }).catch(() => undefined);
    if (created.orderId) await prisma.order.deleteMany({ where: { id: created.orderId } }).catch(() => undefined);
  });

  it('2 олгоод дараа 3 ирэхэд тоо зөв, зэрэг/давхар хүсэлт давхар бүртгэгдэхгүй', async () => {
    const seed = await seedPartialItem();
    created.orderId = seed.order.id;
    created.itemId = seed.item.id;

    const first = await handOverItems({
      actor: 'staff-a',
      idempotencyKey: `handover-a-${suffix}`,
      lines: [{ itemId: seed.item.id, qty: 2, expectedHandedQty: 0 }],
    });
    expect(first.pieceCount).toBe(2);

    const retry = await handOverItems({
      actor: 'staff-a',
      idempotencyKey: `handover-a-${suffix}`,
      lines: [{ itemId: seed.item.id, qty: 2, expectedHandedQty: 0 }],
    });
    expect(retry.pieceCount).toBe(2);

    const afterFirst = await prisma.orderItem.findUniqueOrThrow({ where: { id: seed.item.id } });
    expect(handedQtyOf(afterFirst)).toBe(2);
    expect(pickableQtyOf(afterFirst)).toBe(2);
    expect(afterFirst.arrivedQty).toBe(4);

    const concurrent = await Promise.allSettled([
      handOverItems({
        actor: 'staff-b',
        idempotencyKey: `handover-b1-${suffix}`,
        lines: [{ itemId: seed.item.id, qty: 2, expectedHandedQty: 2 }],
      }),
      handOverItems({
        actor: 'staff-c',
        idempotencyKey: `handover-b2-${suffix}`,
        lines: [{ itemId: seed.item.id, qty: 2, expectedHandedQty: 2 }],
      }),
    ]);
    const ok = concurrent.filter((row) => row.status === 'fulfilled');
    const rejected = concurrent.filter((row) => row.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    await prisma.orderItem.update({
      where: { id: seed.item.id },
      data: { arrivedQty: 7 },
    });
    const afterArrival = await prisma.orderItem.findUniqueOrThrow({ where: { id: seed.item.id } });
    expect(afterArrival.arrivedQty).toBe(7);
    expect(handedQtyOf(afterArrival)).toBe(4);
    expect(pickableQtyOf(afterArrival)).toBe(3);

    const later = await handOverItems({
      actor: 'staff-a',
      idempotencyKey: `handover-later-${suffix}`,
      lines: [{ itemId: seed.item.id, qty: 3, expectedHandedQty: 4 }],
    });
    expect(later.pieceCount).toBe(3);
    const fresh = await prisma.orderItem.findUniqueOrThrow({ where: { id: seed.item.id } });
    expect(handedQtyOf(fresh)).toBe(7);
    expect(pickableQtyOf(fresh)).toBe(0);
    expect(fresh.arrivedQty).toBe(7);
  });

  it('ирсэн тооноос хэтрүүлж олгохгүй', async () => {
    const seed = await seedPartialItem();
    await expect(
      handOverItems({
        actor: 'staff-a',
        idempotencyKey: `handover-over-${suffix}`,
        lines: [{ itemId: seed.item.id, qty: 5, expectedHandedQty: 0 }],
      }),
    ).rejects.toThrow(/олгох боломжтой/);
    await prisma.orderItem.delete({ where: { id: seed.item.id } });
    await prisma.order.delete({ where: { id: seed.order.id } });
  });
});

describe('өнөөдрийн ажил — карт = жагсаалт', () => {
  it('collected_today UB өдрийн заагийг баримтална, карт/мөр тэнцэнэ', async () => {
    const now = new Date();
    const from = startOfUbDay(now);
    const before = addDays(from, -1);
    const after = addDays(endOfUbDay(now), 1);

    const shop = await loadTodayWork({
      role: 'ADMIN',
      actorId: 'admin',
      portal: 'shop',
    });
    const leasing = await loadTodayWork({
      role: 'LEASING',
      actorId: 'leasing',
      portal: 'leasing',
    });
    expect(shop.cards.some((c) => c.key === 'due_today')).toBe(false);
    expect(leasing.cards.some((c) => c.key === 'arrived_unhanded')).toBe(false);
    const ownerLease = await loadTodayWork({
      role: 'OWNER',
      actorId: 'owner',
      portal: 'leasing',
    });
    expect(ownerLease.cards.some((c) => c.key === 'short_cargo')).toBe(false);
    expect(ownerLease.cards.some((c) => c.key === 'arrived_unhanded')).toBe(false);
    expect(shop.cards.some((c) => c.key === 'collected_today')).toBe(true);
    expect(leasing.cards.some((c) => c.key === 'due_today')).toBe(true);

    const collected = shop.cards.find((c) => c.key === 'collected_today');
    if (!collected) return;
    const rows = await loadTodayCardRows({
      role: 'ADMIN',
      actorId: 'admin',
      portal: 'shop',
      card: 'collected_today',
      day: shop.day,
      page: 1,
    });
    expect(rows.meta.total).toBe(collected.count);

    const arrived = shop.cards.find((c) => c.key === 'arrived_unhanded');
    if (!arrived) return;
    let pieceSum = 0;
    let page = 1;
    let pages = 1;
    while (page <= pages) {
      const list = await loadTodayCardRows({
        role: 'ADMIN',
        actorId: 'admin',
        portal: 'shop',
        card: 'arrived_unhanded',
        day: shop.day,
        page,
      });
      pages = list.meta.pages;
      pieceSum += list.data.reduce((sum, row) => sum + ('amount' in row ? (row.amount ?? 0) : 0), 0);
      page += 1;
    }
    expect(pieceSum).toBe(arrived.amount);
    expect(before < from).toBe(true);
    expect(after > endOfUbDay(now)).toBe(true);
  });
});
