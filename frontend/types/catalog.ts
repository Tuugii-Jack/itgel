import type { BatchStage, InventoryOwnerKind, OrderStatus, PaymentState, ProductStatus } from "./common";
import type { BankAccount } from "./payments";

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
  kind?: string;
  value?: string;
  /** Хослол — ж: { Материал: "A", Хэмжээ: "2cm" }. */
  selections?: Record<string, string>;
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
  /** Гаргалт дээрх сонголтын үнэ — хослол бүрт өөр байж болно. */
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
  ownerKind?: InventoryOwnerKind;
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
  ownerKind?: InventoryOwnerKind;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
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
  /** Лизингийн тусдаа QPay account. */
  leasingQpay?: { enabled: boolean; ready: boolean };
  leasingBank?: BankAccount | null;
  /** Мөнгө ороогүй захиалга хэдэн цагийн дараа цуцлагдах. 0 = цуцлахгүй. */
  unpaidCancelHours: number;
  /** Агуулахад ирснээс хойш үнэгүй хадгалах хоног. */
  storageFreeDays: number;
  /** Үнэгүй хоногоос хойш хоног бүрийн хураамж ₮. 0 = унтраана. */
  storageFeePerDay: number;
  leasing?: {
    feeTiers: { minAmount: number; ratePercent: number }[];
    payGaps?: number[];
    choiceHint: string;
    termsTitle: string;
    termsBody: string;
  };
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
