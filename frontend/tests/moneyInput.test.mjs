import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMoneyInput, parseNonnegativeMoneyInput } from "../lib/moneyInput.ts";

test("money fields accept whole tugrik and correctly grouped pasted amounts", () => {
  for (const text of ["120000", "120,000", "120 000", "120\u00a0000", "120\u202f000", " 120,000 "]) {
    assert.equal(parseMoneyInput(text), 120_000);
  }
  assert.equal(parseMoneyInput("1"), 1);
  assert.equal(parseMoneyInput("2,147,483,647"), 2_147_483_647);
});

test("money fields reject input that stripping symbols would silently inflate", () => {
  for (const text of ["1000.50", "1,000.50", "1,20", "120 00", "-120000", "+120000", "1e5", "₮120000", "120000₮", "", " ", "0", "000", "Infinity", "2147483648", "9007199254740992"]) {
    assert.equal(parseMoneyInput(text), null, text);
  }
});

test("money fields enforce the refund limit exactly", () => {
  assert.equal(parseMoneyInput("120,000", 120_000), 120_000);
  assert.equal(parseMoneyInput("120,001", 120_000), null);
  assert.equal(parseMoneyInput("1", 0), null);
});
test("cargo allows zero but never turns decimal fees into larger whole amounts", () => {
  assert.equal(parseNonnegativeMoneyInput(""), 0);
  assert.equal(parseNonnegativeMoneyInput("0"), 0);
  assert.equal(parseNonnegativeMoneyInput("1,000"), 1000);
  for (const raw of ["1000.50", "-100", "0.5", "1e3", "1,00"]) assert.equal(parseNonnegativeMoneyInput(raw), null);
});
