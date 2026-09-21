import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendUniqueById,
  emptyPayUiState,
  historyDateLabel,
  mergeSelectionOnPage,
  mergeSelectionOnReload,
  payRequestFromPreview,
  restoredQpay,
  selectedRemainingTotal,
} from "../features/leasing/settlements/selection.ts";

test("reload drops rows that are no longer selectable and refreshes remaining", () => {
  const prev = new Map([
    ["open", { remaining: 10_000, orderId: "o1" }],
    ["locked", { remaining: 20_000, orderId: "o2" }],
    ["gone", { remaining: 5_000, orderId: "o3" }],
  ]);
  const next = mergeSelectionOnReload(prev, [
    { id: "open", remainingAmount: 8_000, orderId: "o1", selectable: true },
    { id: "locked", remainingAmount: 20_000, orderId: "o2", selectable: false },
  ]);
  assert.equal(next.get("open")?.remaining, 8_000);
  assert.equal(next.has("locked"), false);
  assert.equal(next.has("gone"), true);
});

test("pagination refreshes selected rows on the new page without dropping others", () => {
  const prev = new Map([
    ["kept", { remaining: 1, orderId: "o1" }],
    ["page2", { remaining: 9_000, orderId: "o2" }],
  ]);
  const next = mergeSelectionOnPage(prev, [
    { id: "page2", remainingAmount: 7_000, orderId: "o2", selectable: true },
    { id: "other", remainingAmount: 3_000, orderId: "o3", selectable: true },
  ]);
  assert.equal(next.get("kept")?.remaining, 1);
  assert.equal(next.get("page2")?.remaining, 7_000);
  assert.equal(next.has("other"), false);
});

test("load-more appends unique settlement ids only", () => {
  const rows = appendUniqueById(
    [{ id: "a" }, { id: "b" }],
    [{ id: "b" }, { id: "c" }],
  );
  assert.deepEqual(rows.map((row) => row.id), ["a", "b", "c"]);
});

test("partial-pay preview is sent as the live allocation request", () => {
  const request = payRequestFromPreview({
    amount: 10_000,
    allocations: [
      { settlementId: "s-old", amount: 7_000 },
      { settlementId: "s-new", amount: 3_000 },
    ],
  });
  assert.equal(request.amount, 10_000);
  assert.deepEqual(request.settlementIds, ["s-old", "s-new"]);
  assert.equal(selectedRemainingTotal(new Map([["s-old", { remaining: 7_000, orderId: "o1" }]])), 7_000);
});

test("QR resume uses the pending QPay payment, not a confirmed one", () => {
  const pending = restoredQpay([
    { id: "bank", method: "BANK_TRANSFER", status: "PENDING" },
    { id: "done", method: "QPAY", status: "CONFIRMED", invoice: { invoiceId: "old" } },
    { id: "live", method: "QPAY", status: "PENDING", invoice: { invoiceId: "inv-1" }, invoicePending: false },
  ]);
  assert.equal(pending?.id, "live");
  assert.equal(pending?.invoice?.invoiceId, "inv-1");
});

test("uncertain QPay stays pending and is not treated as paid or cancelled", () => {
  const pending = restoredQpay([
    { id: "unc", method: "QPAY", status: "PENDING", invoice: null, invoicePending: true },
  ]);
  assert.equal(pending?.id, "unc");
  assert.equal(pending?.status, "PENDING");
  assert.equal(pending?.invoicePending, true);
  assert.equal(pending?.invoice ?? null, null);
});

test("switching user starts from empty pay UI state", () => {
  const cleared = emptyPayUiState();
  assert.equal(cleared.selected.size, 0);
  assert.equal(cleared.invoice, null);
  assert.equal(cleared.paymentId, null);
  assert.equal(cleared.preview, null);
});

test("history hides unproven dates and marks audit backfill", () => {
  assert.equal(historyDateLabel({ confirmedAt: null, confirmedAtSource: null }), "огноо тодорхойгүй");
  assert.equal(
    historyDateLabel({ confirmedAt: "2026-09-18T04:00:00.000Z", confirmedAtSource: "AUDIT" }),
    "2026-09-18 · нөхсөн огноо",
  );
  assert.equal(
    historyDateLabel({ confirmedAt: "2026-09-18T04:00:00.000Z", confirmedAtSource: "EVENT" }),
    "2026-09-18",
  );
});
