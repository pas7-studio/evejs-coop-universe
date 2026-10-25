"use strict";
// Opt-in, read-only trace for the native mining fleet. The stock loop silently
// `continue`s when a miner has no usable module, no snapshot, no reachable rock
// or a failed target lock, so a fleet can claim "mining" forever and produce
// nothing. One throttled event per fleet and reason makes that visible.
const lastAt = new Map();
const THROTTLE_MS = 120000;
function note(reason, payload = {}) {
  if (process.env.EVEJS_COOP_MINING_TRACE !== "1") return;
  const now = Date.now();
  const key = `${reason}:${payload.fleetID || 0}`;
  if (now - (lastAt.get(key) || 0) < THROTTLE_MS) return;
  lastAt.set(key, now);
  try {
    require("./coopRuntimeProbe").observe("living-mining-blocker", null,
      { spaceState: { systemID: Number(payload.systemID) || 0 } },
      { reason, ...payload, at: now });
  } catch (_error) { /* tracing must never break the native tick */ }
}
module.exports = { note };
