import { dayTimeLabel, money, phoneLabel, rangeLabel } from "@/lib/format";
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

function deliveryAddress(order: AdminOrderDetail): string {
  const d = order.delivery;
  if (!d) return "";
  return [d.district, d.khoroo, d.addressText].filter(Boolean).join(", ");
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
      deliveryFee: order.deliveryFee,
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

const CSV_HEADERS: { key: keyof OrderExportLine; label: string }[] = [
  { key: "orderCode", label: "Захиалгын код" },
  { key: "createdAt", label: "Огноо" },
  { key: "statusLabel", label: "Төлөв" },
  { key: "paymentLabel", label: "Төлбөр" },
  { key: "customerName", label: "Нэр" },
  { key: "customerPhone", label: "Утас" },
  { key: "customerEmail", label: "И-мэйл" },
  { key: "productName", label: "Бараа" },
  { key: "selections", label: "Сонголт (төрөл/хэмжээ г.м.)" },
  { key: "size", label: "Хэмжээ" },
  { key: "color", label: "Өнгө" },
  { key: "qty", label: "Тоо" },
  { key: "unitPrice", label: "Нэгж үнэ" },
  { key: "lineTotal", label: "Мөрийн дүн" },
  { key: "itemStatus", label: "Мөрийн төлөв" },
  { key: "arriveWindow", label: "Ирэх хугацаа" },
  { key: "subtotal", label: "Нийт бараа" },
  { key: "storageFee", label: "Агуулахын хураамж" },
  { key: "cargoFee", label: "Карго" },
  { key: "paidAmount", label: "Төлсөн" },
  { key: "dueAmount", label: "Үлдэгдэл" },
  { key: "fulfilment", label: "Авах арга" },
  { key: "batchName", label: "Багц" },
  { key: "deliveryAddress", label: "Хаяг" },
  { key: "note", label: "Тэмдэглэл" },
  { key: "cancelReason", label: "Цуцлалтын шалтгаан" },
];

function csvEscape(value: string | number): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Excel-д нээгдэх UTF-8 BOM CSV. */
export function downloadOrdersExcel(orders: AdminOrderDetail[], filename?: string) {
  const rows = flattenOrdersForExport(orders);
  const header = CSV_HEADERS.map((h) => csvEscape(h.label)).join(",");
  const body = rows
    .map((row) => CSV_HEADERS.map((h) => csvEscape(row[h.key])).join(","))
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

/** Шинэ цонхонд дэлгэрэнгүй захиалга хэвлэнэ. */
export function printOrders(orders: AdminOrderDetail[]) {
  const blocks = orders
    .map((order) => {
      const items = order.items
        .map((item) => {
          const sel = formatSelections(item.selections, item.size, item.color);
          return `<tr>
            <td>${escHtml(item.name)}</td>
            <td>${escHtml(sel || "—")}</td>
            <td class="tnum">${item.qty}</td>
            <td class="tnum">${escHtml(money(item.unitPrice))}</td>
            <td class="tnum">${escHtml(money(item.total))}</td>
            <td>${escHtml(ITEM_STATUS_LABEL[item.itemStatus] ?? item.itemStatus)}</td>
            <td>${escHtml(arriveWindow(item) || "—")}</td>
          </tr>`;
        })
        .join("");

      const addr = deliveryAddress(order);
      return `<section class="order">
        <header>
          <div class="code">${escHtml(order.code)}</div>
          <div class="meta">${escHtml(dayTimeLabel(order.createdAt))} · ${escHtml(order.statusLabel)} · ${escHtml(order.paymentStateLabel ?? PAYMENT_LABEL[order.paymentState])}</div>
        </header>
        <div class="customer">
          <div><strong>${escHtml(order.customer.name ?? "Нэргүй")}</strong></div>
          <div>Утас: ${escHtml(phoneLabel(order.customer.phone))}</div>
          ${order.customer.email ? `<div>И-мэйл: ${escHtml(order.customer.email)}</div>` : ""}
          ${order.fulfilment ? `<div>Авах арга: ${escHtml(FULFILMENT_LABEL[order.fulfilment] ?? order.fulfilment)}</div>` : ""}
          ${order.batch ? `<div>Багц: ${escHtml(order.batch.name)}</div>` : ""}
          ${addr ? `<div>Хаяг: ${escHtml(addr)}</div>` : ""}
          ${order.note ? `<div>Тэмдэглэл: ${escHtml(order.note)}</div>` : ""}
        </div>
        <table>
          <thead>
            <tr>
              <th>Бараа</th>
              <th>Сонголт (төрөл/хэмжээ…)</th>
              <th>Тоо</th>
              <th>Үнэ</th>
              <th>Дүн</th>
              <th>Төлөв</th>
              <th>Ирэх</th>
            </tr>
          </thead>
          <tbody>${items}</tbody>
        </table>
        <div class="totals">
          Бараа: ${escHtml(money(order.subtotal))}
          ${order.storageFee > 0 ? ` · Агуулах: ${escHtml(money(order.storageFee))}` : ""}
          ${(order.cargoFee ?? 0) > 0 ? ` · Карго: ${escHtml(money(order.cargoFee ?? 0))}` : ""}
          · Төлсөн: ${escHtml(money(order.paidAmount))}
          · Үлдэгдэл: ${escHtml(money(order.dueAmount))}
        </div>
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
