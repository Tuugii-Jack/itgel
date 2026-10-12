import assert from "node:assert/strict";
import { test } from "node:test";
import { wholeTugrikFee } from "../lib/leasingMoney.ts";

test("leasing preview rounds half-tugrik fees correctly", () => {
  assert.equal(wholeTugrikFee(1_500, 14.1), 212);
  assert.equal(wholeTugrikFee(8_500, 11.7), 995);
});

test("every supported leasing rate matches the integer-money reference", () => {
  for (let tenths = 1; tenths <= 1_000; tenths++) {
    for (const subtotal of [125, 500, 1_500, 8_500, 2_147_483_647]) {
      assert.equal(wholeTugrikFee(subtotal, tenths / 10),
        Number((BigInt(subtotal) * BigInt(tenths) + 500n) / 1_000n));
    }
  }
});
