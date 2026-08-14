import type { Payment, PaymentKind, PaymentMethod, Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { audit } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import { assertRefundable, computeTotals, recalcOrderTotals, type OrderTotals } from './money.js';
import { syncOrderCargoFee } from './cargoFee.js';

type Tx = Prisma.TransactionClient;

export interface RecordPaymentInput {
  orderId: string;
  kind: PaymentKind;
  amount: number;
  method?: PaymentMethod;
  reference?: string | null;
  note?: string | null;
  actor: string;
}

/**
 * Дэвтэрт мөр нэмж, захиалгын дүнг дахин бодно.
 * Мөр устгагдахгүй — алдаатай бичилтийг эсрэг мөрөөр залруулна.
 */
export async function recordPayment(
  input: RecordPaymentInput,
): Promise<{ payment: Payment; totals: OrderTotals }> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw conflict('Дүн 0-ээс их бүхэл тоо байх ёстой.');
  }

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: input.orderId, deletedAt: null },
      select: {
        id: true,
        code: true,
        subtotal: true,
        deliveryFee: true,
        storageFee: true,
        cargoFee: true,
        paidAmount: true,
        refundedAmount: true,
      },
    });
    if (!order) throw notFound('Захиалга олдсонгүй.');

    if (input.kind === 'REFUND') {
      assertRefundable(computeTotals(order), input.amount);
    }

    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        kind: input.kind,
        amount: input.amount,
        method: input.method ?? 'BANK_TRANSFER',
        reference: input.reference ?? null,
        note: input.note ?? null,
        actor: input.actor,
      },
    });

    const totals = await recalcOrderTotals(tx, order.id);

    await audit(
      {
        actor: input.actor,
        action: input.kind === 'PAYMENT' ? 'PAYMENT_RECORDED' : 'REFUND_RECORDED',
        entity: 'Order',
        entityId: order.id,
        after: {
          code: order.code,
          amount: input.amount,
          method: payment.method,
          reference: payment.reference,
          dueAmount: totals.dueAmount,
        },
      },
      tx,
    );

    return { payment, totals };
  });
}

/**
 * Захиалгын нэг мөрийг цуцлана.
 * Бэлэн барааны үлдэгдлийг буцааж нэмнэ. Бүх мөр цуцлагдвал захиалга өөрөө цуцлагдана.
 */
export async function cancelOrderItem(input: {
  orderId: string;
  itemId: string;
  reason?: string | null;
  actor: string;
  /** Мөрийн дүнг автоматаар буцаах эсэх. */
  refund: boolean;
}): Promise<{ totals: OrderTotals; orderCancelled: boolean; refunded: number }> {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: input.orderId, deletedAt: null },
      select: { id: true, code: true, status: true },
    });
    if (!order) throw notFound('Захиалга олдсонгүй.');
    if (order.status === 'HANDED_OVER') {
      throw conflict('Хүлээлгэн өгсөн захиалгын мөрийг цуцлах боломжгүй.');
    }

    const item = await tx.orderItem.findFirst({
      where: { id: input.itemId, orderId: order.id },
      include: { round: { select: { id: true, closeAt: true, status: true } } },
    });
    if (!item) throw notFound('Захиалгын мөр олдсонгүй.');
    if (item.cancelledAt) throw conflict('Энэ мөр аль хэдийн цуцлагдсан байна.');

    const lineTotal = item.unitPrice * item.qty;

    await tx.orderItem.update({
      where: { id: item.id },
      data: { cancelledAt: new Date(), cancelReason: input.reason ?? null },
    });

    // Бэлэн бараа байсан бол үлдэгдлийг тухайн тойрогт нь буцаана.
    if (item.round && item.round.closeAt === null) {
      await tx.productRound.update({
        where: { id: item.roundId },
        data: {
          stock: { increment: item.qty },
          // Дууссан гэж хаагдсан байсан бол дахин зарагдах боломжтой болно.
          ...(item.round.status === 'SOLD_OUT' ? { status: 'ACTIVE' as const } : {}),
        },
      });
    }

    let refunded = 0;
    if (input.refund && lineTotal > 0) {
      const before = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        select: { subtotal: true, deliveryFee: true, storageFee: true, cargoFee: true, paidAmount: true, refundedAmount: true },
      });
      // Цэвэр орлогоос хэтрэхгүй хэмжээгээр л буцаана.
      const refundable = Math.min(lineTotal, computeTotals(before).netPaid);
      if (refundable > 0) {
        await tx.payment.create({
          data: {
            orderId: order.id,
            kind: 'REFUND',
            amount: refundable,
            method: 'BANK_TRANSFER',
            note: `Мөр цуцлагдсан: ${item.nameSnapshot}`,
            actor: input.actor,
          },
        });
        refunded = refundable;
      }
    }

    const remaining = await tx.orderItem.count({
      where: { orderId: order.id, cancelledAt: null },
    });

    let orderCancelled = false;
    if (remaining === 0 && order.status !== 'CANCELLED') {
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      orderCancelled = true;
    } else {
      await syncOrderCargoFee(tx, order.id);
    }

    const totals = await recalcOrderTotals(tx, order.id);

    await audit(
      {
        actor: input.actor,
        action: 'ITEM_CANCELLED',
        entity: 'Order',
        entityId: order.id,
        before: { item: item.nameSnapshot, qty: item.qty, lineTotal },
        after: {
          reason: input.reason,
          refunded,
          remainingItems: remaining,
          orderCancelled,
          dueAmount: totals.dueAmount,
        },
      },
      tx,
    );

    return { totals, orderCancelled, refunded };
  });

  return result;
}

/** Захиалгын төлбөрийн дэвтэр. */
export async function listPayments(orderId: string): Promise<Payment[]> {
  return prisma.payment.findMany({
    where: { orderId },
    orderBy: { createdAt: 'asc' },
  });
}

export function serializePayment(payment: Payment) {
  return {
    id: payment.id,
    kind: payment.kind,
    amount: payment.amount,
    /** Дэвтэрт харагдах чиглэлтэй дүн. */
    signedAmount: payment.kind === 'REFUND' ? -payment.amount : payment.amount,
    method: payment.method,
    reference: payment.reference,
    note: payment.note,
    actor: payment.actor,
    createdAt: payment.createdAt.toISOString(),
  };
}

/** Tx дотроос дуудахад зориулсан хувилбар — захиалга үүсгэх урсгалд хэрэглэнэ. */
export async function recordPaymentInTx(tx: Tx, input: RecordPaymentInput): Promise<Payment> {
  return tx.payment.create({
    data: {
      orderId: input.orderId,
      kind: input.kind,
      amount: input.amount,
      method: input.method ?? 'BANK_TRANSFER',
      reference: input.reference ?? null,
      note: input.note ?? null,
      actor: input.actor,
    },
  });
}
