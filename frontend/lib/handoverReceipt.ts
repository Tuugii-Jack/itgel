import { dayTimeLabel, money, phoneLabel } from "@/lib/format";
import { formatSelections } from "@/lib/options";

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
  customerEmail?: string | null;
  items: HandoverReceiptItem[];
  /** Бэлнээр авсан бол харуулна. */
  collectedAmount?: number;
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
 * Кассын жижиг (58мм) цаасанд хэвлэх хүлээлгэн өгөх баримт.
 * Гарын үсэг зуруулсны дараа бараа өгнө.
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
          <span class="qty">×${item.qty}</span>
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

  const html = `<!DOCTYPE html>
<html lang="mn">
<head>
  <meta charset="utf-8" />
  <title>Хүлээлгэн өгөх</title>
  <style>
    @page {
      size: 58mm auto;
      margin: 2mm;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 58mm;
      max-width: 58mm;
      margin: 0 auto;
      padding: 2mm 1.5mm 4mm;
      font-family: "Courier New", Courier, ui-monospace, monospace;
      font-size: 11px;
      line-height: 1.35;
      color: #000;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .center { text-align: center; }
    .brand { font-size: 14px; font-weight: 700; letter-spacing: 0.04em; }
    .title { font-size: 11px; margin-top: 2px; }
    .dash {
      border: none;
      border-top: 1px dashed #000;
      margin: 6px 0;
    }
    .cust { margin: 4px 0; }
    .cust strong { font-size: 12px; }
    .muted { font-size: 10px; }
    .line { margin-bottom: 6px; }
    .row { display: flex; justify-content: space-between; gap: 4px; align-items: flex-start; }
    .name { font-weight: 700; font-size: 11px; word-break: break-word; }
    .qty { font-weight: 700; white-space: nowrap; }
    .sel { font-size: 10px; margin-top: 1px; }
    .meta { font-size: 9px; opacity: 0.85; margin-top: 1px; }
    .sum { font-size: 11px; font-weight: 700; }
    .sign-box {
      margin-top: 10px;
      border: 1px dashed #000;
      min-height: 28mm;
      padding: 4px 6px;
    }
    .sign-label { font-size: 10px; margin-bottom: 4px; }
    .sign-hint { font-size: 9px; opacity: 0.75; margin-top: 18mm; }
    .foot { margin-top: 8px; font-size: 9px; text-align: center; }
    @media print {
      html, body { width: 58mm; }
    }
  </style>
</head>
<body>
  <div class="center">
    <div class="brand">itgel</div>
    <div class="title">ХҮЛЭЭЛГЭН ӨГӨХ</div>
  </div>
  <hr class="dash" />
  <div class="cust">
    <strong>${esc(data.customerName ?? "Нэргүй")}</strong><br />
    ${data.customerPhone ? `Утас: ${esc(phoneLabel(data.customerPhone))}<br />` : ""}
    ${data.customerEmail ? `И-мэйл: ${esc(data.customerEmail)}<br />` : ""}
    <span class="muted">${esc(now)}</span>
  </div>
  <hr class="dash" />
  ${lines}
  <hr class="dash" />
  <div class="sum">Нийт: ${totalQty} ш · ${data.items.length} мөр</div>
  ${
    data.collectedAmount && data.collectedAmount > 0
      ? `<div class="sum">Бэлэн авсан: ${esc(money(data.collectedAmount))}</div>`
      : ""
  }
  ${data.note ? `<div class="muted" style="margin-top:4px">${esc(data.note)}</div>` : ""}
  <div class="sign-box">
    <div class="sign-label">Хүлээн авагчийн гарын үсэг</div>
    <div class="sign-hint">______________________________</div>
  </div>
  <div class="foot">Барааг шалгаж аваарай.<br />Баярлалаа!</div>
  <script>
    window.onload = function () {
      setTimeout(function () { window.print(); }, 80);
    };
  </script>
</body>
</html>`;

  const w = window.open("", "_blank", "noopener,noreferrer,width=320,height=640");
  if (!w) {
    throw new Error("Хэвлэх цонх нээгдсэнгүй. Popup зөвшөөрнө үү.");
  }
  w.document.write(html);
  w.document.close();
}
