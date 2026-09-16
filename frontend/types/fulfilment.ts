import type { DeliveryStatus, OrderStatus } from "./common";
import type { OrderItem } from "./orders";

export interface Slot {
  day: string;
  capacity: number;
  used: number;
  remaining: number;
  available: boolean;
}

/** Админ хүлээлгэн өгөх — хэрэглэгчийн бүх мөр. */
export interface HandoverCustomerItem extends OrderItem {
  costPriceSnapshot: number;
  profit: number;
  cancelledAt: string | null;
  cancelReason: string | null;
  orderId: string;
  orderCode: string;
  orderStatus: OrderStatus;
  orderStatusLabel: string;
  dueAmount: number;
  shopDueAmount?: number;
  storageFee: number;
  deliveryFee: number;
  paidAmount: number;
  subtotal: number;
  canPick: boolean;
  isLeasing?: boolean;
  leasingDueAmount?: number;
}

export interface HandoverOrderDue {
  orderId: string;
  code: string;
  status: OrderStatus;
  statusLabel: string;
  subtotal: number;
  deliveryFee: number;
  storageFee: number;
  cargoFee?: number;
  paidAmount: number;
  dueAmount: number;
  isLeasing?: boolean;
  shopDueAmount?: number;
  leasingDueAmount?: number;
}

export interface HandoverCustomer {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  totals: {
    items: number;
    waiting: number;
    arrived: number;
    handedOver: number;
    /** Дэлгүүрийн кассанд авах нийлбэр (лизингийн үлдэгдэл орохгүй). */
    dueAmount: number;
    shopDueAmount?: number;
    leasingDueAmount?: number;
  };
  /** Захиалга бүрийн төлбөрийн задаргаа. */
  orders: HandoverOrderDue[];
  items: HandoverCustomerItem[];
}

/** Хүлээлгэн өгөх үед авсан үлдэгдэл. */
export type HandoverPayMethod = "CASH" | "CARD" | "BANK_TRANSFER";

export interface HandoverHistoryItem {
  name: string;
  selections: Record<string, string>;
  size: string | null;
  color: string | null;
  qty: number;
}

export interface HandoverHistoryRow {
  customerId: string;
  name: string | null;
  phone: string | null;
  at: string;
  orderCodes: string[];
  items: HandoverHistoryItem[];
  cash: number;
  card: number;
  bank: number;
}

export interface HandoverHistoryDay {
  date: string;
  itemCount: number;
  customerCount: number;
  cash: number;
  card: number;
  bank: number;
  rows: HandoverHistoryRow[];
}

export interface HandoverHistory {
  year: number;
  month: number;
  days: HandoverHistoryDay[];
  summary: {
    itemCount: number;
    customerCount: number;
    cash: number;
    card: number;
    bank: number;
  };
}

export interface AdminDeliveryItem {
  name: string;
  qty: number;
  selections: Record<string, string>;
  size: string | null;
  color: string | null;
}

export interface AdminDelivery {
  id: string;
  scheduledDay: string;
  district: string;
  khoroo: string | null;
  addressText: string | null;
  courierName: string | null;
  status: DeliveryStatus;
  order: {
    id: string;
    code: string;
    status: OrderStatus;
    dueAmount: number;
    cargoFee?: number;
    note: string | null;
    customer: { name: string | null; phone: string | null };
    items: AdminDeliveryItem[];
  };
}

export interface DeliveryHistoryDistrict {
  name: string;
  count: number;
  delivered: number;
}

export interface DeliveryHistoryCourier {
  name: string;
  count: number;
  delivered: number;
}

export interface DeliveryHistoryDay {
  date: string;
  total: number;
  pending: number;
  assigned: number;
  delivered: number;
  districts: DeliveryHistoryDistrict[];
  couriers: DeliveryHistoryCourier[];
}

export interface DeliveryHistory {
  year: number;
  month: number;
  days: DeliveryHistoryDay[];
  summary: {
    total: number;
    pending: number;
    assigned: number;
    delivered: number;
  };
}
