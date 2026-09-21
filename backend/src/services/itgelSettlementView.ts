import type { Prisma } from '@prisma/client';
import { ubDateString } from '../lib/date.js';
import {
  formatSelectionsLabel,
  itemSelections,
} from '../lib/options.js';
import {
  paymentConfirmedAt,
  settlementDisplayLabel,
  settlementDisplayStatus,
  encodeTimeIdCursor,
  decodeTimeIdCursor,
  type SettlementDisplayStatus,
} from '../lib/settlementMoney.js';
import type { QpayInvoice } from '../integrations/qpay/client.js';

export type SettlementSerializeRow = {
  id: string;
  ownerAdminId?: string | null;
  sourceOrderId: string;
  sourceOrderCode: string;
  customerId: string;
  customerName: string;
  productName: string;
  qty: number;
  unitPrice: number;
  amount: number;
  confirmedAt: Date;
  status: string;
  paidAmount: number;
  remainingAmount: number;
  readyTransferId: string | null;
  lockPaymentId: string | null;
  ownerName?: string | null;
  sourceOrder?: {
    id: string;
    code: string;
    deletedAt: Date | null;
    customer?: { name: string | null; phone: string | null } | null;
  } | null;
  sourceOrderItem?: {
    id: string;
    nameSnapshot: string;
    qty: number;
    unitPrice: number;
    selections: unknown;
    size: string | null;
    color: string | null;
    cancelledAt: Date | null;
  } | null;
};

export const SETTLEMENT_LIVE_INCLUDE = {
  sourceOrder: {
    select: {
      id: true,
      code: true,
      deletedAt: true,
      customer: { select: { name: true, phone: true } },
    },
  },
  sourceOrderItem: {
    select: {
      id: true,
      nameSnapshot: true,
      qty: true,
      unitPrice: true,
      selections: true,
      size: true,
      color: true,
      cancelledAt: true,
    },
  },
} satisfies Prisma.ItgelSettlementInclude;

export function settlementStatusLabel(status: string): string {
  return settlementDisplayLabel(
    settlementDisplayStatus({ status, paidAmount: 0, remainingAmount: status === 'PAID' ? 0 : 1 }),
  );
}

export function serializeSettlement(row: SettlementSerializeRow) {
  const displayStatus = settlementDisplayStatus(row);
  const liveOrder = row.sourceOrder && !row.sourceOrder.deletedAt ? row.sourceOrder : null;
  const liveItem = row.sourceOrderItem ?? null;
  const sku =
    liveItem && formatSelectionsLabel(itemSelections(liveItem)) !== '—'
      ? formatSelectionsLabel(itemSelections(liveItem))
      : '';
  const liveOrderCode = liveOrder?.code ?? row.sourceOrderCode;
  const liveCustomerName = (liveOrder?.customer?.name ?? row.customerName).trim() || 'Нэргүй';
  const ledgerOk = row.amount === row.qty * row.unitPrice && row.paidAmount + row.remainingAmount === row.amount;
  return {
    id: row.id,
    ownerAdminId: row.ownerAdminId ?? null,
    ownerName: row.ownerName ?? null,
    orderId: row.sourceOrderId,
    orderItemId: liveItem?.id ?? null,
    orderCode: liveOrderCode,
    orderCodeSnapshot: row.sourceOrderCode,
    customerId: row.customerId,
    customerName: liveCustomerName,
    customerNameSnapshot: row.customerName,
    customerPhone: liveOrder?.customer?.phone ?? null,
    productName: row.productName,
    sku,
    qty: row.qty,
    unitPrice: row.unitPrice,
    amount: row.amount,
    confirmedAt: row.confirmedAt.toISOString(),
    day: ubDateString(row.confirmedAt),
    status: row.status,
    displayStatus,
    statusLabel: settlementDisplayLabel(displayStatus),
    paidAmount: row.paidAmount,
    remainingAmount: row.remainingAmount,
    readyTransferId: row.readyTransferId,
    lockPaymentId: row.lockPaymentId,
    selectable: displayStatus === 'UNPAID' || displayStatus === 'PARTIAL',
    lockedReason:
      displayStatus === 'QPAY_PENDING'
        ? 'QPay нэхэмжлэл хүлээгдэж байна.'
        : displayStatus === 'BANK_PENDING'
          ? 'Дансны баталгаа хүлээгдэж байна.'
          : null,
    mismatch: {
      orderMissing: !liveOrder,
      itemMissing: !liveItem,
      orderCode: Boolean(liveOrder && liveOrder.code !== row.sourceOrderCode),
      qty: Boolean(liveItem && liveItem.qty !== row.qty),
      unitPrice: Boolean(liveItem && liveItem.unitPrice !== row.unitPrice),
      ledger: !ledgerOk,
    },
  };
}

export function invoiceFromPayload(raw: unknown): QpayInvoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const invoiceId = typeof row.invoiceId === 'string' ? row.invoiceId : null;
  if (!invoiceId) return null;
  return {
    invoiceId,
    qrText: typeof row.qrText === 'string' ? row.qrText : '',
    qrImage: typeof row.qrImage === 'string' ? row.qrImage : null,
    shortUrl: typeof row.shortUrl === 'string' ? row.shortUrl : null,
    urls: Array.isArray(row.urls)
      ? row.urls.map((item) => {
          const url = item as Record<string, unknown>;
          return {
            name: typeof url.name === 'string' ? url.name : '',
            description: typeof url.description === 'string' ? url.description : '',
            logo: typeof url.logo === 'string' ? url.logo : null,
            link: typeof url.link === 'string' ? url.link : '',
          };
        })
      : [],
    amount: typeof row.amount === 'number' ? row.amount : 0,
  };
}

type PaymentRow = Prisma.ItgelSettlementPaymentGetPayload<{
  include: { lines: { include: { settlement: true } } };
}>;

export function serializeSettlementPayment(
  row: PaymentRow,
  extras?: { ownerName?: string | null; settlements?: Map<string, ReturnType<typeof serializeSettlement>> },
) {
  const confirmedAt = paymentConfirmedAt(row);
  const confirmedAtKnown = Boolean(confirmedAt);
  return {
    id: row.id,
    ownerAdminId: row.ownerAdminId,
    ownerName: extras?.ownerName ?? null,
    method: row.method,
    amount: row.amount,
    status: row.status,
    qpayInvoiceId: row.qpayInvoiceId,
    invoice: invoiceFromPayload(row.invoicePayload),
    invoicePending: row.status === 'PENDING' && row.method === 'QPAY' && !row.qpayInvoiceId,
    invoiceUncertain:
      row.status === 'PENDING' &&
      row.method === 'QPAY' &&
      !row.qpayInvoiceId &&
      Boolean(row.invoiceAttemptAt),
    bankRef: row.bankRef,
    bankDate: row.bankDate?.toISOString() ?? null,
    receiptUrl: row.receiptUrl,
    claimedBy: row.claimedBy,
    confirmedBy: row.confirmedBy,
    confirmedAt: confirmedAt?.toISOString() ?? null,
    confirmedAtSource: row.confirmedAtSource ?? null,
    confirmedAtKnown,
    rejectedReason: row.rejectedReason,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    lines: row.lines.map((line) => {
      const settlement =
        extras?.settlements?.get(line.settlementId) ?? serializeSettlement(line.settlement);
      return {
        amount: line.amount,
        settlement,
      };
    }),
  };
}

export function displayStatusWhere(
  display?: string,
): Prisma.ItgelSettlementWhereInput | undefined {
  if (!display) return undefined;
  const key = display.trim().toUpperCase() as SettlementDisplayStatus | 'OPEN' | 'INVOICED' | 'PENDING_BANK';
  if (key === 'UNPAID' || key === 'OPEN') {
    return { status: 'OPEN', paidAmount: 0, remainingAmount: { gt: 0 } };
  }
  if (key === 'PARTIAL') {
    return { status: 'OPEN', paidAmount: { gt: 0 }, remainingAmount: { gt: 0 } };
  }
  if (key === 'QPAY_PENDING' || key === 'INVOICED') return { status: 'INVOICED' };
  if (key === 'BANK_PENDING' || key === 'PENDING_BANK') return { status: 'PENDING_BANK' };
  if (key === 'PAID') return { status: 'PAID' };
  if (key === 'VOID') return { status: 'VOID' };
  return { status: display };
}
