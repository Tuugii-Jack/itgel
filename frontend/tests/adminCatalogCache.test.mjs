import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adminMemoGetKey,
  catalogCacheTtlMs,
  isAdminCatalogMemoKey,
  isAdminCatalogWritePath,
} from "../lib/api/cacheTtl.ts";

test("leasing catalog GETs are short-lived; money APIs are not cached", () => {
  assert.equal(catalogCacheTtlMs("/leasing/products/categories", "admin"), 30_000);
  assert.equal(catalogCacheTtlMs("/leasing/products", "admin"), 8_000);
  assert.equal(catalogCacheTtlMs("/leasing/products/prod_1", "admin"), 0);
  assert.equal(catalogCacheTtlMs("/leasing/finance/itgel/summary", "admin"), 0);
  assert.equal(catalogCacheTtlMs("/leasing/orders", "admin"), 0);
  assert.equal(catalogCacheTtlMs("/leasing/finance/itgel/settlements", "admin"), 0);
  assert.equal(catalogCacheTtlMs("/leasing/products", "customer"), 0);
});

test("admin memo keys include the token so a later user cannot reuse the first user's catalog", () => {
  const path = "/leasing/products";
  const a = adminMemoGetKey("token-a", path);
  const b = adminMemoGetKey("token-b", path);
  assert.notEqual(a, b);
  assert.equal(adminMemoGetKey("token-a", path), a);
  assert.equal(isAdminCatalogMemoKey(a), true);
  assert.equal(isAdminCatalogMemoKey("GET:admin:token-a:/leasing/finance/itgel/summary"), false);
});

test("stock/price writes hit catalog paths; product detail is not the list TTL", () => {
  assert.equal(isAdminCatalogWritePath("/leasing/products/rounds/r1"), true);
  assert.equal(isAdminCatalogWritePath("/leasing/products/p1"), true);
  assert.equal(isAdminCatalogWritePath("/leasing/finance/itgel/pay"), false);
  assert.notEqual(
    adminMemoGetKey("t", "/leasing/products"),
    adminMemoGetKey("t", "/leasing/products/p1"),
  );
});
