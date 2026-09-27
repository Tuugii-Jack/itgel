import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearCheckoutDraft,
  consumeCheckoutPending,
  patchCheckoutDraft,
  readCheckoutDraft,
  resolveCheckoutStep,
  writeCheckoutDraft,
} from "../lib/checkoutDraft.ts";
import { customerNameLabel } from "../lib/format.ts";

const emptyDraft = (customerId) => ({
  customerId,
  note: "",
  payMethod: null,
  step: "choose",
  pendingOrderCode: "",
  pendingAlso: [],
});

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
  assert.deepEqual(readCheckoutDraft("cust-a"), emptyDraft("cust-a"));
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

test("payMethod and step persist across reads; pay without method falls back to choose", () => {
  store.clear();
  writeCheckoutDraft({
    customerId: "cust-a",
    note: "орой",
    payMethod: "qpay",
    step: "pay",
    pendingOrderCode: "",
    pendingAlso: [],
  });
  const draft = readCheckoutDraft("cust-a");
  assert.equal(draft.payMethod, "qpay");
  assert.equal(draft.step, "pay");
  assert.equal(resolveCheckoutStep({ step: "pay", payMethod: null }), "choose");
  assert.equal(resolveCheckoutStep({ step: "pay", payMethod: "leasing" }), "pay");

  patchCheckoutDraft("cust-a", { step: "pay", payMethod: null });
  assert.equal(readCheckoutDraft("cust-a").step, "choose");
  assert.equal(readCheckoutDraft("cust-a").note, "орой");
});

test("legacy leasing boolean maps to payMethod", () => {
  store.clear();
  store.set(
    "itgel.checkout.draft",
    JSON.stringify({ customerId: "cust-a", note: "", leasing: true, step: "pay" }),
  );
  const draft = readCheckoutDraft("cust-a");
  assert.equal(draft.payMethod, "leasing");
  assert.equal(draft.step, "pay");
});

test("cart note patch keeps payMethod, step, and pending order", () => {
  store.clear();
  writeCheckoutDraft({
    customerId: "cust-a",
    note: "",
    payMethod: "leasing",
    step: "pay",
    pendingOrderCode: "PH-TEST",
    pendingAlso: ["PH-SPLIT"],
  });
  patchCheckoutDraft("cust-a", { note: "орой залга" });
  const draft = readCheckoutDraft("cust-a");
  assert.equal(draft.note, "орой залга");
  assert.equal(draft.payMethod, "leasing");
  assert.equal(draft.step, "pay");
  assert.equal(draft.pendingOrderCode, "PH-TEST");
  assert.deepEqual(draft.pendingAlso, ["PH-SPLIT"]);
});

test("consumeCheckoutPending clears only the matching pending order", () => {
  store.clear();
  writeCheckoutDraft({
    customerId: "cust-a",
    note: "x",
    payMethod: "qpay",
    step: "pay",
    pendingOrderCode: "PH-MAIN",
    pendingAlso: ["PH-EXTRA"],
  });
  assert.equal(consumeCheckoutPending("cust-a", "PH-OTHER"), false);
  assert.equal(readCheckoutDraft("cust-a").pendingOrderCode, "PH-MAIN");
  assert.equal(consumeCheckoutPending("cust-a", "PH-EXTRA"), true);
  assert.deepEqual(readCheckoutDraft("cust-a"), emptyDraft("cust-a"));
});

test("writeCheckoutDraft without payMethod does not stay on pay step", () => {
  store.clear();
  writeCheckoutDraft({
    customerId: "cust-a",
    note: "",
    payMethod: null,
    step: "pay",
    pendingOrderCode: "",
    pendingAlso: [],
  });
  assert.equal(readCheckoutDraft("cust-a").step, "choose");
});

