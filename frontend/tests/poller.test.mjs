import assert from "node:assert/strict";
import { test } from "node:test";
import {
  POLL_MAX_DURATION_MS,
  POLL_MAX_INTERVAL_MS,
  createPoller,
} from "../lib/poller.ts";

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createClock() {
  let now = 0;
  /** @type {{ fn: () => unknown; at: number; live: boolean }[]} */
  const timers = [];

  return {
    now: () => now,
    setTimer(fn, ms) {
      const timer = { fn, at: now + ms, live: true };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      timer.live = false;
    },
    async advance(ms) {
      const target = now + ms;
      while (true) {
        const next = timers
          .filter((timer) => timer.live)
          .sort((a, b) => a.at - b.at)[0];
        if (!next || next.at > target) {
          now = target;
          await flush();
          return;
        }
        now = next.at;
        next.live = false;
        void next.fn();
        await flush();
      }
    },
  };
}

test("does not run immediately on start", async () => {
  const clock = createClock();
  let runs = 0;
  const poller = createPoller({
    intervalMs: 10_000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    run: () => {
      runs += 1;
    },
  });
  poller.start();
  await clock.advance(9_999);
  assert.equal(runs, 0);
  await clock.advance(1);
  assert.equal(runs, 1);
});

test("skips a visibility tick while a request is in flight", async () => {
  const clock = createClock();
  let started = 0;
  let finish;
  const poller = createPoller({
    intervalMs: 10_000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    run: () => {
      started += 1;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  poller.start();
  await clock.advance(10_000);
  assert.equal(started, 1);
  poller.notifyVisibility();
  await flush();
  assert.equal(started, 1);
  finish();
  await flush();
  await clock.advance(10_000);
  assert.equal(started, 2);
});

test("backs off after an error and recovers", async () => {
  const clock = createClock();
  const attempts = [];
  let fail = true;
  const poller = createPoller({
    intervalMs: 10_000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    run: () => {
      attempts.push(clock.now());
      if (fail) throw new Error("network");
    },
  });
  poller.start();
  await clock.advance(10_000);
  assert.equal(poller.getDelay(), 20_000);
  await clock.advance(10_000);
  assert.equal(attempts.length, 1);
  await clock.advance(10_000);
  assert.equal(attempts.length, 2);
  fail = false;
  await clock.advance(40_000);
  assert.ok(attempts.length >= 3);
  assert.equal(poller.getDelay(), 10_000);
  assert.ok(poller.getDelay() <= POLL_MAX_INTERVAL_MS);
});

test("stops after max duration and can restart", async () => {
  const clock = createClock();
  let runs = 0;
  /** @type {string[]} */
  const stops = [];
  const poller = createPoller({
    intervalMs: 15_000,
    maxDurationMs: 60_000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onStopped: (reason) => stops.push(reason),
    run: () => {
      runs += 1;
    },
  });
  poller.start();
  await clock.advance(60_000);
  assert.equal(poller.isStopped(), "max_duration");
  assert.deepEqual(stops, ["max_duration"]);
  const before = runs;
  await clock.advance(45_000);
  assert.equal(runs, before);
  poller.start();
  await clock.advance(15_000);
  assert.equal(runs, before + 1);
});

test("skips hidden tabs and ticks once when visible again", async () => {
  const clock = createClock();
  let visible = false;
  let runs = 0;
  const poller = createPoller({
    intervalMs: 10_000,
    now: clock.now,
    isVisible: () => visible,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    run: () => {
      runs += 1;
    },
  });
  poller.start();
  await clock.advance(30_000);
  assert.equal(runs, 0);
  visible = true;
  poller.notifyVisibility();
  await flush();
  assert.equal(runs, 1);
});

test("default max duration is 10 minutes", () => {
  assert.equal(POLL_MAX_DURATION_MS, 10 * 60 * 1000);
});
