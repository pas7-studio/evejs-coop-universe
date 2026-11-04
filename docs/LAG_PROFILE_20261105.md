# Where the lag actually goes (CPU profile, 2026-11-05)

The owner reported "actions lag again". The event-log storm was one cause and is fixed
separately (see `docs/WORKLOG.md`, `8fe1892`: 13 440 duplicate `living-haul-custody-blocked`
events per hour, one full 15 310-row cargo scan per ore stack per attempt). This document is
the second, bigger one: a real CPU profile of the world.

## How it was taken

The **work stack** (`evejs-agents`) runs with `--cpu-prof` in
`compose/compose.agents.yaml`, so its profile is free:

```powershell
docker exec evejs-agents-server-1 sh -c "ls -la /var/lib/evejs/prof/"
# copy the biggest CPU.*.cpuprofile out, or analyse it in place:
docker exec -w /app/server evejs-agents-server-1 \
  node --max-old-space-size=4096 /tmp/coop-cpuprofile-top.cjs /var/lib/evejs/prof/<file>.cpuprofile
```

`scripts/coop-cpuprofile-top.cjs` prints self-time per function and per file, which answers
"where does the CPU really go" instead of guessing. Never profile the play stack for this;
the work stack is disposable and has the same code.

## The measurement (2 219 s profiled, 82.55% idle)

| share | self time | what |
| --- | --- | --- |
| 4.02% | 89.27 s | `writeFileUtf8` — synchronous JSON writes |
| 1.23% | 27.35 s | `read` in `space/coopMarketMakerTraders.js:43` |
| 1.03% | 22.86 s | `getSceneActivityState` in `space/npc/npcSceneActivity.js:169` |
| 0.90% | 20.00 s | `write` in `space/coopMarketMakerTraders.js:50` |
| 0.80% | 17.84 s | `(garbage collector)` |
| 0.65% | 14.41 s | `fsync` |
| 0.65% | 14.40 s | `tick` in `space/runtime.js:37501` |
| 0.65% | 14.40 s* | `fsync` (second site) + 4.57 s + 2.00 s |

Add the fsync sites together and **synchronous writes are ~28% of all non-idle CPU** — every
one of those is a blocking call on the event loop, which is exactly what a player feels as
"the client is not reacting".

## Fixed because of this profile

1. **Market-maker trading document** (`fcae8c0`): `read()` re-read and re-parsed the whole
   JSON on every call, `snapshot()` once per tick, and the runtime's fallback
   `createTraders({clock})` built a *new* instance (and read) every tick. The document is now
   one process-owned instance per file path, loaded once; writes stay synchronous (money is
   never deferred). `snapshot()` still returns a value (`structuredClone`), so callers that
   compare two snapshots keep working.
2. **Virtual-world state file** (`0cec93c`): rewritten on **every** cycle because `advance()`
   persists whenever any pilot has a physical location, which is almost always. Writes are
   coalesced to at most one per `EVEJS_COOP_WORLD_SAVE_MS` (default 2000), the last change
   always lands, and `flush()` runs on `beforeExit`. Only virtual pilot positions live there.

## Still on the table (measured, not yet fixed)

- **Other synchronous writers**: `coop-economy.json`, `coop-courier-flights.json`,
  `gameStore` sqlite flush (`enqueuePersistenceOperation`, 3.76 s) and any other
  `writeFileSync` on a tick path. Each should either be coalesced like the world file or
  moved onto a write-behind queue with an explicit `flush()`.
- **getSceneActivityState (22.86 s)** - **fixed** in 8114ec8: computed once per system per
  sim stamp through space/npc/sceneActivityMemo.js, with the session count in the key so a
  pilot arriving is never hidden. The remaining cold-scene branches still recompute when the
  stamp moves, which is the cheapest possible behaviour without changing when NPCs are ticked.
- **GC (17.84 s, heap ~2.7 GB live on the play stack)**: the largest single allocator is
  probably the 15 310-row native cargo table being cloned by `listNativeCargo()`; anything
  that needs counts should use a counted read instead of a clone + sort.

## Rules for the next profile

1. Measure, then change one thing, then measure again — the profile numbers above are the
   baseline to compare against.
2. A change that cannot be shown in a profile or in a log line is not a performance fix.
3. Never trade durability for speed silently: money paths write synchronously, world/state
   bookkeeping may coalesce, and every coalescing writer must expose `flush()`.
