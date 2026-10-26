# Plan — close the ALIFE mining loop

## Where we are (2026-10-26 ~14:40Z)

Verified live: durable NPC identity persists to `gamestore.sqlite` (L1 0002 second
hunk), fleet keeps `m2 h1` (L1 0004 + self-heal hook), capacitors healthy
(0.5–0.7 with two active strip miners), prunes 27/4.5min → 0–1/5min.

Not solved: **ore is never produced**. Measured with temporary probes in
`server/src/space/runtime.js` (reverted later, never committed):

- `living-mining-effect-state`: for the same module the effect is re-created
  continuously — `startedAtMs ≈ now`, `nextCycleAtMs = started + duration`
  (37–45 s) at every sample, `miningEffect: true`.
- `MINER_TARGET` shows `activeEffects` alternating 2 → 0 → 2 → 0 between fleet
  ticks, target ID stable (5020484739081), so it is not a target-change stop.
- `living-mining-cycle-result` = 0: the stock cycle commit never runs, so the
  yield path is never entered.

Current question, answered by `living-generic-deactivate` (running now):
who removes the mining effect between ticks, and with which `reason`.

## Next steps

1. Read `living-generic-deactivate`. If it shows a reason such as
   `capacity`/`repeat`/`duration`, the module stops at its cycle boundary
   without running the mining branch — that is the stock bug to patch.
2. Turn the finding into a fix in the right layer:
   - stock bug inside a stock function → L1 patch (one patch per file; 0003
     already owns `npcBehaviorLoop.js`, so fold there if it belongs);
   - co-op rule → `integration/*.cjs` + one hook line, never a 900-char line.
3. Remove the temporary probes from `runtime.js` (`git checkout --`) before the
   next deploy, and delete `EVEJS_COOP_MINING_TRACE_CYCLE` from the probe compose
   or keep it for the L2 telemetry only.
4. Deploy: reset drifted files → `apply-upstream-patches.cjs --check`
   (`CHECK_OK series=4`) → `patch-evejs-coop.cjs` → `--check` `OVERLAY_OK` →
   build → `compose up -d`.
5. Then expect `living-hauler-loaded` → `living-native-haul-delivered` →
   `living-npc-station-sold`, then `scripts/restart-acceptance.sh`.

## Known external state

- `--check` is blocked by another session's `coopHaulCargoAdoption.js` (STALE).
  Never reset or delete it; report instead.
- Mechanism debt is now measured: `node scripts/coop-hook-inventory.cjs`
  → `legacy=65 wired=48 specEntries=46 overlap=5`, `--check` fails if it grows.
