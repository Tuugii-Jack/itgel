import type { Setting } from '@prisma/client';
import { prisma } from '../prisma.js';

/** Хүргэлтийн дүүргүүд — төлбөрийг хүргэлтийн компани авна, дэлгүүр авдаггүй. */
export const DEFAULT_DISTRICTS = [
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

/** Хадгалах JSON — түлхүүр нь дүүргийн нэр, утга ашиглагдахгүй. */
export const DEFAULT_DELIVERY_FEES: Record<string, number> = Object.fromEntries(
  DEFAULT_DISTRICTS.map((district) => [district, 0]),
);

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

export function districtNames(settings: Setting): string[] {
  const table = (settings.deliveryFees ?? {}) as Record<string, unknown>;
  const keys = Object.keys(table).filter((k) => k.trim().length > 0);
  return keys.length > 0 ? keys : [...DEFAULT_DISTRICTS];
}

export function districtList(settings: Setting): { district: string; fee: number }[] {
  return districtNames(settings).map((district) => ({ district, fee: 0 }));
}
