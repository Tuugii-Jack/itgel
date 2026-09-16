const STORAGE_KEY = "itgel.leasing-sms-customized";

function readIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0));
  } catch {
    return new Set();
  }
}

export function hasCustomizedSms(customerId: string): boolean {
  if (!customerId) return false;
  return readIds().has(customerId);
}

export function markCustomizedSms(customerId: string): void {
  if (!customerId || typeof localStorage === "undefined") return;
  const ids = readIds();
  ids.add(customerId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

export function smsTextsEqual(a: string, b: string): boolean {
  return a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
}
