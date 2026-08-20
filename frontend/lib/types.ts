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
export type CargoPayMethod = "CASH" | "QPAY";

/** Мөнгө орсон эсэхээр тодорхойлогдоно — дэвтрээс бодогдоно. */
export type PaymentState =
  | "UNPAID"
  | "PARTIAL"
  | "PAID"
  | "OVERPAID"
  | "REFUNDED";

export type PaymentKind = "PAYMENT" | "REFUND";
export type PaymentMethod =
  | "BANK_TRANSFER"
  | "CASH"
  | "CARD"
  | "QPAY"
  | "OTHER";

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
  total: number;
  paidAmount: number;
  refundedAmount: number;
  /** Төлсөн − буцаасан. */
  netPaid: number;
  /** Сөрөг бол илүү төлсөн. */
  dueAmount: number;
}

export interface PaymentLedger {
  payments: Payment[];
  totals: OrderTotals;
  paymentState: PaymentState;
  paymentStateLabel: string;
  maxRefundable: number;
}
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

/** Барааны сонголтын бүлэг — ж: Хэмжээ [S,M,L], Багтаамж [128GB]. */
export interface ProductOption {
  name: string;
  values: string[];
}

export interface OptionPrice {
  kind: string;
  value: string;
  price: number;
  sellPrice?: number;
  costPrice?: number;
}

/** Нэг хослол — ж: Хар + XL + Хөвөн. */
export interface SkuStock {
  selections: Record<string, string>;
  stock: number;
}

/**
 * Хэрэглэгчийн API — costPrice энд хэзээ ч байхгүй.
 *
 * `id` нь ТОЙРГИЙН id: дэлгүүрт захиалагдах нэгж нь барааны нэг гаргалт.
 * Нэг барааг дахин гаргавал шинэ `id`-тай шинэ мөр үүснэ, харин `productId`
 * нь хэвээрээ — ингэж хуучин тойргийн үнэ, огноо хөндөгдөхгүй үлддэг.
 */
export interface Product {
  id: string;
  /** Барааны (загварын) id — тойргуудыг нэгтгэхэд. */
  productId: string;
  /** Хэддэх удаагийн гаргалт бэ. */
  roundNo: number;
  name: string;
  description: string | null;
  categoryId: string;
  category?: { id: string; name: string };
  price: number;
  /** Сонголтын үнэ ялгаатай бол хамгийн их. `price`-тай тэнцүү бол нэг үнэ. */
  priceMax?: number;
  /** Гаргалт дээрх сонголтын үнэ — ж: Хэмжээ S = 10000. */
  optionPrices?: OptionPrice[];
  /** Бэлэн барааны хослол бүрийн үлдэгдэл. */
  skuStocks?: SkuStock[];
  stock: number;
  type: "order" | "ready";
  status: ProductStatus;
  closeAt: string | null;
  leadMinDays: number;
  leadMaxDays: number;
  arriveFrom: string;
  arriveTo: string;
  images: string[];
  options: ProductOption[];
  /** Нийцүүлэлт — options-оос «Хэмжээ»/«Өнгө». */
  sizes: string[];
  colors: string[];
  sizeChart: SizeChartRow[];
  createdAt: string;
}

/** Админ талын нэг тойрог — үнэ, ашиг, төлөв энд байна. */
export interface AdminRound extends Omit<Product, "price"> {
  price: number;
  costPrice: number;
  sellPrice: number;
  profit: number;
  marginPercent: number;
  note: string | null;
  /** Аль ачааны багцад зориулж гаргасан бэ — null бол багцаас гадуур. */
  batchId: string | null;
  batch: {
    id: string;
    name: string;
    stage: BatchStage;
    stageLabel: string;
  } | null;
  /** Энэ гаргалтыг хэдэн өөр хүн авсан бэ. */
  customerCount: number;
  /** Захиалагдсан нийт ширхэг (цуцлагдсаныг оруулаагүй). */
  orderedQty: number;
  updatedAt: string;
  deletedAt: string | null;
}

/** Нэг гаргалтыг хэн хэн авсан бэ — GET /admin/rounds/:id/orders. */
export interface RoundBuyer {
  orderId: string;
  code: string;
  status: OrderStatus;
  statusLabel: string;
  paymentState: PaymentState;
  dueAmount: number;
  paymentClaimedAt: string | null;
  createdAt: string;
  customer: {
    id: string;
    name: string | null;
    phone: string | null;
    email?: string | null;
  };
  selections: Record<string, string>;
  size: string | null;
  color: string | null;
  qty: number;
  unitPrice: number;
  total: number;
  cancelled: boolean;
  cancelReason: string | null;
}

export interface RoundOrders {
  round: {
    id: string;
    roundNo: number;
    productId: string;
    name: string;
    sellPrice: number;
    costPrice: number;
    status: ProductStatus;
    closeAt: string | null;
    createdAt?: string;
    closed?: boolean;
    daysOpen?: number | null;
    daysSinceClose?: number | null;
  };
  summary: {
    customerCount: number;
    orderCount: number;
    qty: number;
    revenue: number;
    profit: number;
    unpaidCount: number;
    cancelledCount: number;
    byStatus: Partial<Record<OrderStatus, number>>;
    /** Нийлүүлэгч рүү захиалах жагсаалт — сонголтоор. */
    byVariant: {
      selections?: Record<string, string>;
      size: string | null;
      color: string | null;
      qty: number;
    }[];
    /** Хэмжээ, өнгө гэх мэт бүлэг бүрээр. */
    byKind?: { kind: string; rows: { value: string; qty: number }[] }[];
  };
  orders: RoundBuyer[];
}

/** GET /admin/orders/by-product — захиалгыг бараагаар. */
export interface OrdersByProductRow {
  roundId: string;
  roundNo: number;
  productId: string;
  name: string;
  image: string | null;
  status: ProductStatus;
  closed: boolean;
  closeAt: string | null;
  createdAt: string;
  daysOpen: number | null;
  daysSinceClose: number | null;
  sellPrice: number;
  customerCount: number;
  orderCount: number;
  qty: number;
  revenue: number;
  byKind: { kind: string; rows: { value: string; qty: number }[] }[];
  byVariant: {
    selections: Record<string, string>;
    size: string | null;
    color: string | null;
    qty: number;
  }[];
}

export interface OrdersByProductDate {
  date: string;
  year: number;
  month: number;
  day: number;
  count: number;
}

/**
 * Барааны загвар — нэр, зураг, сонголт. Үнэ, төлөв нь тойрог дээр байна.
 */
export interface AdminProduct {
  id: string;
  name: string;
  description: string | null;
  categoryId: string;
  category?: { id: string; name: string };
  images: string[];
  options: ProductOption[];
  sizes: string[];
  colors: string[];
  sizeChart: SizeChartRow[];
  rounds: AdminRound[];
  roundCount: number;
  /** Одоо зарагдаж буй тойрог, байхгүй бол хамгийн сүүлийнх. */
  currentRound: AdminRound | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

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
  /** Захиалах үед амласан огноо — тойрог дахин гарсан ч хөдлөхгүй. */
  arriveFrom: string | null;
  arriveTo: string | null;
  arrivedAt?: string | null;
  cancelledAt?: string | null;
  handedOverAt: string | null;
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

export interface BatchSummary {
  id: string;
  name: string;
  stage: BatchStage;
  stageLabel: string;
  /** Захиалга авах эцсийн хугацаа — багцын бараануудын closeAt анхдагч. */
  deadline: string | null;
  closedAt: string | null;
  weightKg: number | null;
  etaFrom: string | null;
  etaTo: string | null;
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

export interface Me {
  id: string;
  email: string;
  phone: string | null;
  name: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  address: {
    district: string | null;
    khoroo: string | null;
    addressText: string | null;
  };
  notifications: { payment: boolean; arrival: boolean; promo: boolean };
  bank: {
    name: string;
    accountNumber: string;
    accountName: string;
    defaultPayout: boolean;
  };
  createdAt: string;
}

/** Төлбөр хүлээн авах данс. Админ тохируулаагүй бол `null`. */
export interface BankAccount {
  name: string;
  accountNumber: string;
  accountName: string;
  note: string;
}

export interface Store {
  storeName: string;
  phone: string;
  address: string;
  workHours: string;
  facebookUrl: string;
  deliveryDistricts?: string[];
  deliveryFees: { district: string; fee: number }[];
  bank: BankAccount | null;
  /** QPay — enabled=flag, ready=credential бэлэн (код ирсний дараа). */
  qpay: { enabled: boolean; ready: boolean };
  /** Мөнгө ороогүй захиалга хэдэн цагийн дараа цуцлагдах. 0 = цуцлахгүй. */
  unpaidCancelHours: number;
  /** Агуулахад ирснээс хойш үнэгүй хадгалах хоног. */
  storageFreeDays: number;
  /** Үнэгүй хоногоос хойш хоног бүрийн хураамж ₮. 0 = унтраана. */
  storageFeePerDay: number;
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
  /** Шилжүүлэх дүн — төлбөр үргэлж 100%. */
  dueAmount: number;
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
  customer: {
    id: string;
    name: string | null;
    phone: string | null;
    email?: string;
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
  paymentState: PaymentState;
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
  storageFee: number;
  deliveryFee: number;
  paidAmount: number;
  subtotal: number;
  canPick: boolean;
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
}

export interface HandoverCustomer {
  id: string;
  name: string | null;
  phone: string | null;
  email: string;
  totals: {
    items: number;
    waiting: number;
    arrived: number;
    handedOver: number;
    /** Бүх захиалгын төлбөрийн үлдэгдлийн нийлбэр. */
    dueAmount: number;
  };
  /** Захиалга бүрийн төлбөрийн задаргаа. */
  orders: HandoverOrderDue[];
  items: HandoverCustomerItem[];
}

/** Хүлээлгэн өгөх үед авсан үлдэгдэл — карт/данс нэг сагс. */
export type HandoverPayMethod = "CASH" | "CARD";

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
}

export interface HandoverHistoryDay {
  date: string;
  itemCount: number;
  customerCount: number;
  cash: number;
  card: number;
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
  };
}

export interface AdminBatch extends BatchSummary {
  orderCount: number;
  totalValue: number;
  nextStage: BatchStage | null;
  previousStage?: BatchStage | null;
  createdAt: string;
}

/** Багцад зориулж гаргасан нэг бараа (тойрог). */
export interface BatchProduct {
  roundId: string;
  roundNo: number;
  productId: string;
  name: string;
  image: string | null;
  sellPrice: number;
  costPrice: number;
  /** Нэгж карго үнэ ₮. */
  cargoFee: number;
  cargoTotal?: number;
  status: ProductStatus;
  closeAt: string | null;
  orderedQty: number;
  customerCount: number;
  /** Сонголт (өнгө/хэмжээ) бүрийн захиалсан vs ирсэн. */
  variants?: BatchArrivalVariant[];
}

export interface BatchArrivalVariant {
  key: string;
  selections: Record<string, string>;
  label: string;
  orderedQty: number;
  arrivedQty: number;
  remainingQty: number;
  waitingCustomers: number;
  handedOverQty?: number;
}

export interface BatchOrderRow {
  id: string;
  code: string;
  status: OrderStatus;
  statusLabel: string;
  subtotal: number;
  dueAmount: number;
  cargoFee?: number;
  paidAmount?: number;
  paymentState: PaymentState;
  paymentStateLabel: string;
  batchOmittedAt?: string | null;
  itemCount: number;
  customer: { id: string; name: string | null; phone: string };
  createdAt: string;
}

export interface AdminBatchDetail extends BatchSummary {
  nextStage: BatchStage | null;
  previousStage?: BatchStage | null;
  orders: BatchOrderRow[];
  omittedOrders: BatchOrderRow[];
  products: BatchProduct[];
  totalValue: number;
  totalCargo?: number;
  totalDue: number;
  createdAt: string;
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

export interface AdminCustomer {
  id: string;
  email: string;
  phone: string | null;
  name: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  address?: {
    district: string | null;
    khoroo: string | null;
    addressText: string | null;
  };
  bank?: {
    name: string;
    accountNumber: string;
    accountName: string;
    defaultPayout: boolean;
  };
  notifications?: {
    payment: boolean;
    arrival: boolean;
    promo: boolean;
  };
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
    sold: number;
    returned: number;
    net: number;
    orders: number;
    soldQty: number;
    returnedQty: number;
  }[];
  totals: {
    sold: number;
    returned: number;
    net: number;
    orders: number;
    soldQty: number;
    returnedQty: number;
  };
}

export interface ProductReportRow {
  productId: string;
  name: string;
  category: string | null;
  soldQty: number;
  soldAmount: number;
  returnedQty: number;
  returnedAmount: number;
  netQty: number;
  netAmount: number;
  sellPrice: number;
}

export interface Settings {
  id: number;
  storeName: string;
  phone: string;
  address: string;
  workHours: string;
  facebookUrl: string;
  defaultLeadMinDays: number;
  defaultLeadMaxDays: number;
  smsOnArrival: boolean;
  autoCloseOnDeadline: boolean;
  deliveryFees: Record<string, number>;
  deliveryDailyLimit: number;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  paymentNote: string;
  /** Мөнгө ороогүй захиалгыг хэдэн цагийн дараа цуцлах. 0 = цуцлахгүй. */
  unpaidCancelHours: number;
  storageFreeDays: number;
  storageFeePerDay: number;
  updatedAt: string;
}

/** Өөрчлөлтийн бүртгэл — GET /admin/settings/audit. */
export interface AuditLog {
  id: string;
  /** "admin:<id>" | "customer:<id>" | "system" */
  actor: string;
  /** CREATE | UPDATE | DELETE | STATUS_CHANGE | HANDOVER … */
  action: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface AdminSummary {
  newOrders: number;
  /** Хэрэглэгч шилжүүлсэн гэж мэдэгдсэн ч мөнгө нь ороогүй захиалгын тоо. */
  paymentClaims: number;
  inTransit: number;
  arrived: number;
  pendingDeliveries: number;
  activeProducts: number;
}

export interface AdminStaffUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "STAFF";
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
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
  email: string;
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
