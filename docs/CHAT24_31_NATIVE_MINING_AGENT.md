# Chat 24 + 31 — Stage D1: Native NPC mining Agent contact

**Status 2026-10-26: SOURCE IMPLEMENTED / LIVE UNVERIFIED. PR #287 remains Draft, default OFF.** This implements a **real stock agentMgr dialogue hook** for an already funded company shift, not a new client page or synthetic mission.

## Player-visible journey

1. Existing CH24+31 Stage A funds a shift against the original fleet from a true player corporation wallet to a true NPC employer wallet. Stage D1 **does not perform hiring or charge wages**.
2. The player contacts a **real pinned SDE NPC station agent** employed by the same NPC corporation as the fleet in the same solar system. Stock missions, the existing paid convoy agent, and faction-war agent have priority and continue untouched.
3. The dialogue appears only when the player has an authenticated character session, live corporation membership, an already mounted original native scene, and exactly **one** funded, verified original startup mining fleet for this player corp / employer / system. More than one eligible shift deliberately refuses selection; no arbitrary first-fleet choice.
4. A member may read the authenticated NPC fleet status: original fleet ID, miner count, haulers, system, native order state and command revision. Only industry managers/directors see paid wages or receive the action button.
5. Native **View** only reads state. Native **Accept** queues the original **MINE** command with exact funded contract `operationID` and current `commandSeq`. Works on initial IDLE or safely held `HOLD/NATIVE_REQUESTED`. Other commands use the trusted server-side source but are **not presented as misleading client buttons** in D1.
6. The original server `coopPlayerMiningFleetTick.assign` resolves only an already mounted scene, re-verifies real NPC hulls/controllers, current native corp permissions, matching employer and optimistic command revision, and issues a durable native GameStore transaction. The next **original** mining tick performs the physical change. No agent award or fake item/ISK credit.

### Source

- `integration/coopPlayerMiningAgent.cjs` — injectable native Agent dialogue, active mission / job priority, secure single-fleet resolution, role-based view and MINE command.
- `scripts/coop-player-mining-agent-patch.cjs` — reversible, pinned native `agentMgrService.Handle_DoAction` and `Handle_GetMissionBriefingInfo` hooks. Runs **after** stock agent, existing paid convoy and militia agent; no extra protocol.
- `integration/coopPlayerMiningFleetTick.cjs` — exposes `assign` and read-only `inspect` to trusted server features; no spawning an original scene for a command. The pinned `space/runtime.js` exports `runtime.scenes` (Map), **not** `getScene()`. Commands inspect already-loaded scenes only; two isolated test cases reject unavailable or fabricated scenes.
- `scripts/coop-player-mining-storage-patch.cjs` — critically important original SQLite `corporationRuntime` row grouping repair. The pinned `sqliteStore.ROW_GROUPS.corporationRuntime` must include `coopPlayerMiningShift`, `coopPlayerMiningFleet`, and `coopPlayerMiningOreTitle`. This preserves one physical `group\\u001fentity` record per contract and prevents the normal GameStore flush from regrouping the new atomically written rows into a different shape. Reversible in overlay.
- `scripts/overlay-spec.cjs`, `scripts/patch-evejs-coop.cjs`, `docs/coop-flags.json` register the native Agent hook and the feature flags.

### Flags

All default OFF:
```text
EVEJS_COOP_NATIVE_ATOMIC_ROWS=1
EVEJS_COOP_PLAYER_NPC_MINING_COMPANY=1
EVEJS_COOP_PLAYER_NPC_MINING_AGENT=1
```
**Do not enable until native SQLite + two-client acceptance on disposable original data.** The original Agent service is altered by a reversible source hook even when all flags are OFF, but behavior is unchanged while OFF.

### Tests and limits

- Exact pinned `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`: native agent hook and native sqliteStore group transform both **compile**, install idempotently and uninstall to the exact original source. Re-executed pinned `explodeToRows`/`assembleFromRows` source: all three original mining row groups retained identity across **10 simulated flush/restart cycles** in memory (not original native SQLite). The pinned file tests are directly source-verified, **not live original runtime E2E**.
- Source-defined Agent regression tests: **17/17** passed in an isolated V8 execution of the current repository test logic; source-only native patch regression tests **6/6** passed. They are also added as `node --test` files for running in the real checkout.
- Earlier Stage A/B/C1 local Node mock regression suite: **61/61 PASS** (prior run), C2 V8 suite **14/14 PASS** (prior run). The full new combined Node/SQLite/Rust and two-client suite is **NOT_RUN**.
- **D2 source addition:** server-authorized NPC wage tariff and in-client **View → Accept hiring** now implemented separately in `coopPlayerMiningHiring`; see [CHAT24_31_NATIVE_MINING_HIRING.md](CHAT24_31_NATIVE_MINING_HIRING.md). Still unimplemented: actual live-client verification, **HOLD**, **HAUL**, **RETREAT** buttons/choice, multi-fleet selection, EVEmail alerts, payroll exhaustion/renewal and native ore sale/P&L.
- Stock client button labels are **View** and **Accept**. They cannot express four different freeform orders; D1 deliberately implements only **MINE** via Accept. Do not advertise full NPC mining corporation in-client gameplay yet.

## Next acceptance gate

Run `node --test tests/coop-player-mining-*.test.mjs` and `node scripts/patch-evejs-coop.cjs --code-path /path/to/EveJS/Code --check` against a disposable exact pinned checkout, followed by actual Node/SQLite crash-at-each-COMMIT test, one original physical mining trip and two real clients. Verify one corp manager sees Accept and a second member sees View only; normal agent missions and the priced convoy job remain unchanged. Then design a native choice flow for HOLD, HAUL and RETREAT without abusing the stock button semantics.
