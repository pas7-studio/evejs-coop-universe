# COOP-024C — One native command owner per living NPC (2026-10-25)

**Status: IMPLEMENTED_UNVERIFIED.** Feature flag: `EVEJS_COOP_NPC_ORDER_ARBITER=1`, **default OFF**. Stacked upon NPC agency PR #32; design PR #29. This is not an authorization to attack players and not a replacement for native EveJS physics, legality, targeting, inventory, flight or damage.

## Why this change is needed

The previous optional Living Universe drivers independently emit warp, orbit, attack, stop, resume and gate transfer commands. Their per-module `activeIDs()` screens prevent some collisions but do not share a per-ship command owner. A trader or patroller could receive a route order while an existing raid or genuine tactical rescue needs exclusive control.

## Implemented source-level behavior

1. `coopNpcOrderArbiter.cjs` creates short-lived, bounded **per-real-system/per-physical-ship** synchronous native command leases. Ownership is one of `RAID`, `TACTICS`, `GATE`, `PATROL`, `CIVILIAN`. Same owner can continue its command sequence; a different owner is denied until confirmed release or expiry (default 120s).
2. `TACTICS` alone may preempt a normal lease, enabling real native damage retreat or rescue. Existing native controller safety checks continue to apply; an old or missing physical identity never allows a new order.
3. `coopNpcOrderBridge.cjs` revalidates **named durable pilot ID -> unique native ship ID -> scene and controller** immediately before every command. Conflicting pilot/hull assignments, human-owned ships, wrong-system scenes, absent controllers and uncertain identities refuse orders.
4. A synchronous native executor throw, promise or unrecognizable result causes an `OUTCOME_UNKNOWN` fence. No automated retries or owner overrides in that process; manual native inspection and repair are required. Normal explicit unsuccessful native responses do not create a successful lease.
5. Existing `coopVirtualWorldRuntime.cjs` constructs the bridge lazily only when enabled. It now wraps commands from:
   - `coopNativeRaids`: real pirate native warp and attack, without broadening NPC targeting rights.
   - `coopNpcTactics`: real rescue warp, reinforcement attack, emergency retreat, stop and resume.
   - `coopNpcGateTravel`: real stargate approach and opt-in native cross-system transfer.
   - `coopPatrolNavigator`: native patrol warp/orbit.
   - `coopCivilianOrders`: native miner/hauler/trader/pirate waypoint warp/orbit.
   - Existing NPC market decision path reads the arbiter's blocking IDs; it **does not yet** reserve asynchronous market RPC settlements.
6. `scripts/patch-evejs-coop.cjs` copies both new modules as reversible `server/src/space/*.js` files alongside the prior NPC agency overlay. **No new native hook insertion.**

## Safety & realism

- The flag is independent from the NPC opportunity planner flag. Both OFF gives legacy behavior; enabling the arbiter alone guards existing opt-in native NPC directors.
- Authenticated human player ships are **never** issued NPC commands by this bridge. The existing NPC stock-miner eligibility gate and all actual EveJS combat rules remain authoritative.
- Do not use arbiter leases as proof of a completed gate jump, weapon damage, loot receipt, real NPC wages, market sale, item ownership or paid contract.
- Each lease refers to a single live ship in a single native scene. Expired leases are cleaned lazily, not by a busy global sweep. Unknown-outcome leases are not discarded by TTL.
- **Known limitation:** arbiter state itself is process-local. If the process restarts, inspect existing saved NPC controller orders and native movement before reenabling this flag; there is no durable lease replay or automatic unknown-outcome repair.
- **Known limitation:** native EveJS core/stock NPC background orders that bypass `coopVirtualWorldRuntime`, and asynchronous market RPC work, do not participate in this overlay arbiter yet. A complete *server-wide* order authority still requires a separate source-level hook and recovery audit. Do not represent this slice as universal across every EveJS subsystem.
- `TACTICS` preemption can also interrupt a benign warp (for urgent rescue), but whether real ship can abort/warp is still decided by native controllers/dogma. The planning loop must NOT mutate ship position or fire weapons directly.
- On ambiguity, refusing further commands is preferable to fabricating success or forcibly overwriting another owner's current order.

## Tested / acceptance

**Isolated Node.js v22.16.0:** `node --test tests/coop-npc-order-arbiter.test.mjs` — **8 PASS, 0 FAIL**. Covers owner exclusion, tactical priority, native error and permanently ambiguous outcome, false human/mismatched controller, duplicate pilot/hull registration, TTL and identity replacement, proof-based release, capacity and system isolation.

**Required before deploy:** run entire local repository baseline, inspect pinned EveJS native order return shapes and controller active state, reversible overlay dry-run `--check` against a disposable checkout, one real native NPC battle interrupted by a defense retreat, gate/market/raid collision in the actual server, two-client observe and restart/stop-recovery test. This PR has none of those native-world gameplay PASS marks.

**Do not merge or deploy without explicit owner approval.** No CI, no touching `evejs-data`, no changing pinned upstream.
