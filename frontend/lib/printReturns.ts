import { dayLabel, dayTimeLabel, money, phoneLabel } from "@/lib/format";
import { formatSelections } from "@/lib/options";
import { printHtml } from "@/lib/printHtml";
import type { ReturnPayout, ReturnProduct } from "@/lib/types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type ReturnsPrintOptions = {
  products: boolean;
  payouts: boolean;
};

export const DEFAULT_RETURNS_PRINT: ReturnsPrintOptions = {
  products: true,
  payouts: true,
};

function variantLabel(row: ReturnProduct): string {
  return formatSelections(row.selections, row.size, row.color) || "Сонголтгүй";
}

function daysTitle(days: string[]): string {
  if (days.length === 0) return "Өдөр сонгоогүй";
  if (days.length === 1) return dayLabel(`${days[0]}T00:00:00+08:00`);
  if (days.length <= 6) {
    return days.map((d) => dayLabel(`${d}T00:00:00+08:00`)).join(", ");
  }
  return `${dayLabel(`${days[0]}T00:00:00+08:00`)} – ${dayLabel(`${days[days.length - 1]}T00:00:00+08:00`)} · ${days.length} өдөр`;
}

function productsSection(products: ReturnProduct[]): string {
  const rows = products
    .map(
      (row) => `<tr>
      <td>${esc(row.name)}</td>
      <td>${esc(variantLabel(row))}</td>
      <td class="num">${row.qty}</td>
      <td class="num">${esc(money(row.amount))}</td>
      <td class="num muted">${row.customerCount}</td>
    </tr>`,
    )
    .join("");
  const qty = products.reduce((sum, row) => sum + row.qty, 0);
  const amount = products.reduce((sum, row) => sum + row.amount, 0);
  return `<section>
    <h2>Буцаалтын бараа</h2>
    <table>
      <thead>
        <tr>
          <th>Бараа</th>
          <th>Сонголт</th>
          <th class="num">Ш</th>
          <th class="num">Дүн</th>
          <th class="num">Хүн</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="5">Бараа алга.</td></tr>`}</tbody>
      <tfoot>
        <tr>
          <td colspan="2">Нийт</td>
          <td class="num">${qty}</td>
          <td class="num">${esc(money(amount))}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  </section>`;
}

function payoutsSection(payouts: ReturnPayout[]): string {
  const rows = payouts
    .map((row, i) => {
      const account = row.bankAccountNumber.trim();
      const accountCell = account
        ? esc(account)
        : '<span class="blank">____________________</span>';
      return `<tr>
      <td class="num">${i + 1}</td>
      <td>
        <div class="name">${esc(row.name?.trim() || "Нэргүй")}</div>
        <div class="muted">${esc(phoneLabel(row.phone))}</div>
      </td>
      <td>${esc(row.bankName.trim() || "—")}</td>
      <td>${esc(row.bankAccountName.trim() || "—")}</td>
      <td class="acct">${accountCell}</td>
      <td class="acct">${accountCell}</td>
      <td class="num">${esc(money(row.amount))}</td>
    </tr>`;
    })
    .join("");
  const amount = payouts.reduce((sum, row) => sum + row.amount, 0);
  return `<section>
    <h2>Шилжүүлэх данс</h2>
    <p class="note">Дансны дугаарыг хоёр баганаар давхар хэвлэсэн — шалгахад зориулав.</p>
    <table>
      <thead>
        <tr>
          <th class="num">№</th>
          <th>Хэрэглэгч</th>
          <th>Банк</th>
          <th>Данс эзэмшигч</th>
          <th>Дансны дугаар</th>
          <th>Дансны дугаар</th>
          <th class="num">Дүн</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="7">Хэрэглэгч алга.</td></tr>`}</tbody>
      <tfoot>
        <tr>
          <td colspan="6">Нийт · ${payouts.length} хүн</td>
          <td class="num">${esc(money(amount))}</td>
        </tr>
      </tfoot>
    </table>
  </section>`;
}

export function printReturns(
  data: { days: string[]; products: ReturnProduct[]; payouts: ReturnPayout[] },
  opts: ReturnsPrintOptions = DEFAULT_RETURNS_PRINT,
): void {
  const title = daysTitle(data.days);
  const sections = [
    opts.products ? productsSection(data.products) : "",
    opts.payouts ? payoutsSection(data.payouts) : "",
  ]
    .filter(Boolean)
    .join("");

  const html = `<!DOCTYPE html>
<html lang="mn">
<head>
  <meta charset="utf-8" />
  <title>Буцаалт — ${esc(title)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm 10mm 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Noto Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #1c1917;
      font-size: 12px;
      line-height: 1.35;
    }
    h1 { font-size: 18px; margin: 0 0 4px; font-weight: 650; }
    h2 { font-size: 14px; margin: 0 0 8px; font-weight: 650; }
    .sub { color: #57534e; margin-bottom: 14px; }
    .note { color: #57534e; margin: 0 0 8px; font-size: 11px; }
    section { margin-bottom: 18px; break-inside: avoid; }
    table { width: 100%; border-collapse: collapse; }
    th, td {
      border: 1px solid #d6d3d1;
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }
    th { background: #f5f5f4; font-weight: 600; font-size: 11px; }
    tfoot td { font-weight: 650; background: #fafaf9; }
    .num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
    .acct {
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }
    .name { font-weight: 600; }
    .muted { color: #78716c; font-size: 11px; }
    .blank { color: #a8a29e; font-weight: 400; letter-spacing: 0; }
    @media print {
      body { font-size: 11px; }
      th, td { border-color: #a8a29e; }
    }
  </style>
</head>
<body>
  <h1>Буцаалт</h1>
  <div class="sub">${esc(title)} · ${esc(dayTimeLabel(new Date().toISOString()))}</div>
  ${sections || "<p>Хэвлэх зүйл алга.</p>"}
</body>
</html>`;

  printHtml(html, { width: 980, height: 720 });
}
