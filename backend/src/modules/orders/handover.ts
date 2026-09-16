import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { conflict } from '../../lib/errors.js';
import { lockOrders } from '../../lib/orderLock.js';
import { promoteOrdersToArrived } from './lifecycle.js';

export interface HandOverItemsResult {
  itemCount: number;
  orderIds: string[];
  completedOrderIds: string[];
}

/**
 * Ирсэн мөрүүдийг хүлээлгэн өгнө. Бүх идэвхтэй мөр авсан захиалгыг HANDED_OVER болгоно.
 */
export async function handOverItems(opts: {
  itemIds: string[];
  actor: string;
  note?: string;
  now?: Date;
}): Promise<HandOverItemsResult> {
  const now = opts.now ?? new Date();
  const itemIds = [...new Set(opts.itemIds)];
  if (itemIds.length === 0) throw conflict('Бараа сонгоогүй байна.');

  return prisma.$transaction(async (tx) => {
    const requested = await tx.orderItem.findMany({
      where: { id: { in: itemIds } },
      select: { orderId: true },
    });
    await lockOrders(tx, requested.map((item) => item.orderId));
    const items = await tx.orderItem.findMany({
      where: { id: { in: itemIds } },
      include: {
        order: { include: { delivery: true } },
      },
    });
    if (items.length !== itemIds.length) throw conflict('Зарим бараа олдсонгүй.');

    for (const item of items) {
      if (item.cancelledAt) {
        throw conflict(`"${item.nameSnapshot}" цуцлагдсан тул өгөх боломжгүй.`);
      }
      if (!item.arrivedAt) {
        throw conflict(`"${item.nameSnapshot}" агуулахад ирээгүй байна.`);
      }
      if (item.handedOverAt) {
        throw conflict(`"${item.nameSnapshot}" аль хэдийн өгсөн байна.`);
      }
      if (item.order.deletedAt || item.order.status === 'CANCELLED') {
        throw conflict(`${item.order.code} захиалга хүчингүй.`);
      }
      if (item.order.status === 'HANDED_OVER') {
        throw conflict(`${item.order.code} аль хэдийн бүтнээр өгсөн.`);
      }
    }

    const handedOver = await tx.orderItem.updateMany({
      where: {
        id: { in: itemIds },
        cancelledAt: null,
        handedOverAt: null,
        arrivedAt: { not: null },
        order: { deletedAt: null, status: { notIn: ['CANCELLED', 'HANDED_OVER'] } },
      },
      data: { handedOverAt: now },
    });
    if (handedOver.count !== itemIds.length) {
      throw conflict('Зарим барааны төлөв өөрчлөгдсөн байна. Дахин ачаална уу.');
    }
    await tx.orderItem.updateMany({
      where: { id: { in: itemIds }, fulfilment: null },
      data: { fulfilment: 'PICKUP' },
    });

    const orderIds = [...new Set(items.map((i) => i.orderId))];

    // Утсаар/админ захиалга — хэрэглэгч сайт дээр авах арга сонгоогүй байсан ч
    // биеэр ирж авсан бол PICKUP гэж тэмдэглэнэ.
    await tx.order.updateMany({
      where: { id: { in: orderIds }, fulfilment: null },
      data: { fulfilment: 'PICKUP' },
    });

    const completedOrderIds: string[] = [];

    for (const orderId of orderIds) {
      const remaining = await tx.orderItem.count({
        where: {
          orderId,
          cancelledAt: null,
          handedOverAt: null,
        },
      });

      if (remaining > 0) {
        // Хэсэгчилсэн — захиалга ARRIVED хэвээр (эсвэл урагшлуулах).
        const order = items.find((i) => i.orderId === orderId)!.order;
        if (order.status !== 'ARRIVED' && order.status !== 'HANDED_OVER') {
          await promoteOrdersToArrived(
            tx,
            [orderId],
            opts.actor,
            opts.note ?? 'Хэсэгчилсэн хүлээлгэн өгөх',
            now,
          );
        }
        await audit(
          {
            actor: opts.actor,
            action: 'HANDOVER_PARTIAL',
            entity: 'Order',
            entityId: orderId,
            after: {
              itemIds: items.filter((i) => i.orderId === orderId).map((i) => i.id),
              note: opts.note,
            },
          },
          tx,
        );
        continue;
      }

      const order = items.find((i) => i.orderId === orderId)!.order;
      // Бүх мөр авсан — HANDED_OVER хүртэл.
      if (order.status !== 'HANDED_OVER') {
        if (order.status !== 'ARRIVED') {
          await promoteOrdersToArrived(
            tx,
            [orderId],
            opts.actor,
            opts.note ?? 'Хүлээлгэн өгөх',
            now,
          );
        }
        const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
        if (fresh.status === 'ARRIVED') {
          await tx.order.update({
            where: { id: orderId },
            data: { status: 'HANDED_OVER', handedOverAt: now },
          });
          await audit(
            {
              actor: opts.actor,
              action: 'STATUS_CHANGE',
              entity: 'Order',
              entityId: orderId,
              before: { status: 'ARRIVED' },
              after: { status: 'HANDED_OVER', reason: opts.note },
            },
            tx,
          );
        }
      }

      if (order.delivery) {
        await tx.delivery.update({
          where: { id: order.delivery.id },
          data: { status: 'DELIVERED' },
        });
      }

      await audit(
        {
          actor: opts.actor,
          action: 'HANDOVER',
          entity: 'Order',
          entityId: orderId,
          after: { note: opts.note, complete: true },
        },
        tx,
      );
      completedOrderIds.push(orderId);
    }

    return { itemCount: itemIds.length, orderIds, completedOrderIds };
  });
}
