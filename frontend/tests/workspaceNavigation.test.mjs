import assert from "node:assert/strict";
import { test } from "node:test";
import { activeWorkspaceLink, normalizeWorkHref, searchWorkspaceLinks, workspaceHref, workspaceLinksFor } from "../lib/workspaceNavigation.ts";
import { helperAdminCanAccess } from "../lib/admin-role.ts";

test("workspace menus respect every role and deny unknown roles", () => {
  assert.equal(workspaceLinksFor("shop", "OWNER").length, 20);
  assert.equal(workspaceLinksFor("shop", "ADMIN").length, 20);
  assert.equal(workspaceLinksFor("leasing", "OWNER").length, 9);
  assert.equal(workspaceLinksFor("leasing", "LEASING").length, 9);
  for (const role of [null, undefined, "CUSTOMER", "UNKNOWN"]) {
    assert.deepEqual(workspaceLinksFor("shop", role), []);
    assert.deepEqual(workspaceLinksFor("leasing", role), []);
  }
  assert.deepEqual(workspaceLinksFor("shop", "LEASING"), []);
  assert.deepEqual(workspaceLinksFor("leasing", "ADMIN"), []);
  assert.deepEqual(workspaceLinksFor("leasing", "STAFF"), []);
  const staff = workspaceLinksFor("shop", "STAFF");
  assert.ok(staff.length > 0);
  assert.ok(staff.every((link) => helperAdminCanAccess(link.href)));
  for (const suffix of ["settings", "products", "reports", "leasing-settlements", "orders/new"]) {
    assert.ok(!staff.some((link) => link.href === `/workspace/shop/${suffix}`));
  }
});

test("active navigation selects the closest section without prefix collisions", () => {
  const links = workspaceLinksFor("shop", "OWNER");
  assert.equal(activeWorkspaceLink("/workspace/shop", links)?.label, "Захиалга");
  assert.equal(activeWorkspaceLink("/workspace/shop/orders/new", links)?.label, "Захиалга оруулах");
  assert.equal(activeWorkspaceLink("/workspace/shop/products/example", links)?.label, "Бараа");
  assert.equal(activeWorkspaceLink("/workspace/shop/products-other", links), undefined);
  assert.equal(activeWorkspaceLink("/workspace/shop/unknown", links), undefined);
});

test("search matches Mongolian and transliterated words only within allowed sections", () => {
  const staff = workspaceLinksFor("shop", "STAFF");
  assert.equal(searchWorkspaceLinks(staff, " hereglegch ")[0]?.label, "Хэрэглэгчид");
  assert.equal(searchWorkspaceLinks(staff, "АЖЛЫН zahialga")[0]?.label, "Захиалга");
  assert.deepEqual(searchWorkspaceLinks(staff, "tohirgoo"), []);
  assert.deepEqual(searchWorkspaceLinks(staff, ""), staff);
});

test("detail links preserve other filters, encode identifiers and remove cleared filters", () => {
  const href = workspaceHref("/workspace/shop?status=ARRIVED&q=abc#table", { order: "id / +", q: null });
  const url = new URL(href, "https://example.test");
  assert.equal(url.pathname, "/workspace/shop");
  assert.equal(url.searchParams.get("status"), "ARRIVED");
  assert.equal(url.searchParams.get("order"), "id / +");
  assert.equal(url.searchParams.has("q"), false);
  assert.equal(url.hash, "#table");
  assert.equal(workspaceHref("/workspace/shop?q=x", { q: "" }), "/workspace/shop");
});

test("today's old batch links open the actual batch detail route", () => {
  assert.equal(normalizeWorkHref("/workspace/shop/batches/batch-1"), "/workspace/shop/batches?batch=batch-1");
  assert.equal(normalizeWorkHref("/workspace/shop/batches/a%20b"), "/workspace/shop/batches?batch=a+b");
  assert.equal(normalizeWorkHref("/workspace/shop/batches/%ZZ"), "/workspace/shop/batches");
  assert.equal(normalizeWorkHref("/workspace/leasing?goods=arrived_unpaid"), "/workspace/leasing?goods=arrived_unpaid");
});
