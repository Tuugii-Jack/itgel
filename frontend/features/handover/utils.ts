import { printHandoverReceipt, type HandoverReceiptStore } from "@/lib/handoverReceipt";
import { leasingAccountDue, shopDueOf } from "@/lib/leasing";
import type {
  AdminOrderDetail,
  HandoverCustomer,
  HandoverCustomerItem,
  HandoverHistoryDay,
  HandoverPayMethod,
} from "@/lib/types";
import { PAY_METHOD_KEY } from "./constants";

export type Found = AdminOrderDetail & {
  canHandOver: boolean;
  blockReason: string | null;
  pickableItemIds?: string[];
};

export function readPayMethod(): HandoverPayMethod | null {
  if (typeof window === "undefined") return null;
  const v = window.sessionStorage.getItem(PAY_METHOD_KEY);
  if (v === "CASH" || v === "CARD" || v === "BANK_TRANSFER") return v;
  return null;
}

export function writePayMethod(value: HandoverPayMethod) {
  window.sessionStorage.setItem(PAY_METHOD_KEY, value);
}

export function isReceiptItem(item: {
  cancelled?: boolean;
  canPick?: boolean;
  fulfilment?: "PICKUP" | "DELIVERY" | null;
  itemStatus: HandoverCustomerItem["itemStatus"] | AdminOrderDetail["items"][number]["itemStatus"];
}): boolean {
  if (item.cancelled) return false;
  if (item.fulfilment === "DELIVERY" && item.itemStatus !== "handed_over") return false;
  return item.canPick === true || item.itemStatus === "arrived" || item.itemStatus === "handed_over";
}

export function isCheckableItem(item: HandoverCustomerItem): boolean {
  return item.canPick || item.itemStatus === "handed_over";
}

export function selectableItemIds(items: HandoverCustomerItem[]): string[] {
  const pickable = items.filter((i) => i.canPick).map((i) => i.id);
  if (pickable.length > 0) return pickable;
  return items.filter((i) => i.itemStatus === "handed_over").map((i) => i.id);
}

export type DueOrderLine = {
  code: string;
  dueAmount: number;
  shopDueAmount?: number;
  leasingDueAmount?: number;
  isLeasing?: boolean;
  subtotal: number;
  deliveryFee: number;
  storageFee: number;
  cargoFee?: number;
  paidAmount: number;
};

export function lineShopDue(o: DueOrderLine): number {
  return shopDueOf(o);
}

export function lineLeasingDue(o: DueOrderLine): number {
  return leasingAccountDue(o);
}

export function paySub(method: HandoverPayMethod | null): string {
  if (method === "CARD") return "картаар авч, хүлээлгэн өгөх";
  if (method === "BANK_TRANSFER") return "дансаар авч, хүлээлгэн өгөх";
  if (method === "CASH") return "бэлэн авч, хүлээлгэн өгөх";
  return "авч, хүлээлгэн өгөх";
}

export function printHistoryRow(
  row: HandoverHistoryDay["rows"][number],
  store?: HandoverReceiptStore,
) {
  if (row.items.length === 0) {
    throw new Error("Хэвлэх бараа байхгүй.");
  }
  printHandoverReceipt({
    customerName: row.name,
    customerPhone: row.phone,
    orderCodes: row.orderCodes,
    items: row.items.map((item) => ({
      orderCode: row.orderCodes[0] ?? "",
      name: item.name,
      selections: item.selections,
      size: item.size,
      color: item.color,
      qty: item.qty,
    })),
    cashTaken: row.cash,
    cardTaken: row.card,
    bankTaken: row.bank,
    store,
    issuedAt: row.at,
  });
}

export function printCustomerReceipt(
  customer: HandoverCustomer,
  items: HandoverCustomerItem[],
  dueForSelected: number,
  payMethod: HandoverPayMethod | null,
  store?: HandoverReceiptStore,
) {
  printHandoverReceipt({
    customerName: customer.name,
    customerPhone: customer.phone,
    items: items.map((item) => ({
      orderCode: item.orderCode,
      name: item.name,
      selections: item.selections,
      size: item.size,
      color: item.color,
      qty: item.qty,
      unitPrice: item.unitPrice,
    })),
    collectedAmount: dueForSelected > 0 ? dueForSelected : 0,
    collectedMethod: payMethod ?? undefined,
    store,
  });
}

export function printFoundOrderReceipt(
  found: Found,
  items: Found["items"],
  payMethod: HandoverPayMethod | null,
  store?: HandoverReceiptStore,
) {
  printHandoverReceipt({
    customerName: found.customer.name,
    customerPhone: found.customer.phone,
    items: items.map((item) => ({
      orderCode: found.code,
      name: item.name,
      selections: item.selections,
      size: item.size,
      color: item.color,
      qty: item.qty,
      unitPrice: item.unitPrice,
    })),
    collectedAmount: shopDueOf(found) > 0 ? shopDueOf(found) : 0,
    collectedMethod: payMethod ?? undefined,
    store,
  });
}
