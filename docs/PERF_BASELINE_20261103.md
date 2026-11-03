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
