import type { PublicOrder } from "./types";

/** One cache per mounted customer scope; never share it between accounts. */
export function createTrackedOrderCache(loadOrder: (code: string) => Promise<PublicOrder>) {
  const orders = new Map<string, PublicOrder>();
  const inflight = new Map<string, Promise<PublicOrder>>();
  const normalize = (code: string) => code.trim().toUpperCase();

  const peek = (code: string): PublicOrder | null => orders.get(normalize(code)) ?? null;

  const fetch = (code: string): Promise<PublicOrder> => {
    const key = normalize(code);
    const pending = inflight.get(key);
    if (pending) return pending;
    const request = loadOrder(key)
      .then((order) => {
        orders.set(key, order);
        return order;
      })
      .catch((error: unknown) => {
        orders.delete(key);
        throw error;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, request);
    return request;
  };

  const prefetch = (code: string): void => {
    if (peek(code) || inflight.has(normalize(code))) return;
    void fetch(code).catch(() => undefined);
  };

  return { peek, fetch, prefetch };
}

/** Temporary network failures may keep the current view, denied access may not. */
export function trackedOrderAfterError(
  current: PublicOrder | null,
  error: unknown,
): PublicOrder | null {
  if (
    error !== null &&
    typeof error === "object" &&
    "status" in error &&
    (error.status === 401 || error.status === 403 || error.status === 404)
  ) {
    return null;
  }
  return current;
}
