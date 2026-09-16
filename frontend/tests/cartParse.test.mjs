import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeCartLine, parseCartJson } from "../lib/cartParse.ts";

test("keeps a valid v2 cart and drops broken rows", () => {
  const lines = parseCartJson(
    JSON.stringify([
      {
        productId: "p1",
        name: "Цамц",
        price: 1000,
        qty: 2,
        ownerKind: "LEASING",
        type: "ready",
        stock: 3,
      },
      { productId: "bad" },
    ]),
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].ownerKind, "LEASING");
  assert.equal(lines[0].type, "ready");
  assert.equal(lines[0].qty, 2);
});

test("rebuilds size and color selections from the v1 shape", () => {
  const [line] = parseCartJson(
    JSON.stringify([{ productId: "p1", name: "Цамц", price: 1, size: "M", color: "Хар" }]),
  );
  assert.deepEqual(line.selections, { Хэмжээ: "M", Өнгө: "Хар" });
  assert.equal(line.size, "M");
  assert.equal(line.color, "Хар");
  assert.equal(line.ownerKind, "SHOP");
});

test("returns an empty cart for missing or corrupt storage", () => {
  assert.deepEqual(parseCartJson(null), []);
  assert.deepEqual(parseCartJson("{"), []);
  assert.deepEqual(parseCartJson(JSON.stringify({ productId: "p1" })), []);
});

test("does not let a ready line exceed remaining stock when merging", () => {
  const merged = mergeCartLine(
    [
      {
        productId: "p1",
        name: "Цамц",
        price: 1,
        image: null,
        type: "ready",
        selections: {},
        size: null,
        color: null,
        qty: 2,
        arriveFrom: "",
        arriveTo: "",
        stock: 3,
        ownerKind: "SHOP",
      },
    ],
    {
      productId: "p1",
      name: "Цамц",
      price: 1,
      image: null,
      type: "ready",
      selections: {},
      size: null,
      color: null,
      qty: 5,
      arriveFrom: "",
      arriveTo: "",
      stock: 3,
      ownerKind: "SHOP",
    },
  );
  assert.equal(merged[0].qty, 3);
});
