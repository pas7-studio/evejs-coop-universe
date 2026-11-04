// When may the universe-site seeder run a full pass?
//
// Measured 2026-11-02 on the live play stack: the sampled nullsec/wormhole fill-in changed on every world tick,
// so the pending set was never empty and the whole 36-system pass ran every ~26 s. Its own perf sample: p95
// 22.3 s, max 28.1 s of blocked event loop for a pass that is designed to run "on a new system or every ten
// minutes". The decision lives here so it can be tested without the dungeon runtime.
function shouldReconcile({
  pending = [],
  worldIDs = null,
  lastReconcileAtMs = 0,
  nowMs = Date.now(),
  intervalMs = 10 * 60 * 1000,
  force = false,
} = {}) {
  if (force) return true;
  const world = worldIDs instanceof Set ? worldIDs : new Set(worldIDs || []);
  for (const systemID of pending || []) {
    if (world.has(Number(systemID))) return true;
  }
  return Number(nowMs) - Number(lastReconcileAtMs) >= Number(intervalMs);
}

module.exports = { shouldReconcile };
