// Нийтлэг enum / meta — backend/openapi.yaml-тай нийцнэ.

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
  | "REFUNDED"
  | "WRITTEN_OFF";

export type InventoryOwnerKind = "SHOP" | "LEASING";

export type DeliveryStatus = "PENDING" | "ASSIGNED" | "DELIVERED";

export interface PageMeta {
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}
