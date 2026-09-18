import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { conflict, notFound } from '../lib/errors.js';
import { leasingFeeOf, leasingFeeSnapshot, leasingView } from '../lib/leasing.js';
import { getSettingsCached, leasingTiersOf } from './settings.js';

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
  /** Лизингийн шимтгэл (10%). Энгийн захиалгад 0. */
  leasingFee: number;
  /** Нийт төлөх ёстой дүн. */
  total: number;
  paidAmount: number;
  refundedAmount: number;
  /** Цэвэр орлого: төлсөн − буцаасан. */
  netPaid: number;
  /** Үлдсэн өрийн хаалт — Payment мөр биш. */
  writtenOffAmount: number;
  /** total − netPaid − writtenOffAmount. Сөрөг бол илүү төлсөн байна. */
  dueAmount: number;
}

/** Захиалгын дүнг дэвтэр ба мөрүүдээс дахин бодож, кэшийг шинэчилнэ. */
export async function recalcOrderTotals(tx: Tx, orderId: string): Promise<OrderTotals> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      storageFee: true,
      cargoFee: true,
      isLeasing: true,
      leasingFee: true,
      subtotal: true,
      writtenOffAmount: true,
    },
  });
  if (!order) throw notFound('Захиалга олдсонгүй.');

  const [items, payments] = await Promise.all([
    tx.orderItem.findMany({
      where: { orderId, cancelledAt: null },
      select: { qty: true, unitPrice: true },
    }),
    tx.payment.groupBy({
      by: ['kind', 'payeeKind'],
      where: { orderId },
      _sum: { amount: true },
    }),
  ]);

  const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
  const paidAmount = payments
    .filter((p) => p.kind === 'PAYMENT')
    .reduce((sum, p) => sum + (p._sum.amount ?? 0), 0);
  const refundedAmount = payments
    .filter((p) => p.kind === 'REFUND')
    .reduce((sum, p) => sum + (p._sum.amount ?? 0), 0);
  const shopPaidAmount = Math.max(
    0,
    payments
      .filter((p) => p.kind === 'PAYMENT' && p.payeeKind === 'SHOP')
      .reduce((sum, p) => sum + (p._sum.amount ?? 0), 0) -
      payments
        .filter((p) => p.kind === 'REFUND' && p.payeeKind === 'SHOP')
        .reduce((sum, p) => sum + (p._sum.amount ?? 0), 0),
  );
  let leasingFee = 0;
  if (order.isLeasing) {
    if (order.subtotal > 0 && order.leasingFee > 0) {
      leasingFee = leasingFeeSnapshot({
        isLeasing: true,
        previousSubtotal: order.subtotal,
        previousFee: order.leasingFee,
        nextSubtotal: subtotal,
        fallbackFee: 0,
      });
    } else {
      leasingFee = leasingFeeOf(subtotal, leasingTiersOf(await getSettingsCached()));
    }
  }

  const totals = computeTotals({
    subtotal,
    storageFee: order.storageFee,
    cargoFee: order.cargoFee,
    leasingFee,
    paidAmount,
    refundedAmount,
    writtenOffAmount: order.writtenOffAmount,
  });

  await tx.order.update({
    where: { id: orderId },
    data: {
      subtotal: totals.subtotal,
      leasingFee: totals.leasingFee,
      paidAmount: totals.paidAmount,
      shopPaidAmount,
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
  leasingFee?: number;
  paidAmount: number;
  refundedAmount: number;
  writtenOffAmount?: number;
}): OrderTotals {
  const storageFee = input.storageFee ?? 0;
  const cargoFee = input.cargoFee ?? 0;
  const leasingFee = input.leasingFee ?? 0;
  const writtenOffAmount = Math.max(0, input.writtenOffAmount ?? 0);
  const total = input.subtotal + leasingFee + storageFee + cargoFee;
  const netPaid = input.paidAmount - input.refundedAmount;
  return {
    subtotal: input.subtotal,
    deliveryFee: 0,
    storageFee,
    cargoFee,
    leasingFee,
    total,
    paidAmount: input.paidAmount,
    refundedAmount: input.refundedAmount,
    netPaid,
    writtenOffAmount,
    dueAmount: total - netPaid - writtenOffAmount,
  };
}

export type PaymentState = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERPAID' | 'REFUNDED' | 'WRITTEN_OFF';

/**
 * Төлбөрийн байдал — хадгалагдахгүй, дүнгээс гарна.
 * Мөнгө орсон эсэхээр л шийднэ: 1₮ ч орсон бол «хэсэгчилсэн».
 */
export function paymentState(totals: OrderTotals): PaymentState {
  if (totals.netPaid <= 0) return totals.refundedAmount > 0 ? 'REFUNDED' : 'UNPAID';
  if (totals.dueAmount < 0) return 'OVERPAID';
  if (totals.writtenOffAmount > 0 && totals.dueAmount === 0 && totals.netPaid < totals.total) {
    return 'WRITTEN_OFF';
  }
  if (totals.dueAmount === 0) return 'PAID';
  return 'PARTIAL';
}

/** Баталгаажуулах босго: энгийн захиалгад барааны 100%, лизингт шимтгэл (10%). */
export function confirmThreshold(totals: {
  subtotal: number;
  leasingFee?: number;
}): number {
  return (totals.leasingFee ?? 0) > 0 ? totals.leasingFee! : totals.subtotal;
}

/** Захиалга баталгаажих болзол: бараа бүрэн төлөгдсөн байх (карго/агуулах хамаарахгүй). */
export function fullyPaid(totals: OrderTotals): boolean {
  return totals.netPaid >= confirmThreshold(totals);
}

/** Барааны үнэ төлөгдсөн эсэх — карго/агуулахын үлдэгдэл энд хамаарахгүй. */
export function isProductPaid(order: {
  subtotal: number;
  paidAmount: number;
  refundedAmount: number;
  leasingFee?: number | null;
}): boolean {
  const net = order.paidAmount - order.refundedAmount;
  if ((order.leasingFee ?? 0) > 0) return net >= order.leasingFee!;
  return net >= order.subtotal;
}

/**
 * Каргоноос үлдсэн төлбөр. Бараа, агуулахын дараа үлдсэн цэвэр орлогоос бодно.
 * Хүргэлтээр авахад энэ дүн > 0 бол карго төлүүлэх ёстой.
 */
export function unpaidCargoFee(input: {
  subtotal: number;
  storageFee?: number;
  cargoFee?: number;
  leasingFee?: number;
  paidAmount: number;
  refundedAmount: number;
  shopPaidAmount?: number | null;
}): number {
  const cargoFee = Math.max(0, input.cargoFee ?? 0);
  if (cargoFee <= 0) return 0;
  return Math.min(cargoFee, shopDueAmount(input));
}

type ShopDueInput = {
  isLeasing?: boolean | null;
  payeeKind?: string | null;
  subtotal: number;
  leasingFee?: number | null;
  storageFee?: number | null;
  cargoFee?: number | null;
  paidAmount: number;
  refundedAmount: number;
  writtenOffAmount?: number | null;
  shopPaidAmount?: number | null;
};

/**
 * Дэлгүүрийн кассанд авах дүн.
 * Лизингт бараа + 10% нь өөр данс тул энд зөвхөн карго/агуулах үлдэнэ.
 * Энгийн захиалгад нийт үлдэгдэлтэй ижил (сөрөгийг 0 болгоно).
 */
export function shopDueAmount(input: ShopDueInput): number {
  if (input.payeeKind === 'LEASING' && !Boolean(input.isLeasing)) return 0;
  const storageFee = Math.max(0, input.storageFee ?? 0);
  const cargoFee = Math.max(0, input.cargoFee ?? 0);
  const leasingFee = Math.max(0, input.leasingFee ?? 0);
  const netPaid = input.paidAmount - input.refundedAmount;
  const leasing = Boolean(input.isLeasing) || leasingFee > 0;
  if (!leasing) {
    return Math.max(0, input.subtotal + storageFee + cargoFee - netPaid - (input.writtenOffAmount ?? 0));
  }
  const shopPaid = Math.max(0, input.shopPaidAmount ?? 0);
  const leftoverToShop = Math.max(0, netPaid - shopPaid - leasingFee - input.subtotal);
  return Math.max(0, storageFee + cargoFee - shopPaid - leftoverToShop);
}

/** Лизингийн дансны үлдэгдэл (шимтгэл + үндсэн). Дэлгүүрийн кассанд оруулахгүй. */
export function leasingAccountDue(input: ShopDueInput): number {
  if (input.payeeKind === 'LEASING' && !Boolean(input.isLeasing) && !(input.leasingFee ?? 0)) {
    return Math.max(0, computeTotals({
      subtotal: input.subtotal,
      storageFee: input.storageFee ?? 0,
      cargoFee: input.cargoFee ?? 0,
      leasingFee: 0,
      paidAmount: input.paidAmount,
      refundedAmount: input.refundedAmount,
      writtenOffAmount: input.writtenOffAmount ?? 0,
    }).dueAmount);
  }
  if (!Boolean(input.isLeasing) && !(input.leasingFee ?? 0)) return 0;
  const view = leasingView(input);
  return view.feeDue + view.principalDue;
}

export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = {
  UNPAID: 'Төлөгдөөгүй',
  PARTIAL: 'Хэсэгчилсэн',
  PAID: 'Бүрэн төлсөн',
  OVERPAID: 'Илүү төлсөн',
  REFUNDED: 'Буцаасан',
  WRITTEN_OFF: 'Өр хаасан',
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
      leasingFee: true,
      paidAmount: true,
      refundedAmount: true,
      writtenOffAmount: true,
    },
  });
  if (!order) throw notFound('Захиалга олдсонгүй.');
  return computeTotals(order);
}
