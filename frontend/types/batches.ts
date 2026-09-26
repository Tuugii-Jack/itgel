import type { BatchStage, OrderStatus, PaymentState, ProductStatus } from "./common";

export type BatchProgress = "in_transit" | "partial" | "complete" | "mismatch";

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
  cargoRef?: string | null;
}

export interface AdminBatch extends BatchSummary {
  orderCount: number;
  /** Order.batchId дээрх захиалсан ширхэг. */
  orderedQty?: number;
  /** Тойрог нь энэ багцад холбогдсон ширхэг. */
  linkedQty?: number;
  /** Захиалсан боловч тойрог нь энэ багцад биш. */
  unlinkedQty?: number;
  arrivedQty?: number;
  remainingQty?: number;
  progress?: BatchProgress;
  progressLabel?: string;
  totalValue: number;
  nextStage: BatchStage | null;
  previousStage?: BatchStage | null;
  createdAt: string;
}

export interface BatchListSummary {
  in_transit: number;
  partial: number;
  complete: number;
  mismatch: number;
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
  arrivedPieces?: number;
  handedOverPieces?: number;
  warehouseArrived?: boolean;
  notified?: boolean;
  handedOver?: boolean;
  handedOverPartial?: boolean;
  customer: { id: string; name: string | null; phone: string | null };
  arrivalNotifiedAt?: string | null;
  arrivalSmsStatus?: string | null;
  arrivalSmsError?: string | null;
  arrivalSmsEligible?: boolean;
  createdAt: string;
}

export interface BatchArrivalNote {
  id: string;
  roundId: string;
  kind: "DAMAGED" | "SHORT" | "EXCESS" | string;
  qty: number;
  note: string;
  actor: string;
  createdAt: string;
  selections: Record<string, string> | unknown;
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
  orderedQty?: number;
  linkedQty?: number;
  unlinkedQty?: number;
  arrivedQty?: number;
  remainingQty?: number;
  progress?: BatchProgress;
  progressLabel?: string;
  createdAt: string;
  arrivalNotes?: BatchArrivalNote[];
}

export interface ArrivalPreviewOrder {
  orderId: string;
  code: string;
  add: number;
  remainingAfter: number;
  fullyArrived: boolean;
}

export interface ArrivalPreviewLine {
  roundId: string;
  selections: Record<string, string>;
  label: string;
  currentArrived: number;
  orderedQty: number;
  addQty: number;
  allocations: ArrivalPreviewOrder[];
  stillWaiting: { orderId: string; code: string; remaining: number }[];
}

export interface ArrivalPreview {
  fifoNote: string;
  lines: ArrivalPreviewLine[];
  expected: { roundId: string; selections: Record<string, string>; arrivedQty: number }[];
}

export interface ArrivalSmsPreviewRecipient {
  orderId: string;
  code: string;
  name: string | null;
  phone: string;
  text: string;
  chars?: number;
  segments?: number;
}

export interface ArrivalSmsPreview {
  sender?: string | null;
  channel?: "shop" | "leasing";
  recipients: ArrivalSmsPreviewRecipient[];
  skipped: { orderId: string; code: string; reason: string }[];
  previewToken?: string;
}

export interface BatchAuditRow {
  id: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}
