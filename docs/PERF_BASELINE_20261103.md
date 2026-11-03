# Perf baseline, 2026-11-03 (live play stack, evejs-server-1)

Measured with the two opt-in witnesses now in the fork: `coop-perf-sample` (phase cost, per minute) and
`coop-memory-sample` (registry sizes and the retained heap of every phase). Play container image
`e4276924…` (fork `3421242`).

## World tick, before → after

| phase | before | after | what changed |
|---|---|---|---|
| `native-ammo-observe` | 1074–1181 ms every tick | below the top 7 (< ~130 ms) | it no longer creates a scene per visited system, only observes existing scenes, caches the assignment list, hands each scene only its own rows, and the native store answers per-entity cargo/module lookups from a table index instead of a per-hull scan |
| `npc-reconcile:<system>` | 590–820 ms per system | 92–161 ms per system | same store index |
| `native-faction-war-garrison` | 1008 ms avg / 2339 ms max | out of the top six | war state and fleet registry memoized for 20 s |
| `observed-native-mining` | 143.5 MB retained per minute (32 calls) | out of the top allocators | convoy renewal throttled to one pass per scene per minute |
| `universe-sites` | p95 22.3 s, ran every ~26 s | p95 ~22 s, one pass per 10 min or on a new player system | cadence gate; the remaining single pass is the next target |
| `native-ammo-observe` heap | — | — | `heapUsedMB` fell from 4.5 GB to ~2 GB at boot after the mining throttle |

## Registry sizes at boot (coop-memory-sample)

`nativeEntities` 8410, `nativeControllers` 8410, `nativeWrecks` 418, `scenes` 35,
`dungeonInstances` 6285, `identityLinks` 0, `warFleetHulls` 0.

## Rules that follow

- Every claim above comes from a live sample, not from reading code.
- A perf fix is accepted only when the same named phase gets cheaper; a cheaper RSS or a smaller heap alone is not
  evidence.
- `universe-sites` is the last multi-second phase; its single pass still blocks ~22 s and needs the same treatment
  (definitions per family over 36 systems).
