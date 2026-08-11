import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { conflict, notFound } from '../lib/errors.js';

/**
 * Захиалгын мөнгөн дүнгийн цорын ганц эх сурвалж.
 *
 * Дүрэм: `Payment` дэвтэр ба идэвхтэй `OrderItem` мөрүүд нь ҮНЭН.
 * `Order` дээрх subtotal/paidAmount/refundedAmount/dueAmount багана нь
 * зөвхөн хайлт, эрэмбэлэлтэд зориулсан КЭШ бөгөөд энэ функцээр л
 * шинэчлэгдэнэ. Мөр цуцлах, төлбөр бүртгэх, хүргэлт нэмэх — юу ч
 * өөрчлөгдсөн бол энэ функцийг дуудна.
 */

type Tx = Prisma.TransactionClient;

export interface OrderTotals {
  subtotal: number;
  deliveryFee: number;
  storageFee: number;
  /** Нийт төлөх ёстой дүн. */
  total: number;
  paidAmount: number;
  refundedAmount: number;
  /** Цэвэр орлого: төлсөн − буцаасан. */
  netPaid: number;
  /** total − netPaid. Сөрөг бол илүү төлсөн байна. */
  dueAmount: number;
}

/** Захиалгын дүнг дэвтэр ба мөрүүдээс дахин бодож, кэшийг шинэчилнэ. */
export async function recalcOrderTotals(tx: Tx, orderId: string): Promise<OrderTotals> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, deliveryFee: true, storageFee: true },
  });
  if (!order) throw notFound('Захиалга олдсонгүй.');

  const [items, payments] = await Promise.all([
    tx.orderItem.findMany({
      where: { orderId, cancelledAt: null },
      select: { qty: true, unitPrice: true },
    }),
    tx.payment.groupBy({
      by: ['kind'],
      where: { orderId },
      _sum: { amount: true },
    }),
  ]);

  const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
  const paidAmount = payments.find((p) => p.kind === 'PAYMENT')?._sum.amount ?? 0;
  const refundedAmount = payments.find((p) => p.kind === 'REFUND')?._sum.amount ?? 0;

  const totals = computeTotals({
    subtotal,
    deliveryFee: order.deliveryFee,
    storageFee: order.storageFee,
    paidAmount,
    refundedAmount,
  });

  await tx.order.update({
    where: { id: orderId },
    data: {
      subtotal: totals.subtotal,
      paidAmount: totals.paidAmount,
      refundedAmount: totals.refundedAmount,
      dueAmount: totals.dueAmount,
    },
  });

  return totals;
}

/** Цэвэр тооцоо — өгөгдлийн сангаас хамааралгүй тул тестлэхэд хялбар. */
export function computeTotals(input: {
  subtotal: number;
  deliveryFee: number;
  storageFee?: number;
  paidAmount: number;
  refundedAmount: number;
}): OrderTotals {
  const storageFee = input.storageFee ?? 0;
  const total = input.subtotal + input.deliveryFee + storageFee;
  const netPaid = input.paidAmount - input.refundedAmount;
  return {
    subtotal: input.subtotal,
    deliveryFee: input.deliveryFee,
    storageFee,
    total,
    paidAmount: input.paidAmount,
    refundedAmount: input.refundedAmount,
    netPaid,
    dueAmount: total - netPaid,
  };
}

export type PaymentState = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERPAID' | 'REFUNDED';

/**
 * Төлбөрийн байдал — хадгалагдахгүй, дүнгээс гарна.
 * Мөнгө орсон эсэхээр л шийднэ: 1₮ ч орсон бол «хэсэгчилсэн».
 */
export function paymentState(totals: OrderTotals): PaymentState {
  if (totals.netPaid <= 0) return totals.refundedAmount > 0 ? 'REFUNDED' : 'UNPAID';
  if (totals.dueAmount < 0) return 'OVERPAID';
  if (totals.dueAmount === 0) return 'PAID';
  return 'PARTIAL';
}

/** Захиалга баталгаажих болзол: бараа бүрэн төлөгдсөн байх. */
export function fullyPaid(totals: OrderTotals): boolean {
  return totals.netPaid >= totals.subtotal;
}

export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = {
  UNPAID: 'Төлөгдөөгүй',
  PARTIAL: 'Хэсэгчилсэн',
  PAID: 'Бүрэн төлсөн',
  OVERPAID: 'Илүү төлсөн',
  REFUNDED: 'Буцаасан',
};

/** Буцаалт нь цэвэр орлогоос хэтрэхгүй байх. */
export function assertRefundable(totals: OrderTotals, amount: number): void {
  if (amount <= 0) throw conflict('Буцаах дүн 0-ээс их байх ёстой.');
  if (amount > totals.netPaid) {
    throw conflict(
      `Буцаах дүн цэвэр орлогоос хэтэрсэн. Боломжит дээд хэмжээ: ${totals.netPaid}₮.`,
      { maxRefundable: totals.netPaid },
    );
  }
}

/** Захиалгын одоогийн дүнг уншина. */
export async function loadOrderTotals(orderId: string): Promise<OrderTotals> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      subtotal: true,
      deliveryFee: true,
      storageFee: true,
      paidAmount: true,
      refundedAmount: true,
    },
  });
  if (!order) throw notFound('Захиалга олдсонгүй.');
  return computeTotals(order);
}
