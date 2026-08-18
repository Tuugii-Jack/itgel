/**
 * Огнооны туслах — бүх бодолт `Asia/Ulaanbaatar` (UTC+8) цагийн бүсэд.
 * Монгол 2016 оноос хойш зуны цаг хэрэглэхээ больсон тул тогтмол +08:00 хангалттай.
 */

export const UB_OFFSET_MINUTES = 8 * 60;
export const UB_TZ = 'Asia/Ulaanbaatar';

const MS_DAY = 24 * 60 * 60 * 1000;
const MS_MINUTE = 60 * 1000;

/** UTC агшныг UB ханддаг "хана дээрх цаг"-т хөрвүүлсэн Date (зөвхөн дотоод бодолтод). */
function toUbWallClock(date: Date): Date {
  return new Date(date.getTime() + UB_OFFSET_MINUTES * MS_MINUTE);
}

function fromUbWallClock(wall: Date): Date {
  return new Date(wall.getTime() - UB_OFFSET_MINUTES * MS_MINUTE);
}

/** `YYYY-MM-DD` — UB цагаар. */
export function ubDateString(date: Date): string {
  return toUbWallClock(date).toISOString().slice(0, 10);
}

/** UB өдрийн эхлэл (00:00:00 UB) — UTC агшин болгож буцаана. */
export function startOfUbDay(date: Date): Date {
  const wall = toUbWallClock(date);
  wall.setUTCHours(0, 0, 0, 0);
  return fromUbWallClock(wall);
}

/** UB өдрийн төгсгөл (23:59:59.999 UB). */
export function endOfUbDay(date: Date): Date {
  return new Date(startOfUbDay(date).getTime() + MS_DAY - 1);
}

/** `YYYY-MM-DD` мөрийг UB өдрийн эхлэл болгож уншина. */
export function parseUbDay(day: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`Огноо буруу байна: ${day} (YYYY-MM-DD байх ёстой)`);
  const [, y, mo, d] = m;
  const wall = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 0, 0, 0, 0));
  return fromUbWallClock(wall);
}

/** Хоног нэмэх — цагийн хэсгийг хэвээр үлдээнэ. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_DAY);
}

/** UB өдрөөр тоолсон зөрүү (a − b). */
export function diffUbDays(a: Date, b: Date): number {
  return Math.round((startOfUbDay(a).getTime() - startOfUbDay(b).getTime()) / MS_DAY);
}

/** UB сарын эхлэл. */
export function startOfUbMonth(date: Date): Date {
  const wall = toUbWallClock(date);
  wall.setUTCDate(1);
  wall.setUTCHours(0, 0, 0, 0);
  return fromUbWallClock(wall);
}

/** UB сар нэмэх/хасах. */
export function addUbMonths(date: Date, months: number): Date {
  const wall = toUbWallClock(date);
  wall.setUTCMonth(wall.getUTCMonth() + months);
  return fromUbWallClock(wall);
}

/** `YYYY-MM` — UB цагаар. */
export function ubMonthKey(date: Date): string {
  return toUbWallClock(date).toISOString().slice(0, 7);
}

/**
 * Гарт очих огноо. Бэлэн бараа (`closeAt = null`) маргааш авна.
 * Урьдчилсан захиалгад энэ функцийг ашиглахгүй — ирэх огноо багцын ETA.
 */
export function computeArrival(
  closeAt: Date | null,
  leadMinDays: number,
  leadMaxDays: number,
  now: Date = new Date(),
): { arriveFrom: Date; arriveTo: Date; isReady: boolean } {
  if (closeAt === null) {
    const tomorrow = startOfUbDay(addDays(now, 1));
    return { arriveFrom: tomorrow, arriveTo: tomorrow, isReady: true };
  }
  return {
    arriveFrom: addDays(closeAt, leadMinDays),
    arriveTo: addDays(closeAt, leadMaxDays),
    isReady: false,
  };
}

export const toIso = (date: Date | null | undefined): string | null =>
  date ? date.toISOString() : null;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function ubYmd(date: Date): { year: number; month: number; day: number } {
  const wall = toUbWallClock(date);
  return { year: wall.getUTCFullYear(), month: wall.getUTCMonth() + 1, day: wall.getUTCDate() };
}

/** UB сарын хоногийн тоо. */
export function ubDaysInMonth(year: number, month: number): number {
  const start = parseUbDay(`${year}-${pad2(month)}-01`);
  return diffUbDays(addUbMonths(start, 1), start);
}

/**
 * Сар бүрийн буцаалтын өдрүүд — 10, 20, 30 (богино сард сарын сүүл).
 * 10-оос өмнө буцаасан нь 10-нд, 20-оос өмнө нь 20-нд, 30-аас өмнө нь 30-нд орно.
 * Тухайн өдөр өөрөө (10/20/30) дараагийн цонх руу орно.
 */
export function payoutDaysInMonth(year: number, month: number): string[] {
  const third = Math.min(30, ubDaysInMonth(year, month));
  return [
    `${year}-${pad2(month)}-10`,
    `${year}-${pad2(month)}-20`,
    `${year}-${pad2(month)}-${pad2(third)}`,
  ];
}

export function isPayoutDay(day: string): boolean {
  const { year, month } = ubYmd(parseUbDay(day));
  return payoutDaysInMonth(year, month).includes(day);
}

/** Буцаалт хийсэн агшныг аль 10/20/30-нд орохыг тооцоолно. */
export function payoutDateForReturn(at: Date): string {
  const { year, month, day } = ubYmd(at);
  if (day < 10) return `${year}-${pad2(month)}-10`;
  if (day < 20) return `${year}-${pad2(month)}-20`;
  if (day < 30) return `${year}-${pad2(month)}-${pad2(Math.min(30, ubDaysInMonth(year, month)))}`;
  if (month === 12) return `${year + 1}-01-10`;
  return `${year}-${pad2(month + 1)}-10`;
}

/** Тухайн 10/20/30-нд орох буцаалтын цонх (UB). */
export function payoutWindow(payoutDay: string): { gte: Date; lte: Date } {
  const parsed = parseUbDay(payoutDay);
  const { year, month, day } = ubYmd(parsed);
  const third = Math.min(30, ubDaysInMonth(year, month));
  if (day === 10) {
    const prev = addUbMonths(startOfUbMonth(parsed), -1);
    const { year: py, month: pm } = ubYmd(prev);
    const fromDay = Math.min(30, ubDaysInMonth(py, pm));
    return {
      gte: parseUbDay(`${py}-${pad2(pm)}-${pad2(fromDay)}`),
      lte: endOfUbDay(parseUbDay(`${year}-${pad2(month)}-09`)),
    };
  }
  if (day === 20) {
    return {
      gte: parseUbDay(`${year}-${pad2(month)}-10`),
      lte: endOfUbDay(parseUbDay(`${year}-${pad2(month)}-19`)),
    };
  }
  if (day === third) {
    const endDay = third < 30 ? third : 29;
    return {
      gte: parseUbDay(`${year}-${pad2(month)}-20`),
      lte: endOfUbDay(parseUbDay(`${year}-${pad2(month)}-${pad2(endDay)}`)),
    };
  }
  throw new Error(`Буцаалтын өдөр биш: ${payoutDay} (10, 20, 30)`);
}
