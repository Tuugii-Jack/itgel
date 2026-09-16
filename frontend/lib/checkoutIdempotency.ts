const STORAGE_KEY = "itgel.checkout.idempotency";

let memoryKey: string | null = null;

function storage(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

/** Нэг checkout үйлдлийн key — refresh/retry ижил, шинэ худалдан авалт өөр. */
export function checkoutIdempotencyKey(): string {
  if (memoryKey) return memoryKey;
  const stored = storage()?.getItem(STORAGE_KEY);
  if (stored) {
    memoryKey = stored;
    return stored;
  }
  const created = crypto.randomUUID();
  memoryKey = created;
  storage()?.setItem(STORAGE_KEY, created);
  return created;
}

export function clearCheckoutIdempotencyKey(): void {
  memoryKey = null;
  storage()?.removeItem(STORAGE_KEY);
}

export function rotateCheckoutIdempotencyKey(): string {
  clearCheckoutIdempotencyKey();
  return checkoutIdempotencyKey();
}
