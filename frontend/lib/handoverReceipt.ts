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
 * 80мм кассын цаасанд хэвлэх хүлээлгэн өгөх баримт.
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
    /* 80mm thermal — printable ~72–74mm after margins */
    @page {
      size: 80mm auto;
      margin: 3mm 4mm;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 72mm;
      max-width: 72mm;
    }
    body {
      margin: 0 auto;
      padding: 2mm 0 5mm;
      font-family: "Courier New", Courier, ui-monospace, monospace;
      font-size: 12px;
      line-height: 1.35;
      color: #000;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .center { text-align: center; }
    .brand { font-size: 16px; font-weight: 700; letter-spacing: 0.06em; }
    .title { font-size: 12px; margin-top: 3px; font-weight: 700; }
    .dash {
      border: none;
      border-top: 1px dashed #000;
      margin: 7px 0;
    }
    .cust { margin: 4px 0; }
    .cust strong { font-size: 13px; }
    .muted { font-size: 11px; }
    .line { margin-bottom: 7px; }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      align-items: flex-start;
    }
    .name {
      font-weight: 700;
      font-size: 12px;
      word-break: break-word;
      flex: 1;
      min-width: 0;
    }
    .qty { font-weight: 700; white-space: nowrap; font-size: 12px; }
    .sel { font-size: 11px; margin-top: 1px; }
    .meta { font-size: 10px; opacity: 0.85; margin-top: 1px; }
    .sum { font-size: 12px; font-weight: 700; }
    .sign-box {
      margin-top: 10px;
      border: 1px dashed #000;
      min-height: 24mm;
      padding: 5px 6px;
    }
    .sign-label { font-size: 11px; margin-bottom: 4px; }
    .sign-hint { font-size: 10px; opacity: 0.75; margin-top: 14mm; }
    .foot { margin-top: 8px; font-size: 10px; text-align: center; }
    @media print {
      html, body { width: 72mm; max-width: 72mm; }
    }
    @media screen {
      body {
        border: 1px dashed #ccc;
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

  const w = window.open("", "_blank", "noopener,noreferrer,width=360,height=720");
  if (!w) {
    throw new Error("Хэвлэх цонх нээгдсэнгүй. Popup зөвшөөрнө үү.");
  }
  w.document.write(html);
  w.document.close();
}
