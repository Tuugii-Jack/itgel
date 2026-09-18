import type { Prisma } from '@prisma/client';
import { serializeLeasing } from '../../lib/leasing.js';
import { profitOf } from '../../lib/money.js';
import {
  computeTotals,
  PAYMENT_STATE_LABEL,
  paymentState,
} from '../../services/money.js';
import { buildTimeline } from './timeline.js';
import {
  adminOrderItem,
  batchSummary,
  orderStatusLabel,
  publicDelivery,
} from '../../services/serialize.js';

export type AdminOrderDetailRecord = Prisma.OrderGetPayload<{
  include: {
    customer: true;
    items: { include: { product: true } };
    batch: true;
    delivery: true;
  };
}>;

export function adminOrderDetail(order: AdminOrderDetailRecord, payGaps?: number[] | null) {
  // Цуцлагдсан мөр ашгийн тооцоонд ордоггүй.
  const activeItems = order.items.filter((i) => i.cancelledAt === null);
  const totals = computeTotals(order);
  const state = paymentState(totals);

  return {
    id: order.id,
    code: order.code,
    status: order.status,
    statusLabel: orderStatusLabel(order.status),
    customer: {
      id: order.customer.id,
      name: order.customer.name?.trim() || null,
      phone: order.customer.phone,
      email: order.customer.email,
    },
    items: order.items.map(adminOrderItem),
    subtotal: order.subtotal,
    deliveryFee: totals.deliveryFee,
    storageFee: order.storageFee,
    cargoFee: order.cargoFee,
    cargoPayMethod: order.cargoPayMethod,
    paidAmount: order.paidAmount,
    refundedAmount: order.refundedAmount,
    dueAmount: order.dueAmount,
    total: totals.total,
    netPaid: totals.netPaid,
    paymentState: state,
    paymentStateLabel: PAYMENT_STATE_LABEL[state],
    payeeKind: order.payeeKind,
    writtenOffAmount: order.writtenOffAmount,
    debtClosedAt: order.debtClosedAt?.toISOString() ?? null,
    debtCloseReason: order.debtCloseReason,
    isResale: order.payeeKind === 'LEASING' && !order.isLeasing,
    ...serializeLeasing(order, payGaps),
    paymentClaimedAt: order.paymentClaimedAt?.toISOString() ?? null,
    qpayInvoiceId: order.qpayInvoiceId,
    qpayInvoiceAt: order.qpayInvoiceAt?.toISOString() ?? null,
    profit: profitOf(activeItems),
    fulfilment: order.fulfilment,
    note: order.note,
    batch: batchSummary(order.batch),
    delivery: publicDelivery(order.delivery),
    timeline: buildTimeline(order),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
