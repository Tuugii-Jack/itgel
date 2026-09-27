import { describe, expect, it } from 'vitest';
import { prisma } from '../src/prisma.js';
import { seedCatalog } from './helpers/seedAdmin.js';
import { changeOrderStatus, revertOrderStatus } from '../src/modules/orders/lifecycle.js';
import { AppError } from '../src/lib/errors.js';

async function seedOrder(status: 'ARRIVED' | 'HANDED_OVER', qty: {
  qty: number;
  arrivedQty: number;
  handedOverQty: number;
}) {
  const catalog = await seedCatalog();
  const order = await prisma.order.create({
    data: {
      code: `PH-${catalog.t.slice(0, 6).toUpperCase()}`,
      customerId: catalog.customer.id,
      status,
      subtotal: qty.qty * 20_000,
      paidAmount: qty.qty * 20_000,
      dueAmount: 0,
      arrivedAt: new Date(),
      handedOverAt: status === 'HANDED_OVER' ? new Date() : null,
    },
  });
  const item = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      roundId: catalog.round.id,
      productId: catalog.product.id,
      nameSnapshot: catalog.product.name,
      qty: qty.qty,
      unitPrice: 20_000,
      costPriceSnapshot: 10_000,
      arrivedQty: qty.arrivedQty,
      arrivedAt: qty.arrivedQty >= qty.qty ? new Date() : null,
      handedOverQty: qty.handedOverQty,
      handedOverAt: qty.handedOverQty > 0 ? new Date() : null,
    },
  });
  return { order, item };
}

describe('төлөв солих / буцаах — ширхэг', () => {
  it('HANDED_OVER-оос буцаах нь олгосон тоог устгахгүй, 409 өгнө', async () => {
    const seed = await seedOrder('HANDED_OVER', { qty: 5, arrivedQty: 5, handedOverQty: 5 });
    await expect(
      revertOrderStatus(seed.order.id, { actor: 'admin:test', reason: 'тест' }),
    ).rejects.toMatchObject({ status: 409, details: { code: 'HANDOVER_REVERT_BLOCKED' } } satisfies Partial<AppError>);
    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: seed.item.id } });
    expect(item.handedOverQty).toBe(5);
    expect(item.arrivedQty).toBe(5);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: seed.order.id } });
    expect(order.status).toBe('HANDED_OVER');
  });

  it('хэсэгчилсэн олголттой ARRIVED-ийг буцаахгүй', async () => {
    const seed = await seedOrder('ARRIVED', { qty: 5, arrivedQty: 5, handedOverQty: 2 });
    await expect(
      revertOrderStatus(seed.order.id, { actor: 'admin:test', reason: 'тест' }),
    ).rejects.toMatchObject({ status: 409, details: { code: 'ARRIVAL_REVERT_BLOCKED' } } satisfies Partial<AppError>);
    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: seed.item.id } });
    expect(item.arrivedQty).toBe(5);
    expect(item.handedOverQty).toBe(2);
  });

  it('шууд HANDED_OVER дутуу ширхэгтэй бол 409, тоо нөхөхгүй', async () => {
    const seed = await seedOrder('ARRIVED', { qty: 5, arrivedQty: 5, handedOverQty: 2 });
    await expect(
      changeOrderStatus(seed.order.id, 'HANDED_OVER', { actor: 'admin:test', reason: 'шууд' }),
    ).rejects.toMatchObject({ status: 409, details: { code: 'HANDOVER_QTY_INCOMPLETE' } } satisfies Partial<AppError>);
    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: seed.item.id } });
    expect(item.handedOverQty).toBe(2);
    expect(item.arrivedQty).toBe(5);
  });

  it('олгосон бараатай захиалгыг бүтнээр цуцлахгүй', async () => {
    const seed = await seedOrder('ARRIVED', { qty: 5, arrivedQty: 5, handedOverQty: 1 });
    await expect(
      changeOrderStatus(seed.order.id, 'CANCELLED', { actor: 'admin:test', reason: 'цуцлах' }),
    ).rejects.toBeInstanceOf(AppError);
    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: seed.item.id } });
    expect(item.handedOverQty).toBe(1);
    expect(item.cancelledAt).toBeNull();
  });
});
