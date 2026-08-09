// Backend-ийн хариултын хэлбэрүүд (backend/openapi.yaml-тай нийцнэ).

export type ProductStatus =
  | "ACTIVE"
  | "HIDDEN"
  | "DRAFT"
  | "CLOSED"
  | "SOLD_OUT"
  | "ARCHIVED";

export type OrderStatus =
  | "NEW"
  | "CONFIRMED"
  | "IN_BATCH"
  | "IN_TRANSIT"
  | "ARRIVED"
  | "HANDED_OVER"
  | "CANCELLED";

export type BatchStage =
  | "COLLECTING"
  | "CLOSED"
  | "AT_SUPPLIER"
  | "IN_TRANSIT"
  | "AT_WAREHOUSE"
  | "DONE";

export type Fulfilment = "PICKUP" | "DELIVERY";
export type DeliveryStatus = "PENDING" | "ASSIGNED" | "DELIVERED";

export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  productCount: number;
}

export interface SizeChartRow {
  id?: string;
  size: string;
  heightRange: string;
  chestCm: string;
}

/** Хэрэглэгчийн API — costPrice энд хэзээ ч байхгүй. */
export interface Product {
  id: string;
  name: string;
  description: string | null;
  categoryId: string;
  category?: { id: string; name: string };
  price: number;
  stock: number;
  type: "order" | "ready";
  status: ProductStatus;
  closeAt: string | null;
  leadMinDays: number;
  leadMaxDays: number;
  arriveFrom: string;
  arriveTo: string;
  images: string[];
  sizes: string[];
  colors: string[];
  sizeChart: SizeChartRow[];
  createdAt: string;
}

export interface AdminProduct extends Omit<Product, "price"> {
  costPrice: number;
  sellPrice: number;
  profit: number;
  marginPercent: number;
  updatedAt: string;
  deletedAt: string | null;
}

export interface OrderItem {
  id: string;
  productId: string;
  name: string;
  size: string | null;
  color: string | null;
  qty: number;
  unitPrice: number;
  total: number;
}

export interface TimelineStep {
  key:
    | "placed"
    | "confirmed"
    | "sent_to_supplier"
    | "in_transit"
    | "arrived"
    | "handed_over"
    | "cancelled";
  label: string;
  status: "done" | "current" | "pending";
  at: string | null;
  estimatedAt: string | null;
}

export interface DeliveryInfo {
  scheduledDay: string;
  district: string;
  khoroo: string | null;
  addressText: string | null;
  fee: number;
  status: DeliveryStatus;
  courierName: string | null;
}

export interface BatchSummary {
  id: string;
  name: string;
  stage: BatchStage;
  stageLabel: string;
  closedAt: string | null;
  weightKg: number | null;
  etaFrom: string | null;
  etaTo: string | null;
}

export interface PublicOrder {
  code: string;
  status: OrderStatus;
  statusLabel: string;
  subtotal: number;
  paidAmount: number;
  dueAmount: number;
  deliveryFee: number;
  fulfilment: Fulfilment | null;
  canChooseFulfilment: boolean;
  createdAt: string;
  customer: { name: string | null; phone: string };
  items: OrderItem[];
  batch: BatchSummary | null;
  delivery: DeliveryInfo | null;
  timeline: TimelineStep[];
}

export interface MyOrder {
  code: string;
  status: OrderStatus;
  statusLabel: string;
  subtotal: number;
  paidAmount: number;
  dueAmount: number;
  deliveryFee: number;
  fulfilment: Fulfilment | null;
  canChooseFulfilment: boolean;
  itemCount: number;
  items: OrderItem[];
  delivery: DeliveryInfo | null;
  timeline: TimelineStep[];
  createdAt: string;
  handedOverAt: string | null;
}

export interface Me {
  id: string;
  phone: string;
  name: string | null;
  address: {
    district: string | null;
    khoroo: string | null;
    addressText: string | null;
  };
  notifications: { payment: boolean; arrival: boolean; promo: boolean };
  createdAt: string;
}

export interface Store {
  storeName: string;
  phone: string;
  address: string;
  workHours: string;
  facebookUrl: string;
  depositPercent: number;
  deliveryFees: { district: string; fee: number }[];
}

export interface Slot {
  day: string;
  capacity: number;
  used: number;
  remaining: number;
  available: boolean;
}

export interface CreatedOrder {
  code: string;
  status: OrderStatus;
  statusLabel: string;
  subtotal: number;
  payNow: number;
  dueAmount: number;
  depositPercent: number;
  createdAt: string;
}

export interface PageMeta {
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

// --- Админ ---

export interface AdminOrderRow {
  id: string;
  code: string;
  status: OrderStatus;
  statusLabel: string;
  customer: { id: string; name: string | null; phone: string };
  itemCount: number;
  subtotal: number;
  paidAmount: number;
  dueAmount: number;
  deliveryFee: number;
  profit: number;
  fulfilment: Fulfilment | null;
  batch: BatchSummary | null;
  createdAt: string;
}

export interface AdminOrderDetail extends Omit<AdminOrderRow, "itemCount"> {
  items: (OrderItem & { costPriceSnapshot: number; profit: number })[];
  note: string | null;
  delivery: DeliveryInfo | null;
  timeline: TimelineStep[];
  updatedAt: string;
}

export interface AdminBatch extends BatchSummary {
  orderCount: number;
  totalValue: number;
  nextStage: BatchStage | null;
  createdAt: string;
}

export interface AdminDelivery {
  id: string;
  scheduledDay: string;
  district: string;
  khoroo: string | null;
  addressText: string | null;
  fee: number;
  courierName: string | null;
  status: DeliveryStatus;
  order: {
    id: string;
    code: string;
    status: OrderStatus;
    dueAmount: number;
    customer: { name: string | null; phone: string };
  };
}

export interface AdminCustomer {
  id: string;
  phone: string;
  name: string | null;
  orderCount: number;
  totalSpent: number;
  lastOrderAt: string | null;
  createdAt: string;
}

export interface AdminCategory {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  productCount: number;
  createdAt: string;
}

export interface Ad {
  id: string;
  title: string;
  imageUrl: string;
  linkUrl: string | null;
}

export interface AdminAd extends Ad {
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface RevenueReport {
  period: "3m" | "6m" | "1y";
  series: {
    month: string;
    revenue: number;
    profit: number;
    orders: number;
    items: number;
    marginPercent: number;
  }[];
  totals: {
    revenue: number;
    profit: number;
    orders: number;
    marginPercent: number;
    averageOrderValue: number;
  };
}

export interface ProductReportRow {
  productId: string;
  name: string;
  category: string | null;
  qty: number;
  revenue: number;
  profit: number;
  costPrice: number;
  sellPrice: number;
  marginPercent: number;
}

export interface Settings {
  id: number;
  storeName: string;
  phone: string;
  address: string;
  workHours: string;
  facebookUrl: string;
  depositPercent: number;
  defaultLeadMinDays: number;
  defaultLeadMaxDays: number;
  smsOnArrival: boolean;
  autoCloseOnDeadline: boolean;
  deliveryFees: Record<string, number>;
  deliveryDailyLimit: number;
  updatedAt: string;
}

export interface AdminSummary {
  newOrders: number;
  inTransit: number;
  arrived: number;
  pendingDeliveries: number;
  activeProducts: number;
}
