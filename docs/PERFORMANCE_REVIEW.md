# Performance review — measured, not guessed

Every number here comes from a V8 CPU profile of the **running** server
(`--cpu-prof` equivalent attached over the inspector, 1 ms sampling), from
`docker stats`, or from the phase metrics added in this change. Nothing in this
document is an estimate.

## How to reproduce a profile

```powershell
# open the inspector on the live server process (PID 1 in the container)
docker exec evejs-server-1 node -e "process.kill(1,'SIGUSR1')"
docker cp <repo>\scripts\Analyze-CpuProfile.cjs evejs-server-1:/tmp/an.cjs
# a 20-25 s profile, then the top self-time rows
docker exec evejs-server-1 node /tmp/live-profile.cjs 25 /tmp/live.cpuprofile
docker exec evejs-server-1 node /tmp/an.cjs /tmp/live.cpuprofile 12
# and the calling chain of each hot row
docker exec evejs-server-1 node /tmp/chain.cjs /tmp/live.cpuprofile
```

`scripts/Analyze-CpuProfile.cjs` ranks self time per function; the chain tool
shows which caller pays for it. A hot `cloneValue` is useless until the chain
names the loop that calls it.

## Round 1 — the NPC store cloned the whole root on every read

Profile before: `cloneValue` 62.7% + `ensureRootShape` 24.0%, **0% idle**.

`nativeNpcStore.readCollection` read the entire NPC root (entities, modules,
cargo, wrecks of every system), deep-cloned it twice through
`JSON.parse(JSON.stringify())` and compared two full `JSON.stringify` results —
on every call. `ensureRootShape` did the same again.

Fix (L1 patch `0009`): verify the root shape once per table per process, and read
only `/<collection>` instead of the root.

Profile after: `ensureRootShape` **0%**, `cloneValue` 41.9%, **idle 32.7%**.

## Round 2 — our own callers re-read a collection per entity

Profile after round 1, with caller chains:

| self time | chain |
| --- | --- |
| 5962 ms (23% of wall) | `cloneValue` ← `readCollection` ← `getNativeEntity` ← **`coopWarCombatAuthority.evaluatePair`** |
| 1406 ms (5.5%) | `cloneValue` ← `readCollection` ← `listNativeCargo` ← **`coopHaulCargoAdoption.cargoRows`** ← `plan` |
| 871 ms (3.4%) | `cloneValue` ← `readCollection` ← `getNativeEntity` ← **`coopNativeMiningFleetDurable.check`** |
| 672 ms (2.6%) | `buildConfiguredConcordStartupRules` ← `listStartupRulesForSystem` ← `tickScene` (stock) |

The pattern is the same in all three: a loop over entities or pairs, and one full
collection read per iteration. That is O(n²) work for O(n) data.

Fix (`coopNativeReadCache.cjs`): one bulk read per 200 ms window
(`EVEJS_COOP_NATIVE_CACHE_TTL_MS`), then an id → entity map. What is cached is
identity only (corporationID, systemID, cargo rows) — never HP, position, or a
combat verdict, which still come from the caller and the live controller.
`invalidate()` is the explicit escape hatch; the TTL is the backstop.

Wired into the three measured call sites. Tests:
`tests/coop-native-read-cache.test.mjs` (6 cases: single bulk read, TTL expiry,
invalidate, unknown id is a miss, cargo grouping, missing store degrades to empty).

## Round 3 — metrics, so the next round is measured too

`coopPerfMetrics.cjs` + one hook in `safeNpcPhase`, the single funnel every world
phase already goes through. Off by default; `EVEJS_COOP_PERF_METRICS=1` turns it
on and the runtime then emits `coop-perf-sample` every 60 s with the top eight
phases by average cost (count, avg, p50, p95, max).

The ring buffer is bounded (200 samples per phase), so instrumentation cannot
become the leak it is meant to find. `timePhase` re-throws the original error
unchanged: it can never alter control flow.

## What is left, in the order the profile justifies

1. **`buildConfiguredConcordStartupRules`** (2.6%) runs per scene tick. Stock
   code; the rules only change when the configuration changes, so a
   config-keyed memo is the honest fix — candidate for the next L1 patch.
2. **`structureState.cloneValue`** (0.4%) — same pattern as round 1, smaller.
3. **`reconcileObject` in `coopGameStoreAtomic`** (0.9%) — our atomic commit
   bridge re-walks objects on every write; a dirty-subtree check would cut it.
4. **Multiple cores.** The authoritative loop is one Node thread. The real
   split, in order of safety: (a) move HTTP/image/XMPP into their own process
   (the market already runs separately), (b) `worker_threads` for pure math over
   snapshots (evidence sampling, economy), (c) per-system scene workers with
   message passing — the last one is an architecture change, not a patch.

## Rules this review keeps

- No optimisation without a profile row naming the caller.
- No cache without a bounded TTL, an explicit invalidate and a test.
- A faster timer that changes a game rule (weapon cycle, dogma, settlement) is
  not an optimisation — it is a different game.
