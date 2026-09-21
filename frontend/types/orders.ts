import type {
  CargoPayMethod,
  DeliveryStatus,
  Fulfilment,
  InventoryOwnerKind,
  OrderStatus,
  PaymentState,
  ProductStatus,
} from "./common";
import type { BatchSummary } from "./batches";
import type { LeasingPayKind, LeasingPayPlan } from "./leasing";

export interface OrderItem {
  id: string;
  /** Хэсэгчилсэн цуцлалт — дүнд ордоггүй. */
  cancelled: boolean;
  productId: string;
  /** Аль тойргоос захиалсан бэ. */
  roundId: string;
  name: string;
  selections: Record<string, string>;
  size: string | null;
  color: string | null;
  qty: number;
  /** Хэсэгчилсэн ирэлт — 0..qty. Бүтэн ирэхэд itemStatus = arrived. */
  arrivedQty?: number;
  unitPrice: number;
  total: number;
  /** Мөрийн карго — тойргийн нэгж карго × ширхэг. Хүргэлтээр авахад төлнө. */
  cargoFee?: number;
  /** Захиалах үед амласан огноо — тойрог дахин гарсан ч хөдлөхгүй. */
  arriveFrom: string | null;
  arriveTo: string | null;
  arrivedAt?: string | null;
  cancelledAt?: string | null;
  handedOverAt: string | null;
  transferredAt?: string | null;
  transferredQty?: number;
  /** Ирсэн мөр бүрийн авах арга — захиалгад хольж болно. */
  fulfilment?: Fulfilment | null;
  /** waiting | arrived | handed_over | cancelled */
  itemStatus: "waiting" | "arrived" | "handed_over" | "cancelled";
  /** Сар бүрийн 10/20/30 — YYYY-MM-DD. Цуцлаагүй бол null. */
  refundPayoutOn?: string | null;
  /** Админ данс руу шилжүүлснийг баталгаажуулсан. */
  refundPaid?: boolean;
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

export interface StorageInfo {
  freeDays: number;
  feePerDay: number;
  /** Идэвхтэй ирсэн барааны үнэгүй үлдсэн хоног (хамгийн бага). */
  freeDaysLeft: number | null;
  billableItemDays: number;
  fee: number;
}

export interface PublicOrder {
  code: string;
  status: OrderStatus;
  statusLabel: string;
  subtotal: number;
  deliveryFee: number;
  storageFee: number;
  cargoFee: number;
  cargoPayMethod: CargoPayMethod | null;
  storage?: StorageInfo;
  paidAmount: number;
  refundedAmount: number;
  dueAmount: number;
  paymentState: PaymentState;
  payeeKind?: InventoryOwnerKind;
  writtenOffAmount?: number;
  debtClosedAt?: string | null;
  isLeasing?: boolean;
  leasingFee?: number;
  leasingFeePaid?: boolean;
  leasingFeePaidAmount?: number;
  leasingPrincipalPaid?: number;
  leasingPrincipalDue?: number;
  nextPayAmount?: number;
  nextPayKind?: LeasingPayKind;
  payPlan?: LeasingPayPlan | null;
  shopDueAmount?: number;
  unpaidCargoFee?: number;
  contact?: {
    kind: "SHOP" | "LEASING";
    title: string;
    phone: string | null;
    chatUrl: string | null;
  };
  /** Хэрэглэгч "шилжүүлсэн" гэж мэдэгдсэн огноо. Төлбөр орсны баталгаа биш. */
  paymentClaimedAt: string | null;
  fulfilment: Fulfilment | null;
  canChooseFulfilment: boolean;
  createdAt: string;
  customer: { name: string | null; phone: string | null; email?: string };
  items: OrderItem[];
  /** Захиалгын хамгийн ойрын буцаалтын 10/20/30. */
  refundPayoutOn?: string | null;
  /** Админ данс руу шилжүүлснийг баталгаажуулсан. */
  refundPaid?: boolean;
  batch: BatchSummary | null;
  delivery: DeliveryInfo | null;
  timeline: TimelineStep[];
}

export interface MyOrder {
  code: string;
  status: OrderStatus;
  statusLabel: string;
  subtotal: number;
  deliveryFee: number;
  storageFee: number;
  cargoFee: number;
  cargoPayMethod: CargoPayMethod | null;
  paidAmount: number;
  refundedAmount: number;
  dueAmount: number;
  paymentState: PaymentState;
  isLeasing?: boolean;
  leasingFee?: number;
  leasingFeePaid?: boolean;
  leasingPrincipalDue?: number;
  nextPayAmount?: number;
  nextPayKind?: LeasingPayKind;
  payPlan?: LeasingPayPlan | null;
  fulfilment: Fulfilment | null;
  canChooseFulfilment: boolean;
  itemCount: number;
  items: OrderItem[];
  refundPayoutOn?: string | null;
  refundPaid?: boolean;
  delivery: DeliveryInfo | null;
  timeline: TimelineStep[];
  createdAt: string;
  handedOverAt: string | null;
}

export interface CreatedOrder {
  code: string;
  status: OrderStatus;
  statusLabel: string;
  subtotal: number;
  /** Шилжүүлэх дүн — төлбөр үргэлж 100%. Лизингт эхлээд 10% шимтгэл. */
  dueAmount: number;
  isLeasing?: boolean;
  leasingFee?: number;
  payeeKind?: InventoryOwnerKind;
  createdAt: string;
  splitOrders?: CreatedOrder[];
}

export interface AdminOrderRow {
  id: string;
  code: string;
  status: OrderStatus;
  statusLabel: string;
  customer: {
    id: string;
    name: string | null;
    phone: string | null;
    email?: string | null;
  };
  itemCount: number;
  subtotal: number;
  deliveryFee: number;
  storageFee: number;
  cargoFee: number;
  cargoPayMethod?: CargoPayMethod | null;
  paidAmount: number;
  refundedAmount: number;
  dueAmount: number;
  shopDueAmount?: number;
  paymentState: PaymentState;
  isLeasing?: boolean;
  leasingFee?: number;
  leasingFeePaid?: boolean;
  leasingFeePaidAmount?: number;
  leasingPrincipalPaid?: number;
  leasingPrincipalDue?: number;
  leasingDueAmount?: number;
  nextPayAmount?: number;
  nextPayKind?: LeasingPayKind;
  payPlan?: LeasingPayPlan | null;
  payeeKind?: InventoryOwnerKind;
  writtenOffAmount?: number;
  debtClosedAt?: string | null;
  debtCloseReason?: string | null;
  mixedOwnership?: boolean;
  attributedMoney?: boolean;
  unallocatedPaid?: number;
  unallocatedRefunded?: number;
  isResale?: boolean;
  paymentClaimedAt: string | null;
  profit: number;
  fulfilment: Fulfilment | null;
  batch: BatchSummary | null;
  createdAt: string;
  deletedAt?: string | null;
  purgeAt?: string | null;
  /** Soft-delete-ээс хойш бүрмөсөн устгах хүртэл үлдсэн хоног. */
  daysLeft?: number | null;
}

export interface AdminOrderDetail extends Omit<AdminOrderRow, "itemCount"> {
  items: (OrderItem & {
    costPriceSnapshot: number;
    profit: number;
    cancelledAt: string | null;
    cancelReason: string | null;
    itgel?: {
      id: string;
      status: string;
      statusLabel: string;
      amount: number;
      paidAmount: number;
      remainingAmount: number;
      confirmedAt: string;
    } | null;
  })[];
  total: number;
  netPaid: number;
  paymentStateLabel: string;
  note: string | null;
  delivery: DeliveryInfo | null;
  timeline: TimelineStep[];
  updatedAt: string;
  qpayInvoiceId?: string | null;
  qpayInvoiceAt?: string | null;
}

// --- Архив: устгасан бичлэгийг ч агуулсан бүрэн түүх ---

export interface ArchiveItem {
  id: string;
  roundId: string;
  productId: string;
  name: string;
  selections?: Record<string, string>;
  size: string | null;
  color: string | null;
  qty: number;
  unitPrice: number;
  total: number;
  cancelled: boolean;
  cancelReason: string | null;
}

export interface ArchiveOrder {
  id: string;
  code: string;
  status: OrderStatus;
  statusLabel: string;
  createdAt: string;
  /** Захиалгыг устгасан ч архивт үлдэнэ. */
  deleted: boolean;
  customer: { id: string; name: string | null; phone: string };
  subtotal: number;
  paidAmount: number;
  refundedAmount: number;
  dueAmount: number;
  paymentState: PaymentState;
  batch: { id: string; name: string } | null;
  items: ArchiveItem[];
}

export interface ArchiveCalendar {
  year: number;
  month: number;
  days: { date: string; orders: number; revenue: number }[];
  total: number;
}

/** GET /admin/returns/calendar — захиалгын мөрөөр буцаасан өдрүүд. */
export interface ReturnsCalendar {
  year: number;
  month: number;
  days: {
    date: string;
    qty: number;
    itemCount: number;
    customerCount: number;
  }[];
}

/** GET /admin/returns — сонгосон өдрүүдийн нэгтгэл. */
export interface ReturnsList {
  days: string[];
  products: ReturnProduct[];
  payouts: ReturnPayout[];
  summary: {
    qty: number;
    amount: number;
    productCount: number;
    customerCount: number;
    unpaidCustomerCount?: number;
  };
}

export interface ReturnProduct {
  productId: string;
  name: string;
  selections: Record<string, string>;
  size: string | null;
  color: string | null;
  qty: number;
  amount: number;
  orderCount: number;
  customerCount: number;
}

export interface ReturnPayout {
  customerId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  amount: number;
  qty: number;
  orderCodes: string[];
  /** Админ данс руу шилжүүлснийг баталгаажуулсан. */
  paid: boolean;
  paidAt: string | null;
}

export interface ArchiveDay {
  date: string;
  summary: {
    orderCount: number;
    customerCount: number;
    qty: number;
    revenue: number;
    cancelledCount: number;
  };
  orders: ArchiveOrder[];
}

export interface ArchiveProduct {
  product: {
    id: string;
    name: string;
    category: string | null;
    images: string[];
    deleted: boolean;
    createdAt: string;
  };
  rounds: {
    id: string;
    roundNo: number;
    status: ProductStatus;
    deleted: boolean;
    sellPrice: number;
    costPrice: number;
    closeAt: string | null;
    createdAt: string;
    customerCount: number;
    qty: number;
    revenue: number;
  }[];
  summary: {
    roundCount: number;
    customerCount: number;
    orderCount: number;
    qty: number;
    revenue: number;
    profit: number;
  };
  buyers: (ArchiveItem & {
    roundNo: number | null;
    orderId: string;
    code: string;
    status: OrderStatus;
    statusLabel: string;
    orderDeleted: boolean;
    createdAt: string;
    customer: { id: string; name: string | null; phone: string };
  })[];
}

export interface ArchiveCustomer {
  customer: {
    id: string;
    name: string | null;
    phone: string;
    district: string | null;
    khoroo: string | null;
    addressText: string | null;
    createdAt: string;
  };
  summary: {
    orderCount: number;
    cancelledCount: number;
    qty: number;
    spent: number;
    dueTotal: number;
    firstOrderAt: string | null;
    lastOrderAt: string | null;
  };
  topProducts: {
    productId: string;
    name: string;
    qty: number;
    total: number;
  }[];
  orders: ArchiveOrder[];
}

export interface ArchiveSearch {
  products: {
    id: string;
    name: string;
    image: string | null;
    deleted: boolean;
    roundCount: number;
  }[];
  customers: {
    id: string;
    name: string | null;
    phone: string;
    orderCount: number;
  }[];
}
