const KEY = "itgel.checkout.draft";

export type CheckoutDraft = {
  name: string;
  phone: string;
  note: string;
};

const empty = (): CheckoutDraft => ({ name: "", phone: "", note: "" });

export function readCheckoutDraft(): CheckoutDraft {
  if (typeof window === "undefined") return empty();
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return empty();
    const v = JSON.parse(raw) as Partial<CheckoutDraft>;
    return {
      name: typeof v.name === "string" ? v.name : "",
      phone: typeof v.phone === "string" ? v.phone : "",
      note: typeof v.note === "string" ? v.note : "",
    };
  } catch {
    return empty();
  }
}

export function writeCheckoutDraft(draft: CheckoutDraft): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(KEY, JSON.stringify(draft));
}

export function clearCheckoutDraft(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(KEY);
}
