import assert from "node:assert/strict";
import { test } from "node:test";
import { safeNextPath, workspaceHome } from "../lib/safeNext.ts";

test("safe next keeps internal workspace/profile paths", () => {
  assert.equal(safeNextPath("/workspace/shop"), "/workspace/shop");
  assert.equal(safeNextPath("/profile"), "/profile");
  assert.equal(safeNextPath("/checkout"), "/checkout");
});

test("safe next rejects open redirects and retired admin paths", () => {
  assert.equal(safeNextPath("https://evil.test"), null);
  assert.equal(safeNextPath("//evil.test"), null);
  assert.equal(safeNextPath("/admin"), null);
  assert.equal(safeNextPath("/admin/login"), null);
  assert.equal(safeNextPath("/leasing/login"), null);
});

test("workspace home follows role without picking a higher one", () => {
  assert.equal(workspaceHome("LEASING"), "/workspace/leasing");
  assert.equal(workspaceHome("STAFF"), "/workspace/shop");
  assert.equal(workspaceHome("ADMIN"), "/workspace/shop");
  assert.equal(workspaceHome("OWNER"), "/workspace");
});
