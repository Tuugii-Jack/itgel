import assert from "node:assert/strict";
import { test } from "node:test";
import { pruneSelectedIds } from "../lib/selectedIds.ts";

test("drops ids that are no longer pending", () => {
  const next = pruneSelectedIds("a,c", ["a", "b", "c"]);
  assert.deepEqual([...next].sort(), ["a", "c"]);
});

test("clears selection when nothing is pending", () => {
  const next = pruneSelectedIds("", ["a", "b"]);
  assert.equal(next.size, 0);
});

test("keeps an empty selection empty", () => {
  assert.equal(pruneSelectedIds("a,b", []).size, 0);
});
