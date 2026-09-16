import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkoutIdempotencyKey,
  clearCheckoutIdempotencyKey,
  rotateCheckoutIdempotencyKey,
} from "../lib/checkoutIdempotency.ts";

const store = new Map();
globalThis.sessionStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => {
    store.set(key, String(value));
  },
  removeItem: (key) => {
    store.delete(key);
  },
};

test("double click and refresh reuse one checkout key", () => {
  clearCheckoutIdempotencyKey();
  store.clear();
  const first = checkoutIdempotencyKey();
  const second = checkoutIdempotencyKey();
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f-]{36}$/i);
  assert.equal(store.get("itgel.checkout.idempotency"), first);
});

test("a completed checkout starts the next purchase with a new key", () => {
  clearCheckoutIdempotencyKey();
  store.clear();
  const first = checkoutIdempotencyKey();
  clearCheckoutIdempotencyKey();
  const second = checkoutIdempotencyKey();
  assert.notEqual(first, second);
});

test("a payload conflict rotates the key so the current cart can be submitted", () => {
  clearCheckoutIdempotencyKey();
  store.clear();
  const first = checkoutIdempotencyKey();
  const rotated = rotateCheckoutIdempotencyKey();
  assert.notEqual(first, rotated);
  assert.equal(checkoutIdempotencyKey(), rotated);
});
