"use strict";
// Event-loop lag, permanently measured.
//
// The monitor used so far lived only in a live process (an inspector monkey-patch), so every restart silently
// removed the only witness to a multi-second freeze. Opt-in with EVEJS_COOP_EVENT_LOOP_MONITOR=1: a 1 s timer
// compares when it actually fired with when it was due, and anything above the threshold is reported as a
// "coop-event-loop-lag" event together with the heap it was holding at that moment.
const enabled = (env = process.env) => String((env && env.EVEJS_COOP_EVENT_LOOP_MONITOR) || "") === "1";

function createMonitor({
  sampleMs = 1000,
  thresholdMs = 250,
  observe = () => {},
  memory = () => ({}),
  now = () => Date.now(),
  setIntervalFn = (fn, ms) => setInterval(fn, ms),
} = {}) {
  let timer = null;
  let dueAt = 0;
  let worstMs = 0;
  let reports = 0;

  function tick() {
    const nowMs = now();
    const lagMs = Math.max(0, nowMs - dueAt);
    dueAt = nowMs + sampleMs;
    if (lagMs < Math.max(1, Number(thresholdMs) || 250)) return null;
    worstMs = Math.max(worstMs, lagMs);
    reports += 1;
    const report = { lagMs, at: nowMs, ...memory() };
    try {
      observe("coop-event-loop-lag", report);
    } catch (_error) {
      /* a witness must never change the world */
    }
    return report;
  }

  function start() {
    if (timer) return { status: "ALREADY_RUNNING" };
    dueAt = now() + sampleMs;
    timer = setIntervalFn(tick, sampleMs);
    if (timer && typeof timer.unref === "function") timer.unref();
    return { status: "STARTED", sampleMs, thresholdMs };
  }

  function stop() {
    if (timer && typeof clearInterval === "function") clearInterval(timer);
    timer = null;
    return { status: "STOPPED", worstMs, reports };
  }

  return { start, stop, tick, stats: () => ({ worstMs, reports, running: Boolean(timer) }) };
}

module.exports = { enabled, createMonitor };
