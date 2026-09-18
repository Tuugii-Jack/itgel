import assert from "node:assert/strict";
import { test } from "node:test";
import { autoInvoiceDedupeKey, shouldIssueAutoInvoice } from "../lib/qpayAutoInvoice.ts";

test("same leftover stage and amount does not issue a second auto invoice", () => {
  const first = autoInvoiceDedupeKey({ code: "PH-ABC123", kind: "split", amount: 8333 });
  const again = autoInvoiceDedupeKey({ code: "PH-ABC123", kind: "split", amount: 8333 });
  assert.equal(first, again);
  assert.equal(shouldIssueAutoInvoice(null, first), true);
  assert.equal(shouldIssueAutoInvoice(first, again), false);
});

test("fee then principal, or a new amount, issues another invoice", () => {
  const fee = autoInvoiceDedupeKey({ code: "PH-ABC123", kind: "fee", amount: 2500 });
  const principal = autoInvoiceDedupeKey({ code: "PH-ABC123", kind: "split", amount: 8333 });
  const next = autoInvoiceDedupeKey({ code: "PH-ABC123", kind: "split", amount: 8334 });
  assert.equal(shouldIssueAutoInvoice(fee, principal), true);
  assert.equal(shouldIssueAutoInvoice(principal, next), true);
});

test("cargo invoices are distinct from leftover leasing invoices", () => {
  const leftover = autoInvoiceDedupeKey({ code: "PH-ABC123", kind: "split", amount: 15000 });
  const cargo = autoInvoiceDedupeKey({ code: "PH-ABC123", kind: "cargo", amount: 15000 });
  assert.notEqual(leftover, cargo);
  assert.equal(shouldIssueAutoInvoice(leftover, cargo), true);
});
