/** Улаанбаатарын дүүргүүд — тохиргооноос өөрчлөгдөж болно. */
export const UB_DISTRICTS = [
  'Баянгол',
  'Сүхбаатар',
  'Чингэлтэй',
  'Хан-Уул',
  'Баянзүрх',
  'Сонгинохайрхан',
  'Налайх',
  'Багануур',
  'Багахангай',
] as const;

/** Монгол улсын 21 аймаг. */
export const AIMAGS = [
  'Архангай',
  'Баян-Өлгий',
  'Баянхонгор',
  'Булган',
  'Говь-Алтай',
  'Говьсүмбэр',
  'Дархан-Уул',
  'Дорноговь',
  'Дорнод',
  'Дундговь',
  'Завхан',
  'Орхон',
  'Өвөрхангай',
  'Өмнөговь',
  'Сүхбаатар',
  'Сэлэнгэ',
  'Төв',
  'Увс',
  'Ховд',
  'Хөвсгөл',
  'Хэнтий',
] as const;

const AIMAG_SUFFIX = ' аймаг';

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

export function normalizeDeliveryPlace(
  district: string,
  cityDistricts: readonly string[],
): string | null {
  const trimmed = district.trim();
  if (!trimmed) return null;
  if (cityDistricts.includes(trimmed)) return trimmed;
  if (isAimagPlace(trimmed)) return aimagStoredName(trimmed);
  return null;
}
