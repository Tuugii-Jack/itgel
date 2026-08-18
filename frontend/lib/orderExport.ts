import { dayTimeLabel, money, phoneLabel, rangeLabel } from "@/lib/format";
import { formatPlaceLine } from "@/lib/locations";
import { formatSelections } from "@/lib/options";
import { PAYMENT_LABEL } from "@/lib/payment";
import { printHtml } from "@/lib/printHtml";
import type { AdminOrderDetail, OrderItem } from "@/lib/types";

const ITEM_STATUS_LABEL: Record<OrderItem["itemStatus"], string> = {
  waiting: "Хүлээж байна",
  arrived: "Ирсэн",
  handed_over: "Авсан",
  cancelled: "Цуцлагдсан",
};

const FULFILMENT_LABEL: Record<string, string> = {
  PICKUP: "Авч явах",
  DELIVERY: "Хүргэлт",
};

export type OrderExportLine = {
  orderCode: string;
  createdAt: string;
  statusLabel: string;
  paymentLabel: string;
  dueAmount: number;
  paidAmount: number;
  subtotal: number;
  deliveryFee: number;
  storageFee: number;
  cargoFee: number;
  fulfilment: string;
  batchName: string;
  note: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  deliveryAddress: string;
  productName: string;
  selections: string;
  size: string;
  color: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  itemStatus: string;
  arriveWindow: string;
  cancelReason: string;
};

export type OrderExportColumnKey = keyof OrderExportLine;
export type OrderExportGroup = "order" | "customer" | "item" | "money";

export type OrderExportColumn = {
  key: OrderExportColumnKey;
  label: string;
  group: OrderExportGroup;
};

export type OrderExportSelection = Record<OrderExportColumnKey, boolean>;

export const ORDER_EXPORT_GROUPS: { id: OrderExportGroup; label: string }[] = [
  { id: "order", label: "Захиалга" },
  { id: "customer", label: "Хэрэглэгч" },
  { id: "item", label: "Бараа" },
  { id: "money", label: "Дүн" },
];

export const ORDER_EXPORT_COLUMNS: OrderExportColumn[] = [
  { key: "orderCode", label: "Захиалгын код", group: "order" },
  { key: "createdAt", label: "Огноо", group: "order" },
  { key: "statusLabel", label: "Төлөв", group: "order" },
  { key: "paymentLabel", label: "Төлбөр", group: "order" },
  { key: "batchName", label: "Багц", group: "order" },
  { key: "note", label: "Тэмдэглэл", group: "order" },
  { key: "customerName", label: "Нэр", group: "customer" },
  { key: "customerPhone", label: "Утас", group: "customer" },
  { key: "customerEmail", label: "И-мэйл", group: "customer" },
  { key: "fulfilment", label: "Авах арга", group: "customer" },
  { key: "deliveryAddress", label: "Хаяг", group: "customer" },
  { key: "productName", label: "Бараа", group: "item" },
  { key: "selections", label: "Сонголт (төрөл/хэмжээ г.м.)", group: "item" },
  { key: "size", label: "Хэмжээ", group: "item" },
  { key: "color", label: "Өнгө", group: "item" },
  { key: "qty", label: "Тоо", group: "item" },
  { key: "unitPrice", label: "Нэгж үнэ", group: "item" },
  { key: "lineTotal", label: "Мөрийн дүн", group: "item" },
  { key: "itemStatus", label: "Мөрийн төлөв", group: "item" },
  { key: "arriveWindow", label: "Ирэх хугацаа", group: "item" },
  { key: "cancelReason", label: "Цуцлалтын шалтгаан", group: "item" },
  { key: "subtotal", label: "Нийт бараа", group: "money" },
  { key: "deliveryFee", label: "Хүргэлт", group: "money" },
  { key: "storageFee", label: "Агуулахын хураамж", group: "money" },
  { key: "cargoFee", label: "Карго", group: "money" },
  { key: "paidAmount", label: "Төлсөн", group: "money" },
  { key: "dueAmount", label: "Үлдэгдэл", group: "money" },
];

export const DEFAULT_ORDER_EXPORT_SELECTION: OrderExportSelection = Object.fromEntries(
  ORDER_EXPORT_COLUMNS.map((c) => [c.key, true]),
) as OrderExportSelection;

const STORAGE_KEY = "itgel.admin.orderExportColumns";

export function loadOrderExportSelection(): OrderExportSelection {
  const base = { ...DEFAULT_ORDER_EXPORT_SELECTION };
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const col of ORDER_EXPORT_COLUMNS) {
      const flag = parsed[col.key];
      if (typeof flag === "boolean") base[col.key] = flag;
    }
    return base;
  } catch {
    return base;
  }
}

export function saveOrderExportSelection(sel: OrderExportSelection) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sel));
  } catch {
    /* ignore quota / private mode */
  }
}

export function selectedOrderExportColumns(
  sel: OrderExportSelection,
): OrderExportColumn[] {
  return ORDER_EXPORT_COLUMNS.filter((c) => sel[c.key]);
}

function deliveryAddress(order: AdminOrderDetail): string {
  const d = order.delivery;
  if (!d) return "";
  return [formatPlaceLine(d.district, d.khoroo), d.addressText].filter(Boolean).join(", ");
}

function arriveWindow(item: OrderItem): string {
  if (item.arriveFrom && item.arriveTo) return rangeLabel(item.arriveFrom, item.arriveTo);
  if (item.arriveFrom) return dayTimeLabel(item.arriveFrom);
  return "";
}

/** Захиалга бүрийг мөр бүрт (line item) задална. */
export function flattenOrdersForExport(orders: AdminOrderDetail[]): OrderExportLine[] {
  const rows: OrderExportLine[] = [];
  for (const order of orders) {
    const base = {
      orderCode: order.code,
      createdAt: dayTimeLabel(order.createdAt),
      statusLabel: order.statusLabel,
      paymentLabel: order.paymentStateLabel ?? PAYMENT_LABEL[order.paymentState],
      dueAmount: order.dueAmount,
      paidAmount: order.paidAmount,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee ?? 0,
      storageFee: order.storageFee ?? 0,
      cargoFee: order.cargoFee ?? 0,
      fulfilment: order.fulfilment ? FULFILMENT_LABEL[order.fulfilment] ?? order.fulfilment : "",
      batchName: order.batch?.name ?? "",
      note: order.note ?? "",
      customerName: order.customer.name ?? "",
      customerPhone: phoneLabel(order.customer.phone),
      customerEmail: order.customer.email ?? "",
      deliveryAddress: deliveryAddress(order),
    };

    if (order.items.length === 0) {
      rows.push({
        ...base,
        productName: "",
        selections: "",
        size: "",
        color: "",
        qty: 0,
        unitPrice: 0,
        lineTotal: 0,
        itemStatus: "",
        arriveWindow: "",
        cancelReason: "",
      });
      continue;
    }

    for (const item of order.items) {
      rows.push({
        ...base,
        productName: item.name,
        selections: formatSelections(item.selections, item.size, item.color),
        size: item.size ?? item.selections?.["Хэмжээ"] ?? "",
        color: item.color ?? item.selections?.["Өнгө"] ?? "",
        qty: item.qty,
        unitPrice: item.unitPrice,
        lineTotal: item.total,
        itemStatus: ITEM_STATUS_LABEL[item.itemStatus] ?? item.itemStatus,
        arriveWindow: arriveWindow(item),
        cancelReason: item.cancelReason ?? "",
      });
    }
  }
  return rows;
}

function csvEscape(value: string | number): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Excel-д нээгдэх UTF-8 BOM CSV. */
export function downloadOrdersExcel(
  orders: AdminOrderDetail[],
  filename?: string,
  columns: OrderExportSelection = DEFAULT_ORDER_EXPORT_SELECTION,
) {
  const headers = selectedOrderExportColumns(columns);
  if (headers.length === 0) {
    throw new Error("Наад зах нь нэг талбар сонгоно уу.");
  }
  const rows = flattenOrdersForExport(orders);
  const header = headers.map((h) => csvEscape(h.label)).join(",");
  const body = rows
    .map((row) => headers.map((h) => csvEscape(row[h.key])).join(","))
    .join("\n");
  const bom = "\uFEFF";
  const blob = new Blob([bom + header + "\n" + body], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `zahialga-${dayKeySafe()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function dayKeySafe(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PRINT_ITEM_KEYS: OrderExportColumnKey[] = [
  "productName",
  "selections",
  "size",
  "color",
  "qty",
  "unitPrice",
  "lineTotal",
  "itemStatus",
  "arriveWindow",
  "cancelReason",
];

const MONEY_KEYS: OrderExportColumnKey[] = [
  "unitPrice",
  "lineTotal",
  "subtotal",
  "deliveryFee",
  "storageFee",
  "cargoFee",
  "paidAmount",
  "dueAmount",
];

function printItemCell(
  item: AdminOrderDetail["items"][number],
  key: OrderExportColumnKey,
): string {
  const values: Partial<Record<OrderExportColumnKey, string | number>> = {
    productName: item.name,
    selections: formatSelections(item.selections, item.size, item.color),
    size: item.size ?? item.selections?.["Хэмжээ"] ?? "",
    color: item.color ?? item.selections?.["Өнгө"] ?? "",
    qty: item.qty,
    unitPrice: item.unitPrice,
    lineTotal: item.total,
    itemStatus: ITEM_STATUS_LABEL[item.itemStatus] ?? item.itemStatus,
    arriveWindow: arriveWindow(item),
    cancelReason: item.cancelReason ?? "",
  };
  const value = values[key];
  if (MONEY_KEYS.includes(key) && typeof value === "number") return escHtml(money(value));
  if (value === "" || value == null) return "—";
  return escHtml(String(value));
}

/** Шинэ цонхонд дэлгэрэнгүй захиалга хэвлэнэ. */
export function printOrders(
  orders: AdminOrderDetail[],
  columns: OrderExportSelection = DEFAULT_ORDER_EXPORT_SELECTION,
) {
  if (!ORDER_EXPORT_COLUMNS.some((c) => columns[c.key])) {
    throw new Error("Наад зах нь нэг талбар сонгоно уу.");
  }
  const on = (key: OrderExportColumnKey) => columns[key];
  const itemCols = ORDER_EXPORT_COLUMNS.filter(
    (c) => PRINT_ITEM_KEYS.includes(c.key) && on(c.key),
  );
  const moneyCols = ORDER_EXPORT_COLUMNS.filter(
    (c) => c.group === "money" && on(c.key),
  );

  const blocks = orders
    .map((order) => {
      const items =
        itemCols.length === 0
          ? ""
          : order.items
              .map((item) => {
                const tds = itemCols
                  .map((col) => {
                    const num = MONEY_KEYS.includes(col.key) || col.key === "qty";
                    return `<td${num ? ' class="tnum"' : ""}>${printItemCell(item, col.key)}</td>`;
                  })
                  .join("");
                return `<tr>${tds}</tr>`;
              })
              .join("");

      const meta = [
        on("createdAt") ? dayTimeLabel(order.createdAt) : "",
        on("statusLabel") ? order.statusLabel : "",
        on("paymentLabel")
          ? (order.paymentStateLabel ?? PAYMENT_LABEL[order.paymentState])
          : "",
      ]
        .filter(Boolean)
        .join(" · ");

      const customerBits: string[] = [];
      if (on("customerName")) {
        customerBits.push(
          `<div><strong>${escHtml(order.customer.name ?? "Нэргүй")}</strong></div>`,
        );
      }
      if (on("customerPhone")) {
        customerBits.push(`<div>Утас: ${escHtml(phoneLabel(order.customer.phone))}</div>`);
      }
      if (on("customerEmail") && order.customer.email) {
        customerBits.push(`<div>И-мэйл: ${escHtml(order.customer.email)}</div>`);
      }
      if (on("fulfilment") && order.fulfilment) {
        customerBits.push(
          `<div>Авах арга: ${escHtml(FULFILMENT_LABEL[order.fulfilment] ?? order.fulfilment)}</div>`,
        );
      }
      if (on("batchName") && order.batch) {
        customerBits.push(`<div>Багц: ${escHtml(order.batch.name)}</div>`);
      }
      const addr = deliveryAddress(order);
      if (on("deliveryAddress") && addr) {
        customerBits.push(`<div>Хаяг: ${escHtml(addr)}</div>`);
      }
      if (on("note") && order.note) {
        customerBits.push(`<div>Тэмдэглэл: ${escHtml(order.note)}</div>`);
      }

      const totals = moneyCols
        .map((col) => {
          const amount =
            col.key === "subtotal"
              ? order.subtotal
              : col.key === "deliveryFee"
                ? (order.deliveryFee ?? 0)
                : col.key === "storageFee"
                  ? (order.storageFee ?? 0)
                  : col.key === "cargoFee"
                    ? (order.cargoFee ?? 0)
                    : col.key === "paidAmount"
                      ? order.paidAmount
                      : order.dueAmount;
          return `${escHtml(col.label)}: ${escHtml(money(amount))}`;
        })
        .join(" · ");

      const table =
        itemCols.length === 0
          ? ""
          : `<table>
          <thead>
            <tr>${itemCols.map((c) => `<th>${escHtml(c.label)}</th>`).join("")}</tr>
          </thead>
          <tbody>${items || `<tr><td colspan="${itemCols.length}">Бараа алга.</td></tr>`}</tbody>
        </table>`;

      const title = on("orderCode") ? escHtml(order.code) : "Захиалга";

      return `<section class="order">
        <header>
          <div class="code">${title}</div>
          ${meta ? `<div class="meta">${escHtml(meta)}</div>` : ""}
        </header>
        ${customerBits.length ? `<div class="customer">${customerBits.join("")}</div>` : ""}
        ${table}
        ${totals ? `<div class="totals">${totals}</div>` : ""}
      </section>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="mn">
<head>
  <meta charset="utf-8" />
  <title>Захиалга хэвлэх</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1c1917; margin: 16px; font-size: 12px; }
    h1 { font-size: 16px; margin: 0 0 12px; }
    .order { break-inside: avoid; page-break-inside: avoid; border: 1px solid #d6d3d1; border-radius: 8px; padding: 12px; margin-bottom: 14px; }
    .code { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .meta, .customer, .totals { color: #57534e; margin-top: 6px; line-height: 1.45; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border-bottom: 1px solid #e7e5e4; padding: 6px 4px; text-align: left; vertical-align: top; }
    th { font-weight: 600; color: #57534e; font-size: 11px; }
    .tnum { font-variant-numeric: tabular-nums; white-space: nowrap; }
    @media print {
      body { margin: 0; }
      .order { border-color: #a8a29e; }
    }
  </style>
</head>
<body>
  <h1>Захиалга — ${orders.length} ширхэг · ${escHtml(dayTimeLabel(new Date().toISOString()))}</h1>
  ${blocks}
</body>
</html>`;

  printHtml(html);
}
