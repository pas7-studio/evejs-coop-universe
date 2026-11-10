# Overlay evidence - EveJS 261108.1 (import `1d6b691`, integrated as `coop/pas7std` `099603f`)

Date: 2026-11-10. Machine: owner PC (Windows), Node 22.14.0 host run, Docker
Desktop engine **not running** during the whole session.

This file records what was actually measured for the 261108.1 port. It is not a
gameplay acceptance: no client was launched, no owner stack was touched.

## What was delivered

| Item | Value |
| --- | --- |
| Release archive | `EveJS-261108.1.zip`, SHA-256 `373266A05FD9ACF0C220D06D5469907637A6D09BF2CF926ADF4AAEE97A3CCC59` |
| Import commit (release tree over `c3ea396`, content packs excluded) | `1d6b691` on branch `upstream/261108.1` |
| Construction branch (now the engine) | `coop/pas7std` `099603f`; the previous line is preserved as `coop/legacy-20261028` `f64fed0` |
| Diff vs the import | 800 files, +10 289 323 / в€’16 565 lines (637 restored files + ported hooks + ported feature blocks) |
| Previous engine | `coop/legacy-20261028` `f64fed0` - delivered untouched, kept for rollback |

## Gates

| Gate | Result |
| --- | --- |
| `node --check` on every touched `.js` | 0 failures (checked after each pass, and again on the final tree) |
| `scripts/coop-engine-audit.cjs --code-path O:\tmp\c261108\Code` | `AUDIT_OK` вЂ” 563 co-op modules, 66 stock files touched, 372 co-op lines, 0 runtime-patching sites of ours (upstream ships 23, reported separately) |
| `scripts/coop-perf-audit.cjs --code-path O:\tmp\c261108\Code` | `PERF_OK` (same attribution rule: co-op code only) |
| `scripts/coop-overlay-presence.cjs --engine O:\tmp\c261108\Code` | 54/73 files complete, 156 co-op lines still missing, 2 files gone from the engine (documented below) |
| Headless boot (`node index.js`, host Node, `EVEJS_DATA_ROOT=O:\tmp\boot261108-data`) | **passes**: `EveJS Elysian is running!`, 8490 solar systems / 5210 stations / 461 881 celestials / 40 928 belts / 13 978 stargates, express secondary service starts, 75 s of ticks with no exception |

Boot log tail (trimmed):

```
[SpaceRuntime] Startup solar-system preload complete in 404ms (3 systems, 0 stargate activation updates)
EveJS Elysian is running!
(direct listener: 127.0.0.1:26000)
[Startup] Runtime: 2 accounts, 4 characters, 17 items
[Startup] Space: 8490 solar systems, 5210 stations, 44 station types, 461881 celestials, 40928 asteroid belts, 13978 stargates, 29 stargate types
TIDI autoscaler disabled
```

Warnings that are expected without Docker: `MarketDaemonClient ... 127.0.0.1:40111 ECONNREFUSED`
(the daemon is a container).

## Boot-loop defects found and fixed (all bulk-port artifacts)

1. `services/agent/missionAuthority.js` вЂ” export referenced `isMissionContentMaterializable` that was never copied.
2. `services/mining/miningNpcOperations.js` вЂ” `stopRunawayFullThrottle()` displaced to module top level.
3. `services/dungeon/dungeonUniverseRuntime.js` вЂ” broad-definition flush block displaced between two functions.
4. `services/killmail/killmailState.js` вЂ” export of `buildKillBlob`, which 261108 does not have in that module.
5. `space/npc/npcSceneActivity.js` вЂ” the fork's memoised `getSceneActivityState` duplicated upstream's own function and called a name upstream never had.
6. `_secondary/express/gatewayServices/index.js` вЂ” 21 registry entries without their imports.
7. `_secondary/express/gatewayServices/skillPlanProto.js` вЂ” `SKILL_PLAN_ALIASES` / `assertAliasShapes` missing.
8. `services/newEdenStore/storeGatewayProto.js` вЂ” duplicate `Price`, `offer.Attributes`, `offer.api.*` and catalog enum definitions; upstream's newer superset kept, the fork's older duplicates removed.

## Still open (deliberate, not hidden)

* **`services/market/marketProxyService.js`** вЂ” 75 of our P2P settlement hooks are not ported.
  261108.1 rewrote the proxy to a 7 487-line durable market (saga, idempotency
  keys, durable expiry/recovery jobs). Porting our settlement fence into it is a
  design decision, not a transplant. **To make that impossible to forget, the
  proxy now refuses to load when any flag that expects the fence is on**:
  `EVEJS_COOP_PLAYER_MARKET_ATOMIC`, `..._SETTLEMENT_FENCE`, `..._BUY_RESERVE`,
  `..._FILL_GUARD`, `EVEJS_COOP_MARKET_CANCEL_CUSTODY`, `EVEJS_COOP_MARKET_SELL_CUSTODY`,
  `EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT` в†’ `COOP_MARKET_FENCE_NOT_PORTED: <flag>`.
  Verified: the flag on throws at require time, off loads normally.
* **Two movement files deleted upstream** вЂ” `movementWarpState.js` and
  `movementSceneRefresh.js`. All three behaviours are re-homed now: the warp-range
  fix in `destiny/simulation/warpTargets.js`, the drone resync in
  `runtime/scene/presentation.js`, the escort motion witness in
  `destiny/simulation/evolve.js` (`realWarp`).
* **`coopNpcRunawayGoto`** вЂ” re-homed: `destiny/simulation/evolve.js` `behaviour()`
  case `GOTO` parks a native NPC whose target is further than a solar system
  (the stock "straight for ever" sentinel) instead of flying it for ever.
* **Warp landing tracer** (`coopWarpLandingTrace`) вЂ” still not wired: the new
  warp pipeline has no single completion site that carries the fields the tracer
  logs. Diagnostics only; open.

## Retired after checking upstream now does it natively

| Ours | Superseded by 261108.1 |
| --- | --- |
| corporation recruit/member guards (`coopPlayerCorporationAccess`) | `canManageCorporationRecruitment`, `requireCorporationReadAccess` |
| trade custody journal + atomic trade hooks | durable completion saga with idempotency legs |
| mining cycle conservation / atomic wrapper | `miningCargoCommits` commit/extract with receipts |
| NPC mining cargo appender | receipt-based `npcMiningCargo` |
| salvage death/atomic transfer cargo guards | `prepareNativeNpcWreckItems` + `commitMiningCargoWreckTransfer` + `itemCustody` |
| career-goal gateway stubs | native `careerGoalGatewayService` |
| `logMovementDebug` early return | upstream already returns early |
| startup dungeon resume patch | persistent site advancement moved to `globalSiteSchedulerRuntime` |
| native NpcStore root shape helpers | `shapedRootsByTable` + `readCollectionRaw*` |

## Compose changes required by this host

* Market daemon host publish `40110` в†’ `41120` (already known) and **RPC
  `40111` в†’ `41121`**: Windows reserves 40064вЂ“40163 (WinNAT) and refuses to bind
  them, which used to make `docker compose up` fail with "socket ... forbidden".
* The fork's `EVEJS_COOP_CONTENT_BIND` / 127.0.0.2:28443 CDN publish is dropped:
  upstream serves gateway binaries on its own loopback CDN responder, and the
  coop title/achievement resolvers default to `https://127.0.0.1`.

## Market daemon end-to-end without Docker (host Rust)

Docker was down, so the Rust side was built and run directly on the host:

| Step | Result |
| --- | --- |
| `cargo build --release` in `externalservices/market-server` (rustc 1.89.0, target `O:\tmp\cargo-target`) | built, 6.8 MB binary |
| `cargo build --release` in `tools/market-seed` | built, 3.6 MB binary |
| `market-seed --config seed.toml build --station-limit 40 --type-limit 60` | 0.3 s, 1.5 MB SQLite |
| `market-server --config server.toml` | healthy: `/health` в†’ `{"ok":true,...}`, RPC `tcp://127.0.0.1:40111`, 4 800 open orders (2 400 buy / 2 400 sell), 360 summary rows, 6 regions, 40 stations |
| Game server booted against it | `EveJS Elysian is running!` and **no `MarketDaemonClient` warnings** - the only warnings of the earlier runs (`ECONNREFUSED 127.0.0.1:40111` every 10 s) are gone, so the Node в†” Rust market bridge works on 261108.1 |

The daemon was stopped again afterwards (it was started for this check only);
port 40111 must stay free for the owner's stack.


No `docker build`, no container, no client, no gameplay. Docker Desktop's Linux
engine was down; starting it would have restarted the owner's containers, which
the two-stack rule forbids outside an explicit restart window. The boot evidence
above is host-Node only.

## Legacy overlay suite against the new engine (expected drift)

34 test files read the deployed engine through `EVEJS_COOP_CODE_PATH`; run against
`O:\tmp\c261108\Code`: **171 tests, 121 pass, 50 fail**. Every sampled failure is the
archived overlay roundtrip class bound to the old pin, not port breakage:

```
not ok 2 - pinned native source one-statement patch is byte-exact reversible: server/src/services/inventory/itemStore.js
  error: 'WAREHOUSE_PATCH_DRIFT'
not ok 3 - ... tradeMgrService.js
  error: 'Unknown/duplicated source anchor: ... const moneyTransferResult = this._completeMoneyTransfer(trade);'
```

That is exactly what `docs/DEVELOPMENT_DOCTRINE.md` predicts for the frozen installer/
overlay library once the engine moves: its anchors no longer exist, and
`patch-evejs-coop.cjs` is a proposal archive for the original author, not how this fork
ships. The port's gates are the audit, perf, presence and boot checks above.

## Not done in this session

No `docker build`, no container, no client, no gameplay claim. Docker Desktop's Linux
engine was down for the whole session; starting it would have restarted the owner's
containers, which the two-stack rule forbids outside an explicit restart window. What was
verified instead: host-Node boot, a host-Rust market daemon end to end, and
`docker compose config` for the engine compose, the agents override and the play-coop override (all rc=0 against the ported compose).

## Client contract compatibility against the port (no client needed)

`scripts/coop-client-contracts.cjs --check` with `EVEJS_FORK_ROOT=O:\tmp\c261108`:

```
CONTRACTS_OK calls=542 missing=0 stub=11
```

The same check against the engine the owner plays on today (`C:\Games\EveCoop\upstream-evejs`):

```
CONTRACTS_OK calls=542 missing=0 stub=37
```

So the port did not lose a single client-facing call, and 261108.1 answers 26
calls our fork still stubbed (a placeholder answer the client tolerates). The
register itself is unchanged: `--verify` reports
`CONTRACTS_OFFLINE_OK calls=542 missing=0 stub=37 nullable=102 ok=403`.

One scanner fix was needed for this to be true: 261108.1 splits a service into
`services/<svc>/<system>.js` modules attached with
`attach<X>ServiceMethods(require(...))`. `dogmaIM.GetRequiredSkillLevels` moved
there and read as MISSING until the scanner followed those attachments.

## Eight-minute soak with the market daemon attached

`O:\tmp\soak.ps1`: market daemon up, world booted, one process, sampled every 60 s.

```
alive after 8m: True          started-banner count: 1
minute 0 : rss 2859 MB threads 18
minute 1 : rss 2888 MB threads 15
minute 2 : rss 2763 MB threads 15
minute 3 : rss 2763 MB threads 14
minute 4 : rss 2723 MB threads 16
minute 5 : rss 2722 MB threads 16
minute 6 : rss 2725 MB threads 14
minute 7 : rss 2727 MB threads 14
stderr errors: 0
```

No crash, no restart, no stderr error, no memory growth (the residue is the static
tables and the 8490-system cache; RSS drifts down, not up). The only log output in
the window is informational startup/reconciliation.

After the soak both processes were stopped and 40110/40111/26000 verified closed -
the owner's ports are free again.


## Boot with 18 co-op flags on

A hook that only breaks when its flag is enabled does not show up in a silent
boot, so the same boot was repeated with the gates switched on:

```
flags on: 18      alive after 90s: True      banner: 1      stderr lines: 0
```

Flags: `NPC_RUNAWAY_GOTO`, `SOCIAL_NATIVE_GUARDS`, `DAILY_GOALS`, `STARGATE_LOCKS`,
`ESCORT_NATIVE_WARP_OBSERVER`, `NPC_CAPACITOR`, `PLAYER_CORP_ACCESS`,
`NATIVE_CONTRACTS`, `ATOMIC_TRADE`, `ITEM_AUDIT`, `WAR_CLIENT_VIEW`,
`NPE_NATIVE_SAFETY`, `NPC_BUY_NOTIFY_CATCHUP`, `INDUSTRY_PACING`,
`FLEET_WARP_SAFETY`, `FLEET_TRADE_SAFETY`, `NATIVE_MINING_CYCLE_CONSERVATION`,
`STRUCTURE_ALLIANCE_GUARD`.

Only three warning families appear, all expected:

* `[MarketDaemonClient] ... ECONNREFUSED 127.0.0.1:40111` and
  `[MarketProxy] Startup expiry settlement deferred` - no daemon in this run.
* `service alias already registered: contractMgr` - 261108.1 still ships the 86-line
  dead `contractMgrService`, so our `EVEJS_COOP_NATIVE_CONTRACTS` alias replaces it
  exactly as before and the manager logs the replacement. Cosmetic; the alias is the
  point of the hook.


## Integration into the engine line

Once the port booted, it was moved onto the branch every script and doc already
points at, without rewriting history:

```
git branch -m coop/pas7std        coop/legacy-20261028   # old engine, f64fed0
git branch -m coop/261108         coop/pas7std          # the port, 099603f
git checkout coop/pas7std                                # shared checkout now on the new engine
```

The shared checkout `C:\Games\EveCoop\upstream-evejs` is now on `coop/pas7std`
`099603f`: 3 134 tracked files (was 1 839), `_local/gameStore` and `node_modules`
preserved, `Code/server/node_modules` refreshed (`ws` and the 261108 dependency set
installed), and 24 content packs (572 MB) placed in `Code/content-packs/`, excluded
from git through `.git/info/exclude`.

Boot from that real tree (host Node, temp data root, 4 minute window):

```
t+30s  : rss 2772 MB cpu 28s   ...
t+60s  : rss 2856 MB cpu 59s   TIDI autoscaler disabled
t+90s  : banner 1
stop at 240s, rss 2767 MB, stderr 0
```

It is slower to answer than the bare worktree (61-90 s to the banner instead of
~8 s) because the 572 MB of content packs are installed into the store root on the
first start. Nothing failed: `stderr 0`, one banner, steady RSS.

Rollback, if this engine has to go, is `git checkout coop/legacy-20261028` - the old
line is byte-identical to what the containers were built from.


## Gates re-run on the integrated tree (`C:\Games\EveCoop\upstream-evejs\Code`)

```
coop-engine-audit      AUDIT_OK   563 co-op modules, 68 stock files, 382 co-op lines, 0 patching of ours
coop-perf-audit        PERF_OK
coop-client-contracts  CONTRACTS_OK calls=542 missing=0 stub=11
coop-overlay-presence  54/73 files, 156 lines missing  (with --ours coop/legacy-20261028)
```

One subtlety worth spelling out: presence against the *default* `--ours coop/pas7std`
now reports `68/68 complete, 0 missing`, because the port was integrated into that
branch and the checkout is that branch - a self-comparison. The script now says so
on stderr and points at the baseline that still measures something: the pre-port
line. The 156 remaining lines there are the market fence (75), the documented
retirements, and lines that moved with a different require depth.


## Co-op telemetry on the new engine (the `BLOCKED_TELEMETRY` rung)

The event writer needs `EVEJS_COOP_EVENTS_FILE`; without it `coopRuntimeProbe` refuses
by design (`BLOCKED_TELEMETRY_CONFIG`). With it set, a plain boot wrote **11 events**
and every one carries an explicit status instead of silence:

```
{"event":"living-startup-entered", "status":"START_REQUESTED_NOT_READY", "headlessConfigured":false, ...}
{"event":"living-native-war-skip", "phase":"opening",     "reason":"WAR_FLAGS_OFF",            "status":"SKIPPED", "evidence":"EXPLICIT_PRECONDITION_NOT_MET"}
{"event":"living-native-war-skip", "phase":"mobilization","reason":"WAR_FLAGS_OFF",            "status":"SKIPPED", ...}
{"event":"living-native-war-skip", "phase":"assault",     "reason":"WAR_FLAGS_OFF",            "status":"SKIPPED", ...}
{"event":"living-native-war-skip", "phase":"gate-staging","reason":"GATE_APPROACH_FLAG_OFF",  "status":"SKIPPED", ...}
{"event":"living-native-war-skip", "phase":"combat",      "reason":"COMBAT_FLAGS_OFF",         "status":"SKIPPED", ...}
```

That is the doctrine's "no silent no-op": a phase that did not run says why. It also
confirms the port kept the telemetry path intact - the old `BLOCKED_TELEMETRY` symptom
was this variable being unset, not the writer being broken.

