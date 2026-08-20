import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { conflict, notFound } from '../lib/errors.js';

/**
 * Захиалгын мөнгөн дүнгийн цорын ганц эх сурвалж.
 *
 * Дүрэм: `Payment` дэвтэр ба идэвхтэй `OrderItem` мөрүүд нь ҮНЭН.
 * `Order` дээрх subtotal/paidAmount/refundedAmount/dueAmount багана нь
 * зөвхөн хайлт, эрэмбэлэлтэд зориулсан КЭШ бөгөөд энэ функцээр л
 * шинэчлэгдэнэ. Мөр цуцлах, төлбөр бүртгэх, карго нэмэх — юу ч
 * өөрчлөгдсөн бол энэ функцийг дуудна.
 *
 * Хүргэлтийн төлбөрийг дэлгүүр авдаггүй (хүргэлтийн компани өөрөө авна)
 * тул `deliveryFee` нийт дүнд ордоггүй.
 */

type Tx = Pick<Prisma.TransactionClient, 'order' | 'orderItem' | 'payment'>;

export interface OrderTotals {
  subtotal: number;
  deliveryFee: number;
  storageFee: number;
  cargoFee: number;
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
    select: { id: true, storageFee: true, cargoFee: true },
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
    storageFee: order.storageFee,
    cargoFee: order.cargoFee,
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
  /** Хүргэлтийн компани авна — нийт дүнд тооцохгүй. */
  deliveryFee?: number;
  storageFee?: number;
  cargoFee?: number;
  paidAmount: number;
  refundedAmount: number;
}): OrderTotals {
  const storageFee = input.storageFee ?? 0;
  const cargoFee = input.cargoFee ?? 0;
  const total = input.subtotal + storageFee + cargoFee;
  const netPaid = input.paidAmount - input.refundedAmount;
  return {
    subtotal: input.subtotal,
    deliveryFee: 0,
    storageFee,
    cargoFee,
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

/** Захиалга баталгаажих болзол: бараа бүрэн төлөгдсөн байх (карго/агуулах хамаарахгүй). */
export function fullyPaid(totals: OrderTotals): boolean {
  return totals.netPaid >= totals.subtotal;
}

/** Барааны үнэ төлөгдсөн эсэх — карго/агуулахын үлдэгдэл энд хамаарахгүй. */
export function isProductPaid(order: {
  subtotal: number;
  paidAmount: number;
  refundedAmount: number;
}): boolean {
  return order.paidAmount - order.refundedAmount >= order.subtotal;
}

/**
 * Каргоноос үлдсэн төлбөр. Бараа, агуулахын дараа үлдсэн цэвэр орлогоос бодно.
 * Хүргэлтээр авахад энэ дүн > 0 бол карго төлүүлэх ёстой.
 */
export function unpaidCargoFee(input: {
  subtotal: number;
  storageFee?: number;
  cargoFee?: number;
  paidAmount: number;
  refundedAmount: number;
}): number {
  const cargoFee = Math.max(0, input.cargoFee ?? 0);
  if (cargoFee <= 0) return 0;
  const netPaid = input.paidAmount - input.refundedAmount;
  const towardCargo = Math.max(0, netPaid - input.subtotal - (input.storageFee ?? 0));
  return Math.max(0, cargoFee - towardCargo);
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
      storageFee: true,
      cargoFee: true,
      paidAmount: true,
      refundedAmount: true,
    },
  });
  if (!order) throw notFound('Захиалга олдсонгүй.');
  return computeTotals(order);
}
