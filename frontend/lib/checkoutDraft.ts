const KEY = "itgel.checkout.draft";

export type CheckoutDraft = {
  customerId: string;
  note: string;
};

const empty = (customerId = ""): CheckoutDraft => ({ customerId, note: "" });

function storage(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function readCheckoutDraft(customerId: string): CheckoutDraft {
  if (!customerId) return empty();
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return empty(customerId);
    const v = JSON.parse(raw) as Partial<CheckoutDraft>;
    const storedId = typeof v.customerId === "string" ? v.customerId : "";
    if (!storedId || storedId !== customerId) return empty(customerId);
    return {
      customerId,
      note: typeof v.note === "string" ? v.note : "",
    };
  } catch {
    return empty(customerId);
  }
}

export function writeCheckoutDraft(draft: CheckoutDraft): void {
  storage()?.setItem(
    KEY,
    JSON.stringify({ customerId: draft.customerId, note: draft.note }),
  );
}

export function clearCheckoutDraft(): void {
  storage()?.removeItem(KEY);
}
