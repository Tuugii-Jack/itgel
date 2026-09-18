import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearCheckoutDraft,
  readCheckoutDraft,
  writeCheckoutDraft,
} from "../lib/checkoutDraft.ts";
import { customerNameLabel } from "../lib/format.ts";

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

test("checkout draft keeps only this customer's note", () => {
  store.clear();
  writeCheckoutDraft({ customerId: "cust-a", note: "орой залга" });
  assert.equal(readCheckoutDraft("cust-a").note, "орой залга");
  assert.equal(readCheckoutDraft("cust-b").note, "");
  assert.equal(readCheckoutDraft("cust-b").customerId, "cust-b");
});

test("legacy name/phone drafts are not reused after account change", () => {
  store.clear();
  store.set(
    "itgel.checkout.draft",
    JSON.stringify({ name: "Хуучин", phone: "99112233", note: "хуучин тэмдэглэл" }),
  );
  assert.deepEqual(readCheckoutDraft("cust-a"), { customerId: "cust-a", note: "" });
});

test("clearing the draft drops the previous customer's note", () => {
  store.clear();
  writeCheckoutDraft({ customerId: "cust-a", note: "сануулга" });
  clearCheckoutDraft();
  assert.equal(readCheckoutDraft("cust-a").note, "");
});

test("empty profile names stay empty in data and show Нэргүй in admin", () => {
  assert.equal(customerNameLabel(null), "Нэргүй");
  assert.equal(customerNameLabel(""), "Нэргүй");
  assert.equal(customerNameLabel("  "), "Нэргүй");
  assert.equal(customerNameLabel("Батаа"), "Батаа");
});
