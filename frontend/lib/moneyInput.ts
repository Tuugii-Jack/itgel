/** Бутархай дүнгийн цэгийг арилгаж 100 дахин өсгөхгүй. */
export function parseMoneyInput(raw: string, max = 2_147_483_647): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text) && !/^\d{1,3}(?:[, \u00a0\u202f]\d{3})+$/.test(text)) return null;
  const amount = Number(text.replace(/[, \u00a0\u202f]/g, ""));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= max ? amount : null;
}
