import type { PaymentState } from "./common";

export type PaymentKind = "PAYMENT" | "REFUND";

export type PaymentMethod =
  | "BANK_TRANSFER"
  | "CASH"
  | "CARD"
  | "QPAY"
  | "OTHER"
  | "LEASING";

export interface Payment {
  id: string;
  kind: PaymentKind;
  amount: number;
  /** Дэвтэрт харагдах чиглэлтэй дүн — буцаалт сөрөг. */
  signedAmount: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  actor: string;
  createdAt: string;
}

export interface OrderTotals {
  subtotal: number;
  deliveryFee: number;
  storageFee: number;
  cargoFee: number;
  /** Лизингийн шимтгэл. Энгийн захиалгад 0. */
  leasingFee?: number;
  total: number;
  paidAmount: number;
  refundedAmount: number;
  /** Төлсөн − буцаасан. */
  netPaid: number;
  /** Сөрөг бол илүү төлсөн. */
  dueAmount: number;
  unallocatedPaid?: number;
  unallocatedRefunded?: number;
}

export interface PaymentLedger {
  payments: Payment[];
  totals: OrderTotals;
  paymentState: PaymentState;
  paymentStateLabel: string;
  maxRefundable: number;
  mixedOwnership?: boolean;
  attributedMoney?: boolean;
}

/** Төлбөр хүлээн авах данс. Админ тохируулаагүй бол `null`. */
export interface BankAccount {
  name: string;
  accountNumber: string;
  accountName: string;
  note: string;
}

/** QPay нэхэмжлэл — QR + банкны deeplink. */
export interface QpayBankLink {
  name: string;
  description: string;
  logo: string | null;
  link: string;
}

export interface QpayInvoice {
  invoiceId: string;
  qrText: string;
  qrImage: string | null;
  shortUrl: string | null;
  urls: QpayBankLink[];
  amount: number;
  createdAt: string | null;
}

export interface AdminQpayStatus {
  enabled: boolean;
  ready: boolean;
}

export interface AdminOrderQpay extends AdminQpayStatus {
  invoiceId: string | null;
  invoiceAt: string | null;
  dueAmount: number;
  paidAmount: number;
  orderCode: string;
  account?: "shop" | "leasing";
}

export interface QpayPaymentRow {
  paymentId: string;
  invoiceId: string | null;
  status: string | null;
  amount: number;
  currency: string | null;
  wallet: string | null;
  type: string | null;
  date: string | null;
}

export interface QpayCheckResult {
  paid: boolean;
  paidAmount: number;
  paymentIds: string[];
  invoiceId?: string;
  recorded?: boolean;
}
