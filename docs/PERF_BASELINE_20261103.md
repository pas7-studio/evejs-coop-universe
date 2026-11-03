# Perf baseline, 2026-11-03 (live play stack, evejs-server-1)

Measured with the two opt-in witnesses now in the fork: `coop-perf-sample` (phase cost, per minute) and
`coop-memory-sample` (registry sizes and the retained heap of every phase). Play container image
`e4276924вЂ¦` (fork `3421242`).

## World tick, before в†’ after

| phase | before | after | what changed |
|---|---|---|---|
| `native-ammo-observe` | 1074вЂ“1181 ms every tick | below the top 7 (< ~130 ms) | it no longer creates a scene per visited system, only observes existing scenes, caches the assignment list, hands each scene only its own rows, and the native store answers per-entity cargo/module lookups from a table index instead of a per-hull scan |
| `npc-reconcile:<system>` | 590вЂ“820 ms per system | 92вЂ“161 ms per system | same store index |
| `native-faction-war-garrison` | 1008 ms avg / 2339 ms max | out of the top six | war state and fleet registry memoized for 20 s |
| `observed-native-mining` | 143.5 MB retained per minute (32 calls) | out of the top allocators | convoy renewal throttled to one pass per scene per minute |
| `universe-sites` | p95 22.3 s, ran every ~26 s | p95 ~22 s, one pass per 10 min or on a new player system | cadence gate; the remaining single pass is the next target |
| `native-ammo-observe` heap | вЂ” | вЂ” | `heapUsedMB` fell from 4.5 GB to ~2 GB at boot after the mining throttle |

## Registry sizes at boot (coop-memory-sample)

`nativeEntities` 8410, `nativeControllers` 8410, `nativeWrecks` 418, `scenes` 35,
`dungeonInstances` 6285, `identityLinks` 0, `warFleetHulls` 0.

## Rules that follow

- Every claim above comes from a live sample, not from reading code.
- A perf fix is accepted only when the same named phase gets cheaper; a cheaper RSS or a smaller heap alone is not
  evidence.
- `universe-sites` is the last multi-second phase. Measured: the definition builder costs ~1.1 s per spawn family\n  (23 families) and only ~7 s extra for all 36 systems together, so the cost is per-family, not per-system. The\n  candidate-system caches now hit (coarse, order-independent keys), yet the per-family price did not move: the next\n  step is in-module timing inside the family loop (templates, policy context, band resolution), not more guessing.


## 2026-11-03 late: the real price of a site pass, and why it froze the loop

The "~1.1 s per spawn family" above was a symptom, not the cause. A CPU profile of the
definition builder for 36 real systems (16.2 s, 240 definitions) put **87 % of the time in
deep copies nobody used**:

| Frame | Self time | Why |
| --- | --- | --- |
| `sovStore.cloneValue` via `sovState.ensureLoaded` | 7.9 s | read + deep-cloned the whole 3 MB sovereignty table only to compare `_meta.updatedAt` with its own cache (26 ms per call, hundreds of calls) |
| `dungeonRuntimeState.cloneValue` via `listUniverseSeededPersistentSiteInstances` | 6.3 s | `{ full: true }` on three lifecycle lists deep-cloned all 6471 instances twice per family and band |
| GC | 1.5 s | garbage from the clones above |

Fixes (fork `daefd29`): compare on the raw row (`readRawSovereigntyTable` already existed
for exactly this) and use instance summaries, which carry every field the filter reads.

That left 8.3 s of definitions per pass, so the pass was sliced (fork `0bf4a8c`): 3 systems per
slice on a 0 ms timer, one pass at a time, a system marked reconciled only when its slice
finished, wormhole destinations seeded as extra slices. Live: `[CoopUniverseSites] systems=36
desired=302 created=1 spawned=5` and `universe-sites` dropped out of the top-14 phase list.

## Remaining blockers after the slice (measured 2026-11-03 13:0xZ)

Loop lag since the last restart: **boot warm-up 19.4 s**, then 0.3-1.5 s occasional stalls
(was ~2.4 s every half minute before the slice). A 60 s steady-state CPU profile names them:

| Frame | Self time / 60 s | Note |
| --- | --- | --- |
| `coopHaulCargoAdoption.plan` (inside the mining scene tick) | 4.6 s | scans every cargo row, calls the native registry per row |
| `nativeNpcStore.readCollection` clones via `coopNativeReadCache.cargoAll` | 3.8 s | the same rows are deep-cloned 2-3 times per read |
| `buildConfiguredCONCORDStartupRules` (`structuredClone`) | 1.7 s | stock: rebuilt per scene tick instead of once |
| GC | 2.0 s | |

Next step is therefore not another pass-level fix: it is one cached cargo read per tick and one
CONCORD rule build per tick, then re-profile. Anything claimed here must be re-measured the same
way, because a cheaper RSS alone is not evidence.

## 2026-11-03 13:2xZ: what the remaining stalls actually were, and the floor we hit

After the slice, loop lag was still 2.2-3.8 s every ~3 s for a whole minute after boot. Measured
cause, in order:

1. `coopHaulCargoAdoption.plan` ran on every mining scene tick (10 Hz x loaded scenes) and scanned
   every cargo row: **10.6 s of CPU per 180 s**, plus 6.2 s reading the table through the read cache.
   The cache now keeps a (system, fleet) index and a cargoID count, so the planner visits only its own
   tagged rows; a non-pinned store still takes the full scan (fork `0a177aa`).
2. The cargo table was deep-cloned up to five times a second (200 ms cache window). The store now
   exposes `peekNativeCargo()` and the cache shallow-copies each row (fork `a9dcdff`): 3.8 s -> 1.2 s.
3. One system's site reconcile measured **3.34 s**: `filterSummaryList` deep-cloned all 6471 instance
   summaries on every band x family call. `rawRows` now hands out the cache's own summaries for that
   one read-only call site (fork `857d8e7`): **3.34 s -> 1.06 s per system**.
4. Slicing by 3 systems still froze, so a pass is now one system per slice and seeds at most 8 systems,
   player-occupied first (forks `81d3a06`, `40a9abc`).

Live effect on the play stack (same instrument, 3 minutes after recreate): no more continuous 2-3 s
freezes; steady state is mostly **0.25-0.9 s** with an occasional 1.5 s, and the boot burst is the 8-system
pass instead of a 36-system one.

**The floor:** one system still costs ~1 s because the engine deep-clones its whole 44 MB
`dungeonRuntimeState` on every mutation (a single `mutateState` alone costs 180 ms + normalize ~200 ms).
Slicing cannot make that invisible; the next real step is row-level mutation there, not more coop-side
work. That is an engine change with real blast radius and needs its own plan.

## 2026-11-03 13:5xZ: sub-second slices, and what is left

Measured chain for one system's site reconcile (the unit a pass pays for): definitions 149 ms +
`reconcileUniverseSeededInstances` 690 ms + misc. The 690 ms was pure copying, not work:

- `mutateState` deep-cloned the whole 44.9 MB state (~180 ms) and `normalizeState` re-normalized
  all 6499 instance records (~200 ms) even when the diff was empty;
- the mutator itself normalized every instance before it could tell most were out of scope (~200 ms).

Fix (fork `c30fcbb`): `mutateState(mutator, {shallow:true})` - used only by the seed reconcile,
whose mutator replaces whole records and never mutates one in place - plus scope-first reads so only
the targeted systems' instances are normalized. **690 ms -> 131 ms**; a system that really creates
sites now takes 561 ms end to end (verified: Jita went from 0 to 3 seeded sites with a proper
siteKey/template/hash/position).

Then the pass itself: `setTimeout(0)` between slices kept its own chain at the front of the timer
queue, so eight 350 ms slices still arrived as one 3.8 s block. A real 300 ms gap (fork `7916bf1`)
makes the worst block one slice. And the NPC sweep reconciled every visited system in one tick
(2.1-3.8 s): occupied systems always run, three others rotate (fork `9c9d2ed`), and war opening -
the worst single phase at 658 ms - now runs every fourth tick (fork `e34b605`).

Live after the last recreate: `universe-sites` 53 ms, `npc-reconcile` 2 systems x ~100 ms, and the
lag monitor reported nothing above 250 ms for 111 s straight; the remaining hits are one ~1.6 s sample
after boot and a 12.8 s boot warm-up (cache preload + world init), plus GC on a 4.7 GB RSS.

Remaining known costs, in order: boot warm-up (12 s once), GC (5 s per 180 s of CPU), `npc-recognition`
(342 ms max), and the per-system dungeon state write path, which still serializes a 44 MB table when a
mutation really happens.

## 2026-11-03 14:3xZ: a real gameplay bug behind one of the "phases"

While measuring the remaining phases, the log carried 63 identical errors in one container:

    [CoopLivingWorld] native-faction-war-garrison Cannot assign to read only property 'snapshot'

`memoFor` built its cached wrapper with `Object.create(frozenRegistry)` and then assigned
`snapshot`. With the inherited property read-only that is a strict-mode TypeError, and the war fleet
registry returns `Object.freeze({snapshot,claim,execute})`. The consequence was not a missing cache:
the garrison phase **threw on every tick**, so no garrison was ever refilled and PREPARING/ASSAULT
campaigns never got their hulls. `wrapSnapshot()` (space/coopMemoSnapshot.js) copies the registry
into a writable object that keeps its prototype; a failing source returns an empty snapshot instead of
killing the phase (fork `6c921d7`, 3 tests).

With the phase fixed it now really spawns formations (verified events: `GARRISON_APPLIED` with three
native hulls per side), and that costs ~1.4 s per formation, so it runs on every second tick, offset
from war opening so the two heaviest war phases never land together (fork `7ba0dcd`).

State after that deploy: typical ticks 0.27-0.58 s, with 1.8-4.7 s hits on a boot warm-up, the first
site pass and the garrison tick. Remaining known costs: garrison formation ~1.4 s (real spawn work that
never ran before), boot warm-up ~10-13 s, GC ~5 s per 180 s at a 4.7-5.9 GB RSS, and a 44 MB dungeon
table serialization whenever a site really changes.

## 2026-11-03 15:1xZ: the last big CPU items were cache rebuilds, not logic

A 150 s profile after the entity fix still put 24 s of CPU in `cloneValue` under
`listNativeEntities`: the read cache deep-cloned all ~8500 entity rows up to five
times a second just so war combat could read a few fields per pair. Same story as
cargo. Fixes (forks `04d8637`, `be9b229`, `e16f110`, `a010685`):

- `peekNativeEntities()` + shallow copies in the cache: entity index rebuild is now
  a copy, not a JSON round-trip of the table.
- the store invalidates the read cache on every successful write, so the cache window
  is a backstop (2 s) instead of the only freshness mechanism (200 ms). That alone
  removed most of the rebuilds.
- `capture()` in the transient-cargo isolation compared a full deep clone of the
  live cargo root against SQLite on every turret cycle (6.7 s / 150 s); the preimage
  is now shallow, which is structurally identical for that comparison.
- the garrison phase (which only started working today) spawns up to two formations
  per tick at ~0.7 s each; a 600 ms per-tick budget defers the second to the next tick.

Live after the last deploy: **85 % of a 140 s window is idle** (it was 58 % before
these fixes and pegged earlier), GC fell 13 s -> 1.5 s per window, `heapUsed` is
1784 MB with RSS 4.4-5.5 GB, and steady ticks are 0.34-0.76 s with one ~1.7 s sample
at the first garrison tick after boot.

What is left is small and spread: CONCORD startup rules rebuilt per scene tick
(`structuredClone`, 3.1 s / 140 s - stock), `getSceneActivityState` (2 s / 140 s -
stock), boot warm-up ~10 s, and the 44 MB dungeon table serialization when a site
really changes.

## 2026-11-03 15:3xZ: one system with real site creation now costs ~0.33 s

After the summary/clone work the last 1.7 s spike came from `buildCache` inside
`mutateState`: it normalized all 6499 instance records again and rebuilt every
summary (~1 s) after a mutation that had already built the changed records
normalized. `buildCache` now takes `alreadyNormalized` (only the shallow seed
mutation sets it) and reuses the previous summary when the record object is
literally the same instance, so a small change rebuilds only what it changed
(fork `a2aefea`).

Also: `listNpcStartupRules()` rebuilt 1246 generated CONCORD rules and
structuredCloned them on every call (~3.2 ms measured; a scene tick asks often).
The authored rows are 11, so they are compared directly and the built list is
reused until they change, while every caller still receives its own array (fork
`ef21b3f`).

Live measurement of one system that really creates sites: definitions 130 ms +
`reconcileUniverseSeededInstances` 173 ms (was 690, and 3.34 s at the start of
this work) + a 24 ms table flush = ~325 ms, with `createdCount: 2`. Steady loop
lag on the same container: 0.32-0.69 s samples, one 1.4 s at the first site pass.

The remaining burst is the one-time world init (a 10-16 s block ~1 minute after
start): the log shows it split across the stargate preload, scene creation and
materialization, not one hot function. That is the next real project.
