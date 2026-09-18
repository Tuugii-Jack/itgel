import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isTrackPaymentOpen,
  shouldPollPayment,
  shouldPollSuccess,
} from "../lib/orderPolling.ts";

function shopUnpaid(over = {}) {
  return {
    status: "NEW",
    paymentState: "UNPAID",
    dueAmount: 100000,
    isLeasing: false,
    cargoPayMethod: null,
    fulfilment: null,
    paidAmount: 0,
    refundedAmount: 0,
    subtotal: 100000,
    ...over,
  };
}

function leasing(over = {}) {
  return {
    status: "NEW",
    paymentState: "PARTIAL",
    dueAmount: 90000,
    isLeasing: true,
    cargoPayMethod: null,
    fulfilment: null,
    paidAmount: 10000,
    refundedAmount: 0,
    subtotal: 100000,
    leasingFeePaid: true,
    nextPayKind: "PRINCIPAL",
    payPlan: { overdue: false, dueToday: false },
    ...over,
  };
}

test("keeps leftover leasing QR open but does not treat remainder as an active poll", () => {
  const leftover = leasing();
  assert.equal(isTrackPaymentOpen(leftover), true);
  assert.equal(shouldPollPayment(leftover), false);
  assert.equal(shouldPollSuccess(leftover), false);
});

test("polls leftover only after a user prepay attempt, and stops once paidAmount increases", () => {
  const leftover = leasing({ paidAmount: 10000, dueAmount: 90000 });
  assert.equal(shouldPollPayment(leftover, { prepayAttemptAtPaid: null }), false);
  assert.equal(shouldPollPayment(leftover, { prepayAttemptAtPaid: 10000 }), true);
  assert.equal(
    shouldPollPayment(
      leasing({ paidAmount: 18333, dueAmount: 81667 }),
      { prepayAttemptAtPaid: 10000 },
    ),
    false,
  );
});

test("polls fee hold, due today, overdue, and remaining balance", () => {
  assert.equal(
    shouldPollPayment(
      leasing({
        leasingFeePaid: false,
        nextPayKind: "FEE",
        paidAmount: 0,
        dueAmount: 110000,
        paymentState: "UNPAID",
      }),
    ),
    true,
  );
  assert.equal(shouldPollPayment(leasing({ payPlan: { dueToday: true } })), true);
  assert.equal(shouldPollPayment(leasing({ payPlan: { overdue: true } })), true);
  assert.equal(
    shouldPollPayment(leasing({ nextPayKind: "BALANCE", dueAmount: 90000 })),
    true,
  );
});

test("polls unpaid shop orders and stops after cancel or cash cargo", () => {
  assert.equal(shouldPollPayment(shopUnpaid()), true);
  assert.equal(shouldPollSuccess(shopUnpaid()), true);
  assert.equal(isTrackPaymentOpen(shopUnpaid({ status: "CANCELLED" })), false);
  assert.equal(shouldPollPayment(shopUnpaid({ cargoPayMethod: "CASH" })), false);
});

test("success page polls an extra unpaid shop order", () => {
  assert.equal(shouldPollSuccess(leasing({ leasingFeePaid: true }), shopUnpaid()), true);
  assert.equal(shouldPollSuccess(leasing(), leasing()), false);
});
