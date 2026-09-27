const KEY = "itgel.checkout.draft";

export type CheckoutPayMethod = "qpay" | "leasing";
export type CheckoutStep = "choose" | "pay";

export type CheckoutDraft = {
  customerId: string;
  note: string;
  payMethod: CheckoutPayMethod | null;
  step: CheckoutStep;
  pendingOrderCode: string;
  pendingAlso: string[];
};

const empty = (customerId = ""): CheckoutDraft => ({
  customerId,
  note: "",
  payMethod: null,
  step: "choose",
  pendingOrderCode: "",
  pendingAlso: [],
});

function storage(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

function parsePayMethod(raw: unknown): CheckoutPayMethod | null {
  return raw === "qpay" || raw === "leasing" ? raw : null;
}

function parseStep(raw: unknown, payMethod: CheckoutPayMethod | null): CheckoutStep {
  return raw === "pay" && payMethod ? "pay" : "choose";
}

export function readCheckoutDraft(customerId: string): CheckoutDraft {
  if (!customerId) return empty();
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return empty(customerId);
    const v = JSON.parse(raw) as Partial<CheckoutDraft> & { leasing?: unknown };
    const storedId = typeof v.customerId === "string" ? v.customerId : "";
    if (!storedId || storedId !== customerId) return empty(customerId);
    const payMethod =
      parsePayMethod(v.payMethod) ??
      (v.leasing === true ? "leasing" : v.leasing === false ? "qpay" : null);
    return {
      customerId,
      note: typeof v.note === "string" ? v.note : "",
      payMethod,
      step: parseStep(v.step, payMethod),
      pendingOrderCode: typeof v.pendingOrderCode === "string" ? v.pendingOrderCode : "",
      pendingAlso: Array.isArray(v.pendingAlso)
        ? v.pendingAlso.filter((code): code is string => typeof code === "string" && code.length > 0)
        : [],
    };
  } catch {
    return empty(customerId);
  }
}

/** Сонголтгүй pay алхам руу орохыг зөвшөөрөхгүй. */
export function resolveCheckoutStep(draft: Pick<CheckoutDraft, "step" | "payMethod">): CheckoutStep {
  return draft.step === "pay" && draft.payMethod ? "pay" : "choose";
}

export function writeCheckoutDraft(draft: CheckoutDraft): void {
  storage()?.setItem(
    KEY,
    JSON.stringify({
      customerId: draft.customerId,
      note: draft.note,
      payMethod: draft.payMethod,
      step: resolveCheckoutStep(draft),
      pendingOrderCode: draft.pendingOrderCode,
      pendingAlso: draft.pendingAlso,
    }),
  );
}

export function patchCheckoutDraft(customerId: string, patch: Partial<CheckoutDraft>): CheckoutDraft {
  const next = { ...readCheckoutDraft(customerId), ...patch, customerId };
  next.step = resolveCheckoutStep(next);
  writeCheckoutDraft(next);
  return next;
}

export function consumeCheckoutPending(customerId: string, orderCode: string): boolean {
  const draft = readCheckoutDraft(customerId);
  if (!draft.pendingOrderCode) return false;
  const codes = [draft.pendingOrderCode, ...draft.pendingAlso];
  if (!codes.includes(orderCode)) return false;
  clearCheckoutDraft();
  return true;
}

export function clearCheckoutDraft(): void {
  storage()?.removeItem(KEY);
}
