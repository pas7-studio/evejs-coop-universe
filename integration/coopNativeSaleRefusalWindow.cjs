"use strict";
// A bounded refusal window for one sale batch.
//
// Live defect 2026-11-04 (m003s14): the same (station, hauler, cargo) batch was offered
// 1390 times at a 5 s cadence. Every caller of sellOnArrival starts a fresh job as soon
// as the previous settled answer expires (5 s), so a station that refuses - no seeded
// counterparty, a market cooldown, a hauler the market will not name - is asked again
// and again for as long as the hull sits there. No money moves and no receipt is due,
// but the log is flooded and the real signal is lost.
//
// A definitive refusal is a fact, not an invitation. The window is per batch key, the
// first wait is 60 s, every repeat doubles it, and it never exceeds 300 s (the market's
// own cooldown). A different batch - another station, another hauler, another hold - has
// its own window and is asked at once. The window belongs to the refusal, never to the
// fleet, and it is never a reason to drop cargo.
function createSaleRefusalWindow({ clock = () => Date.now(), baseMs = 60000,
  maxMs = 300000, maxKeys = 512 } = {}) {
  const windows = new Map();
  const keyOf = (key) => String(key);
  function read(key) {
    const window = windows.get(keyOf(key));
    if (!window) return null;
    const left = Number(window.until) - Number(clock());
    if (!(left > 0)) return null;
    return { reason: String(window.reason || ""), retryInMs: left,
      strikes: Number(window.strikes || 0) };
  }
  // null when the batch may be offered, otherwise the refusal it must wait out.
  function hold(key) { return read(key); }
  // A definitive refusal: open the window, or grow the one already open for this batch.
  function refuse(key, reason) {
    const id = keyOf(key);
    const previous = windows.get(id);
    const strikes = previous ? Math.min(3, Number(previous.strikes || 0) + 1) : 0;
    const waitMs = Math.min(Number(maxMs), Number(baseMs) * Math.pow(2, strikes));
    if (!windows.has(id) && windows.size >= Number(maxKeys))
      windows.delete(windows.keys().next().value);
    windows.set(id, { until: Number(clock()) + waitMs, strikes,
      reason: String(reason || "NOT_SOLD"), waitMs });
    return { status: "SALE_REFUSAL_WINDOW", retryInMs: waitMs, strikes };
  }
  // A settled sale is the only thing that ends a window early: the batch is gone.
  function clear(key) { windows.delete(keyOf(key)); }
  function size() { return windows.size; }
  return { hold, refuse, clear, size };
}
module.exports = { createSaleRefusalWindow };
