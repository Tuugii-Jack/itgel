import type { Setting } from '@prisma/client';
import { prisma } from '../prisma.js';

/** Хүргэлтийн хураамжийн үндсэн хүснэгт — дүүргээр 5,000–8,000₮. */
export const DEFAULT_DELIVERY_FEES: Record<string, number> = {
  'Баянгол': 5000,
  'Сүхбаатар': 5000,
  'Чингэлтэй': 5000,
  'Хан-Уул': 6000,
  'Баянзүрх': 6000,
  'Сонгинохайрхан': 7000,
  'Налайх': 8000,
  'Багануур': 8000,
  'Багахангай': 8000,
};

/** DB round-trip багасгах — тохиргоо бараг өөрчлөгддөггүй. */
let settingsCache: { value: Setting; at: number } | null = null;
const SETTINGS_TTL_MS = 60_000;

/** Singleton — байхгүй бол анхны утгаараа үүснэ. */
export async function getSettings(): Promise<Setting> {
  const existing = await prisma.setting.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.setting.create({
    data: { id: 1, deliveryFees: DEFAULT_DELIVERY_FEES },
  });
}

/** 60 сек cache — жагсаалт/sync бүрт Setting уншихгүй. */
export async function getSettingsCached(): Promise<Setting> {
  const now = Date.now();
  if (settingsCache && now - settingsCache.at < SETTINGS_TTL_MS) {
    return settingsCache.value;
  }
  const value = await getSettings();
  settingsCache = { value, at: now };
  return value;
}

export function invalidateSettingsCache(): void {
  settingsCache = null;
}

export function deliveryFeeFor(settings: Setting, district: string): number {
  const table = (settings.deliveryFees ?? {}) as Record<string, unknown>;
  const value = table[district];
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  return DEFAULT_DELIVERY_FEES[district] ?? 8000;
}

export function districtList(settings: Setting): { district: string; fee: number }[] {
  const table = (settings.deliveryFees ?? {}) as Record<string, unknown>;
  const keys = Object.keys(table).length > 0 ? Object.keys(table) : Object.keys(DEFAULT_DELIVERY_FEES);
  return keys.map((district) => ({ district, fee: deliveryFeeFor(settings, district) }));
}
