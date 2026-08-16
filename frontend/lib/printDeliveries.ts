import { dayLabel, dayTimeLabel, phoneLabel, weekdayShort } from "@/lib/format";
import {
  formatPlaceLine,
  placeTitle,
  placeZone,
  ZONE_SORT,
  zoneLabel,
  type DeliveryZone,
} from "@/lib/locations";
import { formatSelections } from "@/lib/options";
import { printHtml } from "@/lib/printHtml";
import type { AdminDelivery } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Хүлээгдэж буй",
  ASSIGNED: "Жолооч хуваарилсан",
  DELIVERED: "Хүргэсэн",
};

export type DeliveryPlaceGroup = {
  district: string;
  title: string;
  zone: DeliveryZone | "other";
  rows: AdminDelivery[];
};

export function groupDeliveriesByDistrict(rows: AdminDelivery[]): DeliveryPlaceGroup[] {
  const map = new Map<string, AdminDelivery[]>();
  for (const row of rows) {
    const key = row.district.trim() || "";
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      const khoroo = (a.khoroo ?? "").localeCompare(b.khoroo ?? "", "mn");
      if (khoroo !== 0) return khoroo;
      return (a.addressText ?? "").localeCompare(b.addressText ?? "", "mn");
    });
  }
  return [...map.entries()]
    .sort((a, b) => {
      const zoneDiff = ZONE_SORT[placeZone(a[0])] - ZONE_SORT[placeZone(b[0])];
      if (zoneDiff !== 0) return zoneDiff;
      return placeTitle(a[0]).localeCompare(placeTitle(b[0]), "mn");
    })
    .map(([district, grouped]) => ({
      district,
      title: placeTitle(district),
      zone: placeZone(district),
      rows: grouped,
    }));
}

export function splitDeliveryZones(groups: DeliveryPlaceGroup[]): {
  zone: DeliveryZone | "other";
  label: string;
  groups: DeliveryPlaceGroup[];
}[] {
  const buckets: Record<DeliveryZone | "other", DeliveryPlaceGroup[]> = {
    city: [],
    aimag: [],
    other: [],
  };
  for (const group of groups) buckets[group.zone].push(group);
  return (["city", "aimag", "other"] as const)
    .filter((zone) => buckets[zone].length > 0)
    .map((zone) => ({ zone, label: zoneLabel(zone), groups: buckets[zone] }));
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function addressLines(row: AdminDelivery): string[] {
  const lines: string[] = [];
  const head = formatPlaceLine(row.district, row.khoroo);
  if (head) lines.push(head);
  if (row.addressText?.trim()) lines.push(row.addressText.trim());
  return lines;
}

function itemLine(item: AdminDelivery["order"]["items"][number]): string {
  const sel = formatSelections(item.selections, item.size, item.color);
  return `${item.name}${sel ? ` (${sel})` : ""} × ${item.qty}`;
}

function daysTitle(opts?: { day?: string; days?: string[] }): string {
  const list = [...(opts?.days ?? (opts?.day ? [opts.day] : []))].sort();
  if (list.length === 0) return "Бүх өдөр";
  if (list.length === 1) return dayLabel(list[0]!);
  if (list.length <= 5) return list.map((d) => dayLabel(d)).join(", ");
  return `${dayLabel(list[0]!)} – ${dayLabel(list[list.length - 1]!)} · ${list.length} өдөр`;
}

export function printDeliveries(
  rows: AdminDelivery[],
  opts?: { day?: string; days?: string[]; district?: string; courier?: string },
): void {
  const groups = groupDeliveriesByDistrict(rows);
  const zones = splitDeliveryZones(groups);
  const dayTitle = daysTitle(opts);
  const cityN = groups.filter((g) => g.zone !== "aimag").length;
  const aimagN = groups.filter((g) => g.zone === "aimag").length;
  const subtitle = opts?.district
    ? `${placeTitle(opts.district)} — ${rows.length} хүргэлт`
    : [
        opts?.courier ? opts.courier : null,
        cityN ? `${cityN} дүүрэг` : null,
        aimagN ? `${aimagN} аймаг` : null,
        `${rows.length} хүргэлт`,
      ]
        .filter(Boolean)
        .join(" · ");

  const sections = (opts?.district ? [{ label: null as string | null, groups }] : zones)
    .map(({ label, groups: list }) => {
      const inner = list
        .map(({ title, rows: placeRows }) => {
          const cards = placeRows
            .map((row, i) => {
              const addr = addressLines(row)
                .map((line) => `<div class="addr">${esc(line)}</div>`)
                .join("");
              const items = row.order.items
                .map((item) => `<li>${esc(itemLine(item))}</li>`)
                .join("");
              const note = row.order.note?.trim()
                ? `<div class="note">Тэмдэглэл: ${esc(row.order.note.trim())}</div>`
                : "";
              const courier = row.courierName
                ? `<div class="meta">Жолооч: ${esc(row.courierName)}</div>`
                : "";

              return `<article class="card">
            <div class="card-head">
              <span class="idx">${i + 1}</span>
              <span class="code">${esc(row.order.code)}</span>
              <span class="status">${esc(STATUS_LABEL[row.status] ?? row.status)}</span>
            </div>
            <div class="who">
              <div class="name">${esc(row.order.customer.name ?? "Нэргүй")}</div>
              <div class="phone">${esc(phoneLabel(row.order.customer.phone))}</div>
            </div>
            ${addr}
            ${
              items
                ? `<div class="items-label">Бараа</div><ul class="items">${items}</ul>`
                : ""
            }
            ${note}
            <div class="meta">${esc(weekdayShort(row.scheduledDay))} · ${esc(dayLabel(row.scheduledDay))}</div>
            ${courier}
            <div class="tick">☐ Хүргэсэн</div>
          </article>`;
            })
            .join("");

          return `<section class="district">
        <h2>${esc(title)} <span>${placeRows.length} хүргэлт</span></h2>
        ${cards}
      </section>`;
        })
        .join("");

      if (!label) return inner;
      return `<section class="zone"><div class="zone-title">${esc(label)}</div>${inner}</section>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="mn">
<head>
  <meta charset="utf-8" />
  <title>Хүргэлт — ${esc(opts?.courier ?? opts?.district ?? dayTitle)}</title>
  <style>
    @page { size: A4; margin: 12mm 12mm 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Noto Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #1c1917;
      font-size: 12px;
      line-height: 1.4;
    }
    h1 { font-size: 18px; margin: 0 0 4px; font-weight: 650; }
    .zone { margin-bottom: 22px; }
    .zone-title { font-size: 16px; font-weight: 650; margin: 0 0 10px; }
    .sub { color: #57534e; margin-bottom: 14px; }
    .district { break-inside: avoid; margin-bottom: 18px; }
    .district h2 {
      font-size: 14px;
      margin: 0 0 8px;
      padding: 6px 8px;
      background: #f5f5f4;
      border: 1px solid #e7e5e4;
      border-radius: 4px;
    }
    .district h2 span { font-weight: 500; color: #57534e; }
    .card {
      break-inside: avoid;
      page-break-inside: avoid;
      border: 1px solid #d6d3d1;
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 8px;
    }
    .card-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
    .idx {
      font-variant-numeric: tabular-nums;
      font-weight: 650;
      min-width: 1.4em;
    }
    .code { font-variant-numeric: tabular-nums; font-weight: 650; font-size: 13px; }
    .status { margin-left: auto; color: #57534e; font-size: 11px; }
    .who { display: flex; justify-content: space-between; gap: 12px; margin: 2px 0 4px; }
    .name { font-size: 13px; font-weight: 600; }
    .phone { font-variant-numeric: tabular-nums; font-size: 13px; }
    .addr { font-size: 13px; }
    .items-label { margin-top: 6px; color: #57534e; font-size: 11px; }
    .items { margin: 2px 0 0; padding-left: 18px; }
    .items li { margin: 1px 0; }
    .note { margin-top: 6px; color: #44403c; }
    .meta { margin-top: 4px; color: #78716c; font-size: 11px; }
    .tick { margin-top: 8px; font-size: 12px; color: #44403c; }
    @media print {
      body { font-size: 11.5px; }
      .card { border-color: #a8a29e; }
    }
  </style>
</head>
<body>
  <h1>Хүргэлтийн жагсаалт${opts?.courier ? ` — ${esc(opts.courier)}` : ""}</h1>
  <div class="sub">${esc(dayTitle)} · ${esc(subtitle)} · ${esc(dayTimeLabel(new Date().toISOString()))}</div>
  ${sections || "<p>Хүргэлт олдсонгүй.</p>"}
</body>
</html>`;

  printHtml(html);
}
