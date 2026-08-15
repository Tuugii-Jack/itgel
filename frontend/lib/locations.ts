/** Улаанбаатарын дүүргүүд — тохиргооноос өөрчлөгдөж болно. */
export const UB_DISTRICTS = [
  "Баянгол",
  "Сүхбаатар",
  "Чингэлтэй",
  "Хан-Уул",
  "Баянзүрх",
  "Сонгинохайрхан",
  "Налайх",
  "Багануур",
  "Багахангай",
] as const;

/** Монгол улсын 21 аймаг. */
export const AIMAGS = [
  "Архангай",
  "Баян-Өлгий",
  "Баянхонгор",
  "Булган",
  "Говь-Алтай",
  "Говьсүмбэр",
  "Дархан-Уул",
  "Дорноговь",
  "Дорнод",
  "Дундговь",
  "Завхан",
  "Орхон",
  "Өвөрхангай",
  "Өмнөговь",
  "Сүхбаатар",
  "Сэлэнгэ",
  "Төв",
  "Увс",
  "Ховд",
  "Хөвсгөл",
  "Хэнтий",
] as const;

export type DeliveryZone = "city" | "aimag";

const AIMAG_SUFFIX = " аймаг";

export function aimagStoredName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.endsWith(AIMAG_SUFFIX)) return trimmed;
  return `${trimmed}${AIMAG_SUFFIX}`;
}

export function aimagDisplayName(stored: string): string {
  const trimmed = stored.trim();
  return trimmed.endsWith(AIMAG_SUFFIX)
    ? trimmed.slice(0, -AIMAG_SUFFIX.length)
    : trimmed;
}

export function isAimagPlace(stored: string | null | undefined): boolean {
  if (!stored) return false;
  const display = aimagDisplayName(stored);
  return (AIMAGS as readonly string[]).includes(display);
}

export function inferDeliveryZone(
  stored: string | null | undefined,
  cityDistricts: readonly string[],
): DeliveryZone | null {
  if (!stored) return null;
  if (isAimagPlace(stored)) return "aimag";
  if (cityDistricts.includes(stored)) return "city";
  return null;
}

/** Хоосон биш, аймаг биш бол хот (тохиргооны нэмэлт дүүрэг ороод). */
export function placeZone(stored: string | null | undefined): DeliveryZone | "other" {
  const trimmed = stored?.trim() ?? "";
  if (!trimmed) return "other";
  if (isAimagPlace(trimmed)) return "aimag";
  return "city";
}

export function placeTitle(stored: string | null | undefined): string {
  const trimmed = stored?.trim() ?? "";
  if (!trimmed) return "Байршилгүй";
  if (isAimagPlace(trimmed)) return aimagDisplayName(trimmed);
  return trimmed;
}

export function zoneLabel(zone: DeliveryZone | "other"): string {
  if (zone === "aimag") return "Аймаг";
  if (zone === "city") return "Хот";
  return "Бусад";
}

/** Жишээ: «Баянгол, 15-р хороо» эсвэл «Архангай аймаг, 1-р сум». */
export function formatPlaceLine(
  district: string | null | undefined,
  khoroo?: string | null,
): string {
  const zone = placeZone(district);
  const title = placeTitle(district);
  const head = zone === "aimag" ? `${title} аймаг` : title;
  return [head, khoroo?.trim()].filter(Boolean).join(", ");
}

export const ZONE_SORT: Record<DeliveryZone | "other", number> = {
  city: 0,
  aimag: 1,
  other: 2,
};
