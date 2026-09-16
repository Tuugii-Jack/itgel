import type { BatchStage, OrderStatus, PaymentState, ProductStatus } from "./common";

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
  /** Сонголтын нэгж карго ₮. */
  cargoFee?: number;
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
  customer: { id: string; name: string | null; phone: string | null };
  arrivalNotifiedAt?: string | null;
  arrivalSmsEligible?: boolean;
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
