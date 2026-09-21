export type SettlementDisplayStatus =
  | "UNPAID"
  | "PARTIAL"
  | "QPAY_PENDING"
  | "BANK_PENDING"
  | "PAID"
  | "VOID";

export type SettlementLine = {
  id: string;
  ownerAdminId: string | null;
  ownerName: string | null;
  orderId: string;
  orderItemId: string | null;
  orderCode: string;
  orderCodeSnapshot: string;
  customerId: string;
  customerName: string;
  customerNameSnapshot: string;
  customerPhone: string | null;
  productName: string;
  sku: string;
  qty: number;
  unitPrice: number;
  amount: number;
  confirmedAt: string;
  day: string;
  status: string;
  displayStatus: SettlementDisplayStatus;
  statusLabel: string;
  paidAmount: number;
  remainingAmount: number;
  readyTransferId: string | null;
  lockPaymentId: string | null;
  selectable: boolean;
  lockedReason: string | null;
  mismatch: {
    orderMissing: boolean;
    itemMissing: boolean;
    orderCode: boolean;
    qty: boolean;
    unitPrice: boolean;
    ledger: boolean;
  };
};

export type SettlementInvoice = {
  invoiceId: string;
  qrText: string;
  qrImage: string | null;
  urls: { name: string; description: string; logo: string | null; link: string }[];
  amount: number;
};

export type SettlementPayment = {
  id: string;
  ownerAdminId: string;
  ownerName: string | null;
  method: string;
  amount: number;
  status: string;
  qpayInvoiceId: string | null;
  invoice: SettlementInvoice | null;
  invoicePending: boolean;
  invoiceUncertain?: boolean;
  bankRef: string | null;
  bankDate: string | null;
  receiptUrl: string | null;
  claimedBy: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  confirmedAtSource?: string | null;
  confirmedAtKnown?: boolean;
  rejectedReason: string | null;
  note: string | null;
  createdAt: string;
  lines: { amount: number; settlement: SettlementLine }[];
};

export type SettlementSummary = {
  day: string;
  totalUnpaidRemaining: number;
  totalUnpaidCount: number;
  createdOnDayAmount: number;
  createdOnDayCount: number;
  createdOnDayOrders: number;
  paidOnDayAmount: number;
  paidOnDayCount: number;
  paidUnknownAmount?: number;
  paidUnknownCount?: number;
  pendingBankAmount: number;
  pendingBankCount: number;
  pendingQpayAmount: number;
  pendingQpayCount: number;
  orderCount: number;
  lineCount: number;
  amount: number;
  paidAmount: number;
  remainingAmount: number;
  priorUnpaidAmount: number;
  priorUnpaidCount: number;
  unassignedOrderCount?: number;
  unassignedAmount?: number;
  lines: SettlementLine[];
  unpaidTodayIds: string[];
};

export type SettlementPreview = {
  ownerAdminId: string;
  amount: number;
  remainingTotal: number;
  allocations: {
    settlementId: string;
    orderId: string;
    orderCode: string;
    productName: string;
    remainingAmount: number;
    amount: number;
  }[];
};

export type SettlementPayResult = {
  payment: { id: string; amount: number; status: string; method: string; qpayInvoiceId: string | null };
  invoice: SettlementInvoice | null;
  invoicePending?: boolean;
};

export type SettlementListPage = {
  rows: SettlementLine[];
  nextCursor: string | null;
  totals: { count: number; remainingAmount: number; amount: number; paidAmount: number };
};

export type SettlementPaymentPage = {
  rows: SettlementPayment[];
  nextCursor: string | null;
  totals: { count: number; amount: number };
};

export type SettlementOperator = { id: string; name: string; email: string; isActive?: boolean };

export const DISPLAY_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Бүх төлөв" },
  { value: "UNPAID", label: "Төлөөгүй" },
  { value: "PARTIAL", label: "Хэсэгчлэн төлсөн" },
  { value: "QPAY_PENDING", label: "QPay хүлээгдэж байна" },
  { value: "BANK_PENDING", label: "Дансны баталгаа хүлээж байна" },
  { value: "PAID", label: "Төлсөн" },
];
