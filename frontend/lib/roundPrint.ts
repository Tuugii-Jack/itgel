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

function variantsOf(product: PrintProduct): PrintVariant[] {
  return product.byVariant.length > 0
    ? product.byVariant
    : [{ selections: {}, size: null, color: null, qty: product.qty }];
}

function productPrintLayout(products: PrintProduct[]) {
  const extraKinds = [
    ...new Set(
      products.flatMap((p) => variantsOf(p).flatMap((v) => Object.keys(variantParts(v).extra))),
    ),
  ].sort((a, b) => a.localeCompare(b, "mn"));

  const hasSize = products.some((p) => variantsOf(p).some((v) => variantParts(v).size));
  const hasColor = products.some((p) => variantsOf(p).some((v) => variantParts(v).color));

  return { extraKinds, hasSize, hasColor };
}

type ProductExportRow = {
  name: string;
  color: string;
  size: string;
  extra: Record<string, string>;
  customer: string;
  phone: string;
  code: string;
  qty: number;
  price: number;
};

function productExportRows(
  products: PrintProduct[],
  opts: ProductPrintOptions,
): ProductExportRow[] {
  const rows: ProductExportRow[] = [];
  for (const product of products) {
    for (const v of variantsOf(product)) {
      const parts = variantParts(v);
      const base = {
        name: product.name,
        color: parts.color || "—",
        size: parts.size || "—",
        extra: parts.extra,
        price: variantPrice(product, v),
      };
      if (!opts.customers) {
        rows.push({
          ...base,
          customer: "",
          phone: "",
          code: "",
          qty: v.qty,
        });
        continue;
      }
      const buyers = buyersFor(product.orders, v);
      if (buyers.length === 0) {
        rows.push({
          ...base,
          customer: "—",
          phone: "",
          code: "",
          qty: v.qty,
        });
        continue;
      }
      for (const o of buyers) {
        rows.push({
          ...base,
          customer: o.customer.name ?? "Нэргүй",
          phone: phoneLabel(o.customer.phone),
          code: o.code,
          qty: o.qty,
          price: o.unitPrice,
        });
      }
    }
  }
  return rows;
}

function csvEscape(value: string | number): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function dayKeySafe(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function fileSafe(s: string): string {
  return s
    .replace(/[^\p{L}\p{N}-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "baraa";
}

/** Хэвлэлттэй ижил задаргаа — сонголт бүр тусдаа багана. Excel-д нээгдэх UTF-8 BOM CSV. */
export function downloadProductOrdersExcel(
  products: PrintProduct[],
  opts: ProductPrintOptions,
  meta?: { filename?: string },
) {
  const { extraKinds, hasSize, hasColor } = productPrintLayout(products);
  const headers = [
    "Бүтээгдэхүүний нэр",
    hasColor ? "Өнгө" : null,
    hasSize ? "Хэмжээ" : null,
    ...extraKinds,
    opts.customers ? "Хэрэглэгч" : null,
    opts.phone ? "Утас" : null,
    opts.code ? "Захиалгын код" : null,
    "Тоо",
    opts.amounts ? "Үнэ ₮" : null,
  ].filter((h): h is string => Boolean(h));

  const lines = productExportRows(products, opts).map((row) => {
    const cells: (string | number)[] = [row.name];
    if (hasColor) cells.push(row.color);
    if (hasSize) cells.push(row.size);
    for (const k of extraKinds) cells.push(row.extra[k] || "—");
    if (opts.customers) cells.push(row.customer);
    if (opts.phone) cells.push(row.phone);
    if (opts.code) cells.push(row.code);
    cells.push(row.qty);
    if (opts.amounts) cells.push(row.price);
    return cells.map(csvEscape).join(",");
  });

  const totalQty = products.reduce((sum, p) => sum + p.qty, 0);
  const qtyIndex = headers.length - (opts.amounts ? 2 : 1);
  const totalCells = headers.map((_, i) => {
    if (i === 0) return "Нийт";
    if (i === qtyIndex) return String(totalQty);
    return "";
  });
  lines.push(totalCells.map(csvEscape).join(","));

  const bom = "\uFEFF";
  const blob = new Blob([bom + headers.map(csvEscape).join(",") + "\n" + lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = meta?.filename ?? `baraagaar-zahialga-${dayKeySafe()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function productExcelFilename(title: string): string {
  return `${fileSafe(title)}-${dayKeySafe()}.csv`;
}

export function printProductOrders(
  products: PrintProduct[],
  opts: ProductPrintOptions,
  meta?: { title?: string; hint?: string; countLabel?: string },
) {
  const { extraKinds, hasSize, hasColor } = productPrintLayout(products);

  const title = meta?.title ?? "Бараагаар захиалга";
  const totalQty = products.reduce((sum, p) => sum + p.qty, 0);

  const headerCells = [
    "<th>Бүтээгдэхүүний нэр</th>",
    hasColor ? "<th>Өнгө</th>" : "",
    hasSize ? "<th>Хэмжээ</th>" : "",
    ...extraKinds.map((k) => `<th>${esc(k)}</th>`),
    opts.customers ? "<th>Хэрэглэгч</th>" : "",
    '<th class="num">Тоо</th>',
    opts.amounts ? '<th class="num">Үнэ ₮</th>' : "",
  ]
    .filter(Boolean)
    .join("");

  const body = products
    .map((product) => {
      const variants =
        product.byVariant.length > 0
          ? product.byVariant
          : [{ selections: {}, size: null, color: null, qty: product.qty }];

      return variants
        .map((v, i) => {
          const parts = variantParts(v);
          const buyers = buyersFor(product.orders, v);
          const customerHtml = opts.customers
            ? `<td class="people">${
                buyers.length === 0
                  ? "—"
                  : buyers
                      .map((o) => {
                        const bits = [esc(o.customer.name ?? "Нэргүй")];
                        if (opts.phone) bits.push(esc(phoneLabel(o.customer.phone)));
                        if (opts.code) bits.push(esc(o.code));
                        const who = bits.join(" · ");
                        return buyers.length > 1
                          ? `${who} <span class="qty-inline">${o.qty}ш</span>`
                          : who;
                      })
                      .join("<br/>")
              }</td>`
            : "";

          return `<tr class="${i === 0 ? "group" : "variant"}">
            <td class="name">${i === 0 ? esc(product.name) : ""}</td>
            ${hasColor ? `<td class="opt">${esc(parts.color || "—")}</td>` : ""}
            ${hasSize ? `<td class="opt">${esc(parts.size || "—")}</td>` : ""}
            ${extraKinds.map((k) => `<td class="opt">${esc(parts.extra[k] || "—")}</td>`).join("")}
            ${customerHtml}
            <td class="num">${v.qty}</td>
            ${opts.amounts ? `<td class="num">${esc(num(variantPrice(product, v)))}</td>` : ""}
          </tr>`;
        })
        .join("");
    })
    .join("");

  const beforeQty =
    1 +
    (hasColor ? 1 : 0) +
    (hasSize ? 1 : 0) +
    extraKinds.length +
    (opts.customers ? 1 : 0);

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
        <td class="label" colspan="${beforeQty}">Нийт</td>
        <td class="num">${totalQty}</td>
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
