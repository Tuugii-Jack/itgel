import { dayLabel, dayTimeLabel, num, phoneLabel } from "@/lib/format";
import { printHtml } from "@/lib/printHtml";
import type { OrdersByProductRow, RoundBuyer, RoundOrders } from "@/lib/types";

export type ProductPrintOptions = {
  customers: boolean;
  phone: boolean;
  code: boolean;
  amounts: boolean;
};

export const DEFAULT_PRODUCT_PRINT: ProductPrintOptions = {
  customers: false,
  phone: false,
  code: false,
  amounts: false,
};

type PrintVariant = {
  selections?: Record<string, string>;
  size: string | null;
  color: string | null;
  qty: number;
};

type PrintProduct = {
  name: string;
  roundNo: number;
  closed: boolean;
  closeAt: string | null;
  daysOpen: number | null;
  daysSinceClose: number | null;
  qty: number;
  customerCount: number;
  sellPrice: number;
  byVariant: PrintVariant[];
  orders?: RoundBuyer[];
};

const SIZE_KEYS = new Set(["Хэмжээ", "SIZE"]);
const COLOR_KEYS = new Set(["Өнгө", "COLOR"]);

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function closeHint(row: {
  closed: boolean;
  closeAt: string | null;
  daysOpen: number | null;
  daysSinceClose: number | null;
}): string {
  if (!row.closeAt) return "Бэлэн бараа";
  if (row.closed) {
    const ago =
      row.daysSinceClose === 0
        ? "өнөөдөр хаагдсан"
        : `${row.daysSinceClose} хоногийн өмнө хаагдсан`;
    const open = row.daysOpen != null ? ` · захиалга авсан ${row.daysOpen} хоног` : "";
    return `Хаагдсан ${dayLabel(row.closeAt)} · ${ago}${open}`;
  }
  return `Хаагдах ${dayTimeLabel(row.closeAt)}`;
}

function variantParts(v: PrintVariant) {
  const sel = v.selections ?? {};
  const size = (v.size || sel["Хэмжээ"] || sel["SIZE"] || "").trim();
  const color = (v.color || sel["Өнгө"] || sel["COLOR"] || "").trim();
  const extra: Record<string, string> = {};
  for (const [k, val] of Object.entries(sel)) {
    if (!SIZE_KEYS.has(k) && !COLOR_KEYS.has(k) && val.trim()) extra[k] = val;
  }
  return { size, color, extra };
}

function variantKey(v: PrintVariant): string {
  const sel = v.selections ?? {};
  if (Object.keys(sel).length > 0) {
    const keys = Object.keys(sel).sort((a, b) => a.localeCompare(b, "mn"));
    const ordered: Record<string, string> = {};
    for (const k of keys) ordered[k] = sel[k]!;
    return JSON.stringify(ordered);
  }
  return JSON.stringify({ size: v.size ?? "", color: v.color ?? "" });
}

function buyerKey(o: RoundBuyer): string {
  const v: PrintVariant = {
    selections: o.selections,
    size: o.size,
    color: o.color,
    qty: o.qty,
  };
  return variantKey(v);
}

function buyersFor(orders: RoundBuyer[] | undefined, v: PrintVariant): RoundBuyer[] {
  if (!orders?.length) return [];
  const key = variantKey(v);
  return orders.filter((o) => !o.cancelled && buyerKey(o) === key);
}

function variantPrice(product: PrintProduct, v: PrintVariant): number {
  const buyers = buyersFor(product.orders, v);
  if (buyers[0]) return buyers[0].unitPrice;
  return product.sellPrice;
}

type TableColumn = { key: string; label: string; numeric?: boolean };
type TableCell = string | number;
type TableRow = {
  cells: Record<string, TableCell>;
  groupStart: boolean;
};

function productVariants(product: PrintProduct): PrintVariant[] {
  return product.byVariant.length > 0
    ? product.byVariant
    : [{ selections: {}, size: null, color: null, qty: product.qty }];
}

function extraKindsOf(products: PrintProduct[]): string[] {
  const names = new Set<string>();
  for (const product of products) {
    for (const variant of productVariants(product)) {
      for (const key of Object.keys(variantParts(variant).extra)) names.add(key);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, "mn"));
}

/**
 * Хэмжээ/өнгө + бараан дээрх бусад сонголт тус бүрд багана.
 * Худалдан авагч/код асаалттай үед захиалга бүр тусдаа мөр.
 */
function buildProductOrderTable(
  products: PrintProduct[],
  opts: ProductPrintOptions,
): { columns: TableColumn[]; rows: TableRow[]; totalQty: number } {
  const extraKinds = extraKindsOf(products);
  const hasSize = products.some((p) => productVariants(p).some((v) => variantParts(v).size));
  const hasColor = products.some((p) => productVariants(p).some((v) => variantParts(v).color));

  const columns: TableColumn[] = [
    { key: "name", label: "Бүтээгдэхүүний нэр" },
    ...(hasColor ? [{ key: "color", label: "Өнгө" }] : []),
    ...(hasSize ? [{ key: "size", label: "Хэмжээ" }] : []),
    ...extraKinds.map((kind) => ({ key: `opt:${kind}`, label: kind })),
    ...(opts.customers ? [{ key: "customer", label: "Хэрэглэгч" }] : []),
    ...(opts.phone ? [{ key: "phone", label: "Утас" }] : []),
    ...(opts.code ? [{ key: "code", label: "Захиалгын код" }] : []),
    { key: "qty", label: "Тоо", numeric: true },
    ...(opts.amounts ? [{ key: "price", label: "Үнэ ₮", numeric: true }] : []),
  ];

  const rows: TableRow[] = [];
  for (const product of products) {
    let first = true;
    for (const variant of productVariants(product)) {
      const parts = variantParts(variant);
      const buyers = opts.customers ? buyersFor(product.orders, variant) : [];
      const units: Array<RoundBuyer | null> = opts.customers
        ? buyers.length > 0
          ? buyers
          : [null]
        : [null];

      for (const buyer of units) {
        const cells: Record<string, TableCell> = {
          name: product.name,
          qty: buyer ? buyer.qty : variant.qty,
        };
        if (hasColor) cells.color = parts.color || "—";
        if (hasSize) cells.size = parts.size || "—";
        for (const kind of extraKinds) {
          cells[`opt:${kind}`] = parts.extra[kind] || "—";
        }
        if (opts.customers) cells.customer = buyer?.customer.name?.trim() || "Нэргүй";
        if (opts.phone) cells.phone = buyer ? phoneLabel(buyer.customer.phone) : "—";
        if (opts.code) cells.code = buyer?.code ?? "—";
        if (opts.amounts) {
          cells.price = buyer ? buyer.unitPrice : variantPrice(product, variant);
        }
        rows.push({ cells, groupStart: first });
        first = false;
      }
    }
  }

  const totalQty = rows.reduce((sum, row) => sum + Number(row.cells.qty ?? 0), 0);
  return { columns, rows, totalQty };
}

function csvEscape(value: TableCell): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function dayKeySafe(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** Excel-д нээгдэх UTF-8 BOM CSV — сонголт бүр багана, код асаалттай бол захиалга бүр мөр. */
export function downloadProductOrdersExcel(
  products: PrintProduct[],
  opts: ProductPrintOptions,
  meta?: { title?: string; filename?: string },
) {
  const table = buildProductOrderTable(products, opts);
  const header = table.columns.map((col) => csvEscape(col.label)).join(",");
  const body = table.rows
    .map((row) => table.columns.map((col) => csvEscape(row.cells[col.key] ?? "")).join(","))
    .join("\n");
  const qtyIndex = table.columns.findIndex((col) => col.key === "qty");
  const totalCells = table.columns.map((col, i) => {
    if (i === 0) return csvEscape("Нийт");
    if (i === qtyIndex) return csvEscape(table.totalQty);
    return "";
  });
  const bom = "\uFEFF";
  const blob = new Blob([`${bom}${header}\n${body}\n${totalCells.join(",")}\n`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = meta?.filename ?? `baraagaar-${dayKeySafe()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function printProductOrders(
  products: PrintProduct[],
  opts: ProductPrintOptions,
  meta?: { title?: string; hint?: string; countLabel?: string },
) {
  const table = buildProductOrderTable(products, opts);
  const explodePeople = opts.customers || opts.phone || opts.code;
  const title = meta?.title ?? "Бараагаар захиалга";

  const headerCells = table.columns
    .map((col) => `<th${col.numeric ? ' class="num"' : ""}>${esc(col.label)}</th>`)
    .join("");

  const body = table.rows
    .map((row) => {
      const tds = table.columns
        .map((col) => {
          const raw = row.cells[col.key] ?? "";
          const value =
            col.key === "price" && typeof raw === "number" ? num(raw) : String(raw);
          const hideName = col.key === "name" && !explodePeople && !row.groupStart;
          const cls = [
            col.numeric ? "num" : "",
            col.key === "name" ? "name" : "",
            col.key === "customer" || col.key === "phone" || col.key === "code" || col.key.startsWith("opt:") || col.key === "size" || col.key === "color"
              ? "opt"
              : "",
          ]
            .filter(Boolean)
            .join(" ");
          return `<td${cls ? ` class="${cls}"` : ""}>${hideName ? "" : esc(value)}</td>`;
        })
        .join("");
      return `<tr class="${row.groupStart ? "group" : "variant"}">${tds}</tr>`;
    })
    .join("");

  const beforeQty = table.columns.findIndex((col) => col.key === "qty");

  const html = `<!DOCTYPE html>
<html lang="mn">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <style>
    * { box-sizing: border-box; }
    @page { margin: 16mm 14mm; }
    body {
      margin: 0;
      color: #1a1916;
      font-family: "Iowan Old Style", Palatino, "Palatino Linotype", "Times New Roman", serif;
      font-size: 15px;
      line-height: 1.35;
    }
    .head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 28px; }
    h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0; }
    .count { font-family: system-ui, -apple-system, sans-serif; font-size: 14px; color: #8a847c; }
    .hint { margin: -18px 0 22px; font-family: system-ui, -apple-system, sans-serif; font-size: 12px; color: #8a847c; }
    table { width: 100%; border-collapse: collapse; }
    th {
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      text-align: left;
      color: #1a1916;
      border-top: 1.5px solid #1a1916;
      border-bottom: 1.5px solid #1a1916;
      padding: 10px 16px 10px 0;
    }
    th.num, td.num { text-align: right; padding-right: 0; }
    td {
      padding: 10px 16px 10px 0;
      vertical-align: top;
      border: 0;
    }
    tr.group td { padding-top: 18px; border-top: 1px solid #d9d4cc; }
    tr.group:first-child td { border-top: 0; padding-top: 14px; }
    td.name { font-weight: 500; }
    td.opt, td.people {
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      color: #6f675f;
    }
    td.people { font-size: 12px; line-height: 1.45; }
    td.num {
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .qty-inline { color: #8a847c; }
    tfoot td {
      border-top: 1.5px solid #1a1916;
      padding-top: 12px;
      font-weight: 700;
    }
    tfoot .label { font-family: system-ui, -apple-system, sans-serif; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; }
    @media print {
      body { margin: 0; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="head">
    <h1>${esc(title)}</h1>
    <div class="count">${esc(meta?.countLabel ?? `${products.length} бараа`)}</div>
  </div>
  ${meta?.hint ? `<div class="hint">${esc(meta.hint)}</div>` : ""}
  <table>
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${body}</tbody>
    <tfoot>
      <tr>
        <td class="label" colspan="${Math.max(beforeQty, 1)}">Нийт</td>
        <td class="num">${table.totalQty}</td>
        ${opts.amounts ? "<td></td>" : ""}
      </tr>
    </tfoot>
  </table>
</body>
</html>`;

  printHtml(html, { width: 920, height: 1100 });
}

export function rowToPrintProduct(row: OrdersByProductRow): PrintProduct {
  return {
    name: row.name,
    roundNo: row.roundNo,
    closed: row.closed,
    closeAt: row.closeAt,
    daysOpen: row.daysOpen,
    daysSinceClose: row.daysSinceClose,
    qty: row.qty,
    customerCount: row.customerCount,
    sellPrice: row.sellPrice,
    byVariant: row.byVariant,
  };
}

export function roundOrdersToPrintProduct(data: RoundOrders): PrintProduct {
  return {
    name: data.round.name,
    roundNo: data.round.roundNo,
    closed: data.round.closed ?? data.round.status === "CLOSED",
    closeAt: data.round.closeAt,
    daysOpen: data.round.daysOpen ?? null,
    daysSinceClose: data.round.daysSinceClose ?? null,
    qty: data.summary.qty,
    customerCount: data.summary.customerCount,
    sellPrice: data.round.sellPrice,
    byVariant: data.summary.byVariant,
    orders: data.orders,
  };
}
