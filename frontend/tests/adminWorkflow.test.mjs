import assert from "node:assert/strict";
import { test } from "node:test";
import { adminOrderPaymentChoice, appendOptionValues, handoverSearchKind, parseWholeQuantity, validCustomerContact } from "../lib/adminWorkflow.ts";
import { reportCsv } from "../lib/reportCsv.ts";
test("order creation never records income before QPay payment", () => {
  assert.deepEqual(adminOrderPaymentChoice("unpaid"), { status: "NEW", markPaid: false });
  assert.deepEqual(adminOrderPaymentChoice("confirmed_unpaid"), { status: "CONFIRMED", markPaid: false });
});
test("customer creation accepts phone or email and rejects invalid supplied fields", () => {
  assert.equal(validCustomerContact("", "99112233"), true);
  assert.equal(validCustomerContact("", "55112233"), true);
  assert.equal(validCustomerContact("user@example.test", ""), true);
  for (const pair of [["", ""], ["invalid", "99112233"], ["", "1234"], ["", "19112233"], ["user@example.test", "-1"]]) assert.equal(validCustomerContact(...pair), false);
});
test("handover uses order codes and QR links while names and phones use customer lookup", () => {
  for (const text of ["PH-ABC123", "ph-abc123", "https://example.test/pickup?code=PH-ABC123"]) assert.equal(handoverSearchKind(text), "code");
  for (const text of ["99112233", "Бат-Эрдэнэ", "user@example.test"]) assert.equal(handoverSearchKind(text), "customer");
});
test("whole quantities reject decimals, negative and overflow rather than stripping symbols", () => {
  assert.equal(parseWholeQuantity("0"), 0); assert.equal(parseWholeQuantity("50", 50, false), 50);
  for (const text of ["1.5", "-1", "1e2", "51", "9007199254740992", ""]) assert.equal(parseWholeQuantity(text, 50), null);
  assert.equal(parseWholeQuantity("0", 50, false), null);
});
test("option values can be pasted together without duplicates or splitting spaces", () => {
  assert.deepEqual(appendOptionValues(["S"], "M, L; XL\nS"), ["S", "M", "L", "XL"]);
  assert.deepEqual(appendOptionValues([], "25 см, 30 см"), ["25 см", "30 см"]);
});
test("CSV preserves exact amounts, quotations, and blocks spreadsheet formulas in names", () => {
  const csv = reportCsv(["Нэр", "Дүн"], [['=HYPERLINK("bad")', 120000], ['Бараа, "А"', -12], [" @SUM(A1)", null]]);
  assert.ok(csv.startsWith("\ufeff")); assert.ok(csv.includes('"120000"'));
  assert.ok(csv.includes(`"'=HYPERLINK(""bad"")"`)); assert.ok(csv.includes('"Бараа, ""А"""'));
  assert.ok(csv.includes('"-12"')); assert.ok(csv.includes(`"' @SUM(A1)"`));
});
