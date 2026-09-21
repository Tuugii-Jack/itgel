import assert from "node:assert/strict";
import { test } from "node:test";
import { clearStoredTokens, readToken, writeToken } from "../lib/api/tokens.ts";

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
  },
  location: { protocol: "http:" },
};
globalThis.document = { cookie: "" };

test("sign-out helper clears both tokens so the next user cannot reuse them", () => {
  store.clear();
  writeToken("admin", "admin-jwt");
  writeToken("customer", "customer-jwt");
  assert.equal(readToken("admin"), "admin-jwt");
  clearStoredTokens();
  assert.equal(readToken("admin"), null);
  assert.equal(readToken("customer"), null);
});
