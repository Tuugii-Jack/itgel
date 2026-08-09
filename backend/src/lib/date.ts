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
 * Гарт очих огноо. Захиалгын бараа (`closeAt` байгаа) дээр
 * `arriveFrom = closeAt + leadMinDays`, `arriveTo = closeAt + leadMaxDays`.
 * Бэлэн бараа (`closeAt = null`) маргааш авна.
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
