export function parseWholeQuantity(raw: string, max = 1_000_000, allowZero = true): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1) && value <= max ? value : null;
}
export function handoverSearchKind(raw: string): "code" | "customer" {
  return /PH-[A-Z0-9]{6}/i.test(raw) ? "code" : "customer";
}
export function validCustomerContact(email: string, phone: string): boolean {
  const mail = email.trim(); const number = phone.replace(/[\s-]/g, "");
  return Boolean(mail || number) && (!mail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) && (!number || /^[5-9]\d{7}$/.test(number));
}
export function adminOrderPaymentChoice(value: "unpaid" | "cash" | "confirmed_unpaid") {
  return { status: value === "unpaid" ? "NEW" as const : "CONFIRMED" as const, markPaid: value === "cash" };
}
export function appendOptionValues(current: string[], raw: string): string[] {
  return [...new Set([...current, ...raw.split(/[,;\n]+/).map((value) => value.trim()).filter(Boolean)])];
}
