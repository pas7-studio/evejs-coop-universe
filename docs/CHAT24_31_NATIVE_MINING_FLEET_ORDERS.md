# Chat 24 + 31 — D3: Native Agent fleet selector and orders

**Source state:** implemented in Draft PR #287; **live gameplay NOT VERIFIED**. Source is default-OFF and does not alter client files.

## Why reuse these particular native Agent controls?

Pinned original `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f` exports the real action IDs **View Mission (1)**, **Request Mission (2)** and **Accept (3)** through `agentMgrService.Handle_DoAction`. Other actions mean mission completion, remote acceptance or decline and are **not** repurposed. This preserves the real client protocol without pretending it supports custom command labels.

With `EVEJS_COOP_PLAYER_NPC_MINING_ORDERS_UI=1` and existing Agent/company gates enabled, an authorized industry manager in the employer NPC's **actual station** sees:

| Stock client button | In-session meaning for a funded native mining fleet |
| --- | --- |
| View Mission (1) | Read the currently selected original fleet ID, order, revision and phase |
| Request Mission (2) | Browse/cycle through the verified `fleet+command` pairs |
| Accept (3) | Queue exactly the selected command using the existing native GameStore CAS |

The Agent conversation explicitly explains the unusual Request Mission label. No custom mission or fake `missionID` is created. Existing stock missions, the paid convoy agent and the faction militia agent retain priority.

## Exact authority and safety

- The menu lists only original native startup mining fleets for which the session's **real player corporation** has an already paid, durable `FUNDED` shift with the **same NPC employer corporation and solar system**. Each fleet has unique original ID and verified hulls, controllers and native ownership; duplicate, tampered, absent or foreign rows refuse selection.
- It requires live authenticated single-character session, real corporation Industry role, station docked at the authentic NPC Agent's station, and an explicit menu flag. No direct chat command or client-selected fleet IDs.
- Candidate commands come from the **original native fleet phase** and persisted command state, not a free-form string. Native `mining` may expose `HOLD`, `HAUL`, `RETREAT`. In `hauling/loaded/haulereturn` only safely deferred `HOLD` is visible. Combat `aggressed/panic` exposes `RETREAT`. `coop-hold` permits `MINE`/safe retreat. `PENDING`, `ISSUING`, `DISPATCH_UNKNOWN` and unreconciled native HAUL/RETREAT issue **no new command**.
- View creates an **ephemeral 120-second per-session selection**; Request Mission cycles it without native writes. Restart/new login drops it, requiring View again. Each Accept consumes that pin **before** calling the native command CAS; repeated Accept must re-open. A stale revision, changed fleet, unavailable station or revoked role fails closed.
- Actual server dispatch is the existing `coopPlayerMiningFleetTick.assign` → `coopPlayerMiningShiftOrders.assign` → original `miningNpcOperations.tick` only. The native atomically persisted directive/sequence is the sole order authority. In-game Accept is **not** a proof of mining, source ore delivery, wallet settlement or native retreat arrival.
- **D3 tightened Stage B:** no new command may replace a still `NATIVE_REQUESTED` HAUL/RETREAT until independent physical completion proof is introduced. Immediate RETREAT and HAUL are blocked in active cargo transit. A requested HOLD cannot be resumed until actual `coop-hold` native fleet phase. HOLD while cargo transits remains safely deferrable.
- Native `runtime.scenes` is read-only; never `ensureScene()` to materialize a fleet to satisfy an order.

## Files and tests

- `integration/coopPlayerMiningAgentOrders.cjs`: in-memory selection, stock button protocol, source phase filtering, telemetry, authoritative CAS delegation.
- `integration/coopPlayerMiningAgent.cjs`: D3 delegation with existing D1 single-fleet View/MINE fallback when flag OFF and D2 native hiring still available.
- `integration/coopPlayerMiningFleetTick.cjs`: read-only original NPC fleet phase projection for selector.
- `integration/coopPlayerMiningShiftOrders.cjs`: strict native transport and unresolved order fences.
- `scripts/overlay-spec.cjs`: add single new L2 source file; original Agent hook is reused, not duplicated.
- `docs/coop-flags.json`: add `EVEJS_COOP_PLAYER_NPC_MINING_ORDERS_UI` (default OFF).
- **23/23** isolated exact-source selector regression scenarios pass (including physical cargo/combat phase, session, clock, replay, stale revision, second fleet, unknown button and source custody).
- **8/8** isolated original Agent/selector integration scenarios pass.
- **22/22** existing + new Stage B original mining-order regression scenarios pass.
- Previous **17/17** D1 Agent tests and **10/10** D2 hiring Agent tests still pass under isolated exact-source execution.
- **These are not** a complete Node/SQLite test run or a real EveJS client E2E. Real client labels, mounting behavior and scene effects must be observed in a disposable deployment.

## Activation and next gate

Keep OFF by default until disposable SQLite and actual two-client E2E have passed. Required coordinated opt-ins when authorized to test:

```ini
EVEJS_COOP_NATIVE_ATOMIC_ROWS=1
EVEJS_COOP_PLAYER_NPC_MINING_COMPANY=1
EVEJS_COOP_PLAYER_NPC_MINING_AGENT=1
EVEJS_COOP_PLAYER_NPC_MINING_ORDERS_UI=1
```

On an approved disposable checkout run `node --test tests/coop-player-mining-*.test.mjs`, install/check the pinned overlay, and capture original native fleet cargo, warp and GameStore command receipts before/during/after two real player sessions. Confirm mission/convoy/militia agent priority and UI labels, then perform a deliberate crash/restart with HAUL in progress; no duplicate warp or ore/ISK is acceptable.

**E1 source addition:** the strict read-only physical HAUL/RETREAT completion verifier and one native `NATIVE_COMPLETED` GameStore receipt have been implemented behind a separate default-OFF flag. See [CHAT24_31_PHYSICAL_MINING_COMPLETION.md](CHAT24_31_PHYSICAL_MINING_COMPLETION.md). Remaining: native seller-authorized market sale and ISK revenue; payroll cycles; two-client physical E2E and smoother fleet management UI.
