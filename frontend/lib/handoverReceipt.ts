import { dayTimeLabel, money, phoneLabel } from "@/lib/format";
import { formatSelections } from "@/lib/options";
import { printHtml } from "@/lib/printHtml";

export type HandoverReceiptItem = {
  orderCode: string;
  name: string;
  selections?: Record<string, string> | null;
  size?: string | null;
  color?: string | null;
  qty: number;
  unitPrice?: number;
};

export type HandoverReceiptData = {
  customerName: string | null;
  customerPhone: string | null;
  items: HandoverReceiptItem[];
  orderCodes?: string[];
  /** Авсан үлдэгдэл — бэлэн эсвэл карт/данс. */
  collectedAmount?: number;
  collectedMethod?: "CASH" | "CARD";
  cashTaken?: number;
  cardTaken?: number;
  note?: string;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 80мм кассын цаасанд хэвлэх хүлээлгэн өгөх баримт.
 * Тод, бүдэгрэхгүй бичиг — Arial + pt хэмжээ, саарал/Courier хэрэглэхгүй.
 */
export function printHandoverReceipt(data: HandoverReceiptData) {
  if (data.items.length === 0) {
    throw new Error("Хэвлэх бараа сонгоогүй.");
  }

  const lines = data.items
    .map((item) => {
      const sel = formatSelections(item.selections, item.size, item.color);
      return `<div class="line">
        <div class="row">
          <span class="name">${esc(item.name)}</span>
          <span class="qty">${item.qty} ш</span>
        </div>
        ${sel ? `<div class="sel">${esc(sel)}</div>` : ""}
        <div class="meta">${esc(item.orderCode)}${
          item.unitPrice != null ? ` · ${esc(money(item.unitPrice))}` : ""
        }</div>
      </div>`;
    })
    .join("");

  const totalQty = data.items.reduce((s, i) => s + i.qty, 0);
  const now = dayTimeLabel(new Date().toISOString());
  const phone = data.customerPhone?.trim()
    ? phoneLabel(data.customerPhone)
    : "Утасгүй";
  const codes = (data.orderCodes ?? []).filter(Boolean);
  const cash =
    data.cashTaken ??
    (data.collectedMethod !== "CARD" ? data.collectedAmount ?? 0 : 0);
  const card =
    data.cardTaken ??
    (data.collectedMethod === "CARD" ? data.collectedAmount ?? 0 : 0);

  const html = `<!DOCTYPE html>
<html lang="mn">
<head>
  <meta charset="utf-8" />
  <title>Хүлээлгэн өгөх</title>
  <style>
    @page {
      size: 80mm auto;
      margin: 3mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: none;
      -moz-osx-font-smoothing: unset;
      font-smooth: never;
    }
    html, body { width: 74mm; max-width: 74mm; }
    body {
      margin: 0 auto;
      padding: 1mm 0 4mm;
      font-family: Arial, Helvetica, "Noto Sans", sans-serif;
      font-size: 13pt;
      font-weight: 700;
      line-height: 1.2;
      color: #000;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .center { text-align: center; }
    .brand { font-size: 20pt; font-weight: 800; }
    .title { font-size: 13pt; margin-top: 2px; font-weight: 800; }
    .bar {
      height: 2px;
      background: #000;
      border: 0;
      margin: 6px 0;
    }
    .phone {
      font-size: 18pt;
      font-weight: 800;
      letter-spacing: 0.03em;
      margin: 2px 0 2px;
    }
    .cust-name { font-size: 14pt; font-weight: 800; }
    .when { font-size: 11pt; font-weight: 700; margin-top: 3px; }
    .codes { font-size: 11pt; font-weight: 700; margin-top: 2px; }
    .line { margin-bottom: 8px; }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: flex-start;
    }
    .name {
      font-weight: 800;
      font-size: 13pt;
      word-break: break-word;
      flex: 1;
      min-width: 0;
    }
    .qty { font-weight: 800; white-space: nowrap; font-size: 13pt; }
    .sel { font-size: 12pt; font-weight: 700; margin-top: 1px; }
    .meta { font-size: 11pt; font-weight: 700; margin-top: 1px; }
    .sum { font-size: 13pt; font-weight: 800; margin-top: 2px; }
    .sign-box {
      margin-top: 10px;
      border: 2px solid #000;
      min-height: 22mm;
      padding: 5px 6px;
    }
    .sign-label { font-size: 12pt; font-weight: 800; }
    .sign-hint { font-size: 11pt; font-weight: 700; margin-top: 12mm; }
    .foot { margin-top: 8px; font-size: 11pt; font-weight: 700; text-align: center; }
    @media print {
      html, body { width: 74mm; max-width: 74mm; }
    }
    @media screen {
      body {
        border: 2px solid #000;
        padding: 4mm;
        margin: 8px auto;
      }
    }
  </style>
</head>
<body>
  <div class="center">
    <div class="brand">itgel</div>
    <div class="title">ХҮЛЭЭЛГЭН ӨГӨХ</div>
  </div>
  <hr class="bar" />
  <div class="center">
    <div class="phone">${esc(phone)}</div>
    <div class="cust-name">${esc(data.customerName ?? "Нэргүй")}</div>
    ${codes.length > 0 ? `<div class="codes">${esc(codes.join(" · "))}</div>` : ""}
    <div class="when">${esc(now)}</div>
  </div>
  <hr class="bar" />
  ${lines}
  <hr class="bar" />
  <div class="sum">Нийт: ${totalQty} ш · ${data.items.length} мөр</div>
  ${cash > 0 ? `<div class="sum">Бэлэн авсан: ${esc(money(cash))}</div>` : ""}
  ${card > 0 ? `<div class="sum">Карт/дансаар авсан: ${esc(money(card))}</div>` : ""}
  ${data.note ? `<div class="when" style="margin-top:4px">${esc(data.note)}</div>` : ""}
  <div class="sign-box">
    <div class="sign-label">Хүлээн авагчийн гарын үсэг</div>
    <div class="sign-hint">______________________________</div>
  </div>
  <div class="foot">Барааг шалгаж аваарай.<br />Баярлалаа!</div>
</body>
</html>`;

  printHtml(html);
}
