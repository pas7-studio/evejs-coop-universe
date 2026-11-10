# Port plan — co-op overlay onto EveJS 261108.1

Follows [UPSTREAM_261108_1_INTEGRATION.md](UPSTREAM_261108_1_INTEGRATION.md).
Owner decision 2026-11-10: staged integration on a separate branch; the play
stack keeps running the old engine until the new one is proven.

## Branches (fork `pas7-studio/EveJS`, checkout `C:\Games\EveCoop\upstream-evejs`)

| Branch | Commit | What it is |
| --- | --- | --- |
| **`coop/pas7std`** | **`099603f`** | **the integrated engine** (261108.1 base + the re-anchored co-op overlay). The shared checkout is on it. |
| `coop/legacy-20261028` | `f64fed0` | the previous engine line (pin `c3ea396` + 403 commits) — preserved, verified untouched, and the branch any rollback builds from |
| `upstream/261108.1` | `1d6b691` | release archive imported over `c3ea396` (content packs excluded) |
| `integration/261108.1` | (worktree `O:\tmp\m261108`) | plain `git merge` attempt: 137 conflicts, kept as a reference of the raw merge, never to be deployed |

The port was built as `coop/261108` and, once it booted, was moved onto
`coop/pas7std` with the old line renamed to `coop/legacy-20261028`, so the branch
every script and doc already points at is the new engine.

Content packs are **not** in git. They live in the checkout at
`Code/content-packs/` (24 packs, 572 MB, excluded through `.git/info/exclude`) and
are installed into the store root on first start. A build without them produces a
server with no incursions, missions, AIR or wormhole content, silently.

Worktrees: `O:\tmp\c261108` (detached verification tree), `O:\tmp\m261108` (merge
reference), `O:\tmp\w261108` (the bare import). Release extract: `O:\tmp\evejs-261108.1`.

## What `36543ca` already contains

* Base = `upstream/261108.1`.
* 637 files that exist only in our branch (563 co-op modules, generated tables,
  our tools) restored verbatim from `coop/pas7std`.
* Hook re-anchoring, machine pass: pure-insertion hunks placed by unique context
  anchors and validated with `node --check`; anything else reverted.
  Result: 30 files carry re-anchored hooks, 26 files still need manual work.

Excluded on purpose: `content-packs/` (572 MB). A build without them yields a
server with no incursions, missions, AIR or wormhole content, silently — copy
`content-packs\*.json` into the build context before any gameplay run.

## Second pass, 2026-11-10 (`b18502e`)

A presence gate now measures the port instead of the diff size:
`node scripts/coop-overlay-presence.cjs --engine O:\tmp\c261108\Code` takes every
line our branch added to a stock file that names co-op code and checks the
delivered tree still contains it.

```
overlay presence: 29/73 files complete, 452 co-op line(s) missing, 2 file(s) gone
```

Landed in `b18502e`:

* `network/tcp`: `coopVirtualWorldRuntime.start()` restored after
  `tidiAutoscaler.init()`. Our startup dungeon-resume patch is **retired** — the
  call it patched no longer exists in `tcp/index.js`; upstream moved persistent
  site advancement into `globalSiteSchedulerRuntime`, and whether the
  "sites expired while the server was down" case is still swept at boot is an
  **open question**, not a silent drop.
* `_shared/sessionDisconnect`: probe + client-cache reset run inside the same
  `attemptCleanup("logoff persistence")` callback that persists logoff state.
* `account/tutorialSvcService`: handler takes `(args, session)` again.
* `gameStore/index`: `coopAtomicNativeRows` adapter export restored (the table
  names had been re-anchored by the machine pass).
* `corporation/allianceRegistryRuntime`: binder + 24 `enforce` calls + owner-name
  `wstring` fix (py2 `ExtractLocalizedTags` trap).
* `corporation/corpRegistryRuntime`: owner-name `wstring` + `canUpdateApplication`.
  Our `canRecruit` / `canManageMembers` / `isMember` guards are **retired**:
  upstream now ships `canManageCorporationRecruitment` /
  `requireCorporationReadAccess` on the same handlers, so keeping ours would
  double-guard.
* `corporation/corpMemberActionState`: `canExecuteActions` restored.

Still structural (our code has no anchor in the new file, so it needs design, not
re-anchoring):

| File | missing co-op lines | why |
| --- | --- | --- |
| `services/mining/miningNpcOperations.js` | 84 | upstream rewrote the mining NPC operations |
| `services/market/marketProxyService.js` | 76 | upstream rewrote the market proxy (see queue B) |
| `space/runtime.js` | 49 | runtime hook surface moved |
| `space/npc/nativeNpcWreckService.js` | 27 | wreck service rewritten |
| `compose.yaml` | 24 | our stack overrides vs upstream's new compose |
| `services/inventory/itemStore.js` | 14 | atomic manifest transfer path |
| `services/trade/tradeMgrService.js` | 10 | trade service rewritten (persisted trades, bound objects) |
| `space/npc/*` (store, service, behavior loop) | 14 + 11 + 10 | durable NPC records |

## Third pass, 2026-11-10 (`101c383`, `2132ef0`)

* Bulk pure-insertion port with **exact anchors only** (successor lines first,
  predecessor as fallback), idempotent, per-file `node --check` with automatic
  restore: 2066 lines placed, 7 files restored because the anchor sat inside a
  restructured expression.
* `261108.1` split `space/runtime.js` into `space/runtime/*` and
  `space/destiny/*`. Re-homed so far: the stargate warp-range fix
  (`destiny/simulation/warpTargets.js`), the capacitor-charge authority
  (`runtime/shipEntity.js`), the mining-trace module-stop hook
  (`runtime/moduleEffectShutdown.js`) and the whole NPC ammo authority
  (`runtime/loadedChargeState.js`).
* Retired after checking upstream: `logMovementDebug` early return (261108.1
  already returns before building the record).
* The presence gate now searches the whole engine for a moved co-op line, so a
  legitimate re-home is reported as `complete-relocated` instead of "missing".

```
overlay presence: 38/73 files complete, 323 co-op lines missing, 2 files gone
```

Biggest remaining: market proxy (75), mining NPC operations (41), `runtime.js`
(40), `compose.yaml` (24), wreck service (23), item store (11), native NPC store
(11), mining runtime (9), trade (7), dungeon sites (6).

## Final state, 2026-11-10 (`1ebf774`): the port boots

```
node index.js  ->  EveJS Elysian is running!
                   8490 systems, 5210 stations, 40928 belts, 13978 stargates
                   express secondary service up, 75 s of ticks, no exception
```

Gates on the port tree: `AUDIT_OK` (563 co-op modules, 66 stock files, 372 co-op
lines, 0 patching of ours), `PERF_OK`, presence 54/73 files complete / 156 lines
missing / 2 files gone. Full evidence: [evidence/overlay-261108.1.md](evidence/overlay-261108.1.md).

Eight bulk-port defects were found by the boot loop and fixed (displaced blocks,
exports without definitions, duplicate protobuf types, missing imports). What
remains is deliberate: the market proxy settlement fence (75 gated lines, needs a
design decision against upstream's durable market), the escort motion observer,
the runaway-goto guard and the warp landing tracer. Everything else that the
presence gate still counts is either a documented retirement (upstream now does
it natively) or a line that moved with a different require depth.

Not done: `docker build`, containers, client, gameplay - Docker's Linux engine
was down and starting Docker Desktop would have restarted the owner's stacks.


## Remaining queue A — finish the overlay (the 64 hook files)

114 hunks need a human decision, in 26 files. `syntax-fail` means the whole file
is still the upstream version and every one of its hunks must be redone.

| File | hunks | status |
| --- | --- | --- |
| `Code/server/src/space/runtime.js` | 33 | syntax-fail |
| `Code/server/src/space/npc/nativeNpcStore.js` | 10 | syntax-fail |
| `Code/server/src/services/mining/miningNpcOperations.js` | 8 | syntax-fail |
| `Code/server/src/space/npc/npcService.js` | 8 | syntax-fail |
| `Code/server/src/space/npc/nativeNpcWreckService.js` | 7 | syntax-fail |
| `Code/server/src/services/inventory/invBrokerService.js` | 5 | syntax-fail |
| `Code/server/src/services/dungeon/dungeonUniverseSiteService.js` | 4 | syntax-fail |
| `Code/server/src/services/faction/facWarMgrService.js` | 4 | syntax-fail |
| `Code/server/src/services/ship/beyonceService.js` | 4 | manual |
| `Code/server/src/services/trade/tradeMgrService.js` | 3 | syntax-fail |
| `Code/server/src/services/corporation/allianceRegistryRuntime.js` | 3 | syntax-fail |
| `Code/server/src/services/agent/agentMissionRuntime.js` | 3 | syntax-fail |
| `Code/server/src/services/industry/industryManagerService.js` | 3 | manual |
| `Code/server/src/space/npc/nativeNpcService.js` | 3 | syntax-fail |
| `Code/server/src/services/_other/contractProxyService.js` | 2 | manual |
| `Code/server/src/services/character/achievementTrackerMgrService.js` | 2 | manual |
| `Code/server/src/services/mining/miningRuntimeState.js` | 2 | manual |
| `Code/server/src/network/tcp/index.js` | 2 | manual |
| `Code/server/src/services/corporation/corpRegistryRuntime.js` | 1 | syntax-fail |
| `Code/server/src/services/corporation/corpMemberActionState.js` | 1 | manual |
| `Code/server/src/services/corporation/fwCharacterEnlistmentMgrService.js` | 1 | partial |
| `Code/server/src/services/_shared/sessionDisconnect.js` | 1 | manual |
| `Code/server/src/services/account/tutorialSvcService.js` | 1 | manual |
| `Code/server/src/services/industry/industryParityHelpers.js` | 1 | manual |
| `Code/server/src/services/market/marketProxyService.js` | 1 | manual (whole-file rewrite, see phase B) |
| `Code/server/src/space/npc/npcBehaviorLoop.js` | 1 | syntax-fail |

Plus the 30 already-written files, which must be reviewed for weak anchors
(context matched on only two lines) and for hooks whose target function changed
shape upstream — compile-clean is not semantics-clean.

Deleted upstream, our hooks have no home:

* `space/movement/warp/movementWarpState.js` (1 hook line)
* `space/movement/dispatch/movementSceneRefresh.js` (11 inserted lines)
* `space/destiny.js` (+13/−7), `space/movement/authority/destinyAuthority.js` (+1/−1)

They must be re-expressed in the new movement pipeline or retired with a written
reason; silently dropping them loses presence/scene refresh behaviour.

## Remaining queue B — our engine rewrites (no longer "overlay")

The other 74 conflicted files are our own feature code sitting in stock files.
They are not hooks; each is a decision "port ours, retire ours, or adopt
upstream's". The heavy ones, with our diff size at the pin:

| File | our diff | note |
| --- | --- | --- |
| `services/market/marketProxyService.js` | +4565/−4254 | our NPC market vs upstream's rewritten market |
| `externalservices/market-server/src/state.rs` | +4136/−3534 | Rust side of the same |
| `tools/market-seed/src/main.rs`, `tools/market-seederv2/src/main.rs`, `tools/*/config/*.toml` | full-file | v4 seeder differs |
| `services/support/petitionerService.js` | +145/−162 | |
| `_secondary/express/gatewayServices/skillPlanGatewayService.js` | +252/−222 | |
| `_secondary/express/gatewayServices/compatibilityGatewayService.js` | +130/−34 | |
| `services/faction/facWarMgrService.js` | +397/−3 | |
| `space/npc/*` (store/service/scene) | +255…+130 | durable NPC records |
| `services/mining/*`, `services/dungeon/*`, `services/industry/*` | various | |

Queue B is where the real judgement is: upstream now ships its own market
seeding (v4 "Iron Man"), NPC wreck lookup fixes, market order matching by price
and issue time. Porting our market rewrite on top of it may be strictly worse
than adapting our NPC modules to upstream's market. That decision must be taken
per subsystem, with the gates from `docs/COOP_LOOP_ACCEPTANCE.md`.

## Order of work (each slice ends with a boot check)

1. Session/boot spine: `gameStore/*`, `network/tcp`, `_shared/sessionDisconnect`,
   `chat/sessionRegistry`, `account/*` — the server must start headless.
2. Presence and transitions: `space/runtime.js`, `space/transitions.js`,
   `space/npc/*` — named NPCs materialise.
3. Economy spine: `market/*` (decision point), `industry/*`, `mining/*`,
   `inventory/*`, `trade/*`.
4. Content families: `dungeon/*`, `faction/*`, `sovereignty/*`, `agent/*`.
5. Movement/Destiny re-home of the lag instrumentation from `f64fed0`.

Boot check per slice (agents stack only, never the play stack):

```
scripts\Start-Agents-Stack.ps1 -Action Status
cd C:\Games\EveCoop\upstream-evejs\Code   # or the port worktree
docker build -t evejs-local .             # add content-packs to the context first
scripts\Start-Agents-Stack.ps1 -Action Up
```

## Gates that must be green before anyone calls this integrated

* `node scripts/coop-engine-audit.cjs` → `AUDIT_OK`, same 64 stock files, no new
  monkey-patching, co-op line count not inflated.
* `node scripts/coop-perf-audit.cjs` → `PERF_OK`.
* `node --check` on every touched `.js` (the port script does this; a manual edit
  must not skip it).
* `docs/UPSTREAM.md` new pin row + `scripts/patch-evejs-coop.cjs` PIN in the same
  commit (`tests/coop-overlay-drift-check.test.mjs`).
* `docs/evidence/overlay-<newrev>.md` with the manual evidence.
* `node scripts/log-change.cjs --layer L2 ...` after each landed slice.
* Gameplay: `docs/GAMEPLAY_TESTING.md` ladder — telemetry, World, one client,
  two clients. Nothing beyond "server boots" is claimed without that.
