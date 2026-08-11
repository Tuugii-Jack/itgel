// Бүх огноо Asia/Ulaanbaatar цагаар харагдана — backend-тэй ижил.

const TZ = "Asia/Ulaanbaatar";

/** 89000 → "89,000₮" */
export function money(amount: number): string {
  return `${amount.toLocaleString("en-US")}₮`;
}

/** 89000 → "89,000" (тэмдэггүй) */
export function num(amount: number): string {
  return amount.toLocaleString("en-US");
}

function parts(iso: string | Date) {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: map.hour === "24" ? "00" : map.hour,
    minute: map.minute,
  };
}

/** "9-р сарын 12" */
export function dayLabel(iso: string | Date): string {
  const p = parts(iso);
  return `${p.month}-р сарын ${p.day}`;
}

/** "9-р сарын 12, 14:20" */
export function dayTimeLabel(iso: string | Date): string {
  const p = parts(iso);
  return `${p.month}-р сарын ${p.day}, ${p.hour}:${p.minute}`;
}

/** "9-р сарын 12-16" — нэг сард бол өдрийг л давтана. */
export function rangeLabel(fromIso: string, toIso: string): string {
  const a = parts(fromIso);
  const b = parts(toIso);
  if (a.month === b.month && a.day === b.day) return dayLabel(fromIso);
  if (a.month === b.month) return `${a.month}-р сарын ${a.day}-${b.day}`;
  return `${dayLabel(fromIso)} – ${dayLabel(toIso)}`;
}

/** "2026-08-12" (input[type=date] болон API-д) */
export function dayKey(iso: string | Date): string {
  const p = parts(iso);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "2026-08-12T14:30" — input[type=datetime-local], UB цагаар. */
export function datetimeLocalKey(iso: string | Date): string {
  const p = parts(iso);
  return `${dayKey(iso)}T${p.hour}:${p.minute}`;
}

/** datetime-local утгыг UB (+08:00) ISO болгоно. */
export function fromDatetimeLocal(value: string): string {
  const v = value.trim();
  if (!v) return "";
  // "2026-08-12T14:30" эсвэл "2026-08-12T14:30:00"
  const withSec = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00` : v;
  return new Date(`${withSec}+08:00`).toISOString();
}

const WEEKDAYS: Record<string, string> = {
  Sun: "Ня",
  Mon: "Да",
  Tue: "Мя",
  Wed: "Лх",
  Thu: "Пү",
  Fri: "Ба",
  Sat: "Бя",
};

/** "Пү" — UB цагаар. */
export function weekdayShort(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const en = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
  }).format(date);
  return WEEKDAYS[en] ?? "";
}

/** UB цагаар өдрийн зөрүү (a − b), календарийн хоногоор. */
export function daysBetween(a: string | Date, b: string | Date = new Date()): number {
  const pa = parts(a);
  const pb = parts(b);
  const ua = Date.UTC(pa.year, pa.month - 1, pa.day);
  const ub = Date.UTC(pb.year, pb.month - 1, pb.day);
  return Math.round((ua - ub) / 86_400_000);
}

/** "Өнөөдөр" / "Маргааш" / "9-р сарын 12" */
export function relativeDay(iso: string): string {
  const diff = daysBetween(iso);
  if (diff === 0) return "Өнөөдөр";
  if (diff === 1) return "Маргааш";
  if (diff === -1) return "Өчигдөр";
  return dayLabel(iso);
}

/** Захиалга хаагдах хүртэл: "1 хоног 3 цаг 12 мин 5 сек үлдсэн", "Хаагдсан" */
export function countdown(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - now.getTime();
  if (ms <= 0) return "Хаагдсан";

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days} хоног ${hours} цаг ${minutes} мин ${seconds} сек үлдсэн`;
  }
  if (hours > 0) return `${hours} цаг ${minutes} мин ${seconds} сек үлдсэн`;
  if (minutes > 0) return `${minutes} мин ${seconds} сек үлдсэн`;
  return `${seconds} сек үлдсэн`;
}

/** Гарт очих огноо — бэлэн бараанд "Маргааш". */
export function arrivalLabel(product: {
  type: "order" | "ready";
  arriveFrom: string;
  arriveTo: string;
}): string {
  if (product.type === "ready") return relativeDay(product.arriveFrom);
  return rangeLabel(product.arriveFrom, product.arriveTo);
}

/** "99112233" → "9911-2233" */
export function phoneLabel(phone: string | null | undefined): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : phone;
}

/** "2026-03" → "3-р сар" */
export function monthLabel(key: string): string {
  const month = Number(key.split("-")[1]);
  return `${month}-р сар`;
}

export const percent = (value: number): string => `${value}%`;
