// Run with Node 22.18+ (native TypeScript support): node --test tests/trackedOrders.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { createTrackedOrderCache, trackedOrderAfterError } from "../lib/trackedOrders.ts";

const order = { code: "PH-ABC123", customer: { name: "Customer A" } };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("a remounted customer scope cannot read the previous account's cached order", async () => {
  const customerA = createTrackedOrderCache(async () => order);
  await customerA.fetch(order.code);

  // Leave tracking, sign out on the profile page, then return under account B.
  const customerB = createTrackedOrderCache(async () => {
    throw { status: 404 };
  });
  assert.equal(customerB.peek(order.code), null);
  await assert.rejects(customerB.fetch(order.code));
  assert.equal(customerB.peek(order.code), null);
});

test("an old account's delayed response cannot populate the new account's cache", async () => {
  const responseA = deferred();
  const responseB = deferred();
  const customerA = createTrackedOrderCache(() => responseA.promise);
  const customerB = createTrackedOrderCache(() => responseB.promise);
  const requestA = customerA.fetch(order.code);
  const requestB = customerB.fetch(order.code);
  assert.notEqual(requestA, requestB);

  responseA.resolve(order);
  await requestA;
  assert.equal(customerB.peek(order.code), null);
  assert.equal(customerB.fetch(order.code), requestB);

  responseB.reject({ status: 404 });
  await assert.rejects(requestB);
  assert.equal(customerB.peek(order.code), null);
});

test("an old request failure cannot remove a new account's pending request", async () => {
  const responseA = deferred();
  const responseB = deferred();
  const customerA = createTrackedOrderCache(() => responseA.promise);
  const customerB = createTrackedOrderCache(() => responseB.promise);
  const requestA = customerA.fetch(order.code);
  const requestB = customerB.fetch(order.code);
  responseA.reject({ status: 401 });
  await assert.rejects(requestA);
  assert.equal(customerB.fetch(order.code), requestB);
  responseB.resolve({ ...order, customer: { name: "Customer B" } });
  await requestB;
  assert.equal(customerB.peek(order.code).customer.name, "Customer B");
});

test("prefetch and navigation still share one request within a customer scope", async () => {
  const response = deferred();
  const requestedCodes = [];
  const cache = createTrackedOrderCache((code) => {
    requestedCodes.push(code);
    return response.promise;
  });
  cache.prefetch(" ph-abc123 ");
  const navigation = cache.fetch(order.code);
  assert.equal(cache.fetch("ph-abc123"), navigation);
  response.resolve(order);
  await navigation;
  cache.prefetch(order.code);
  assert.deepEqual(requestedCodes, [order.code]);
  assert.equal(cache.peek(" ph-abc123 "), order);
});

for (const status of [401, 403, 404]) {
  test(`${status} removes cached and already displayed order details`, async () => {
    const error = { status };
    let denied = false;
    const cache = createTrackedOrderCache(async () => {
      if (denied) throw error;
      return order;
    });
    let displayed = await cache.fetch(order.code);
    denied = true;
    try {
      await cache.fetch(order.code);
      assert.fail("Expected order access to be rejected");
    } catch (error) {
      displayed = trackedOrderAfterError(displayed, error);
    }
    assert.equal(cache.peek(order.code), null);
    assert.equal(displayed, null);
  });
}

test("a temporary network or server failure preserves the current authorized view", () => {
  for (const error of [{ status: 0 }, { status: 500 }, new Error("offline")]) {
    assert.equal(trackedOrderAfterError(order, error), order);
    assert.equal(trackedOrderAfterError(null, error), null);
  }
});
