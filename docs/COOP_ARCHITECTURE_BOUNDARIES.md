# Co-op module boundaries

Purpose: fewer problems later. This file says which module owns which
decision, how the layers may call each other, and what is still mixed and
must be split. It is written from measurements, not from taste.

## Measured state (2026-10-26)

| Measure | Value | Why it matters |
|---|---|---|
| Overlay modules | 363 in `integration/`, 46 676 lines | one world-sized runtime |
| Largest modules | `coopVirtualWorldRuntime` 2881, `coopNativeStationArrival` 1060, `coopCourierRuntime` 806 | too big to test without Docker |
| `EVEJS_*` keys in code | 310 | no one could say which gates are on |
| Gates set in the live probe compose | 103, of which 52 are `1` | the real world is 52 switches wide |
| Modules reading `process.env` directly | 149 (581 reads) | now routed for our own restart modules |
| Own `const pos=` copies | 96 | tolerated; not worth a mass rename |
| Direct `probe.observe` callers | 7 | must go through `coopObserve` |
| Modules touching `gameStore`/`nativeNpcStore` | 54 | most lazily, inside functions (good) |

## The four roles

Every module plays exactly one of these. A file that plays two is a future
incident.

1. **Authority (pure).** Decides from data it is given: route choice, price,
   phase transition, whether a load is proven. No I/O, no `Date.now()` inside
   the decision, no `require("../gameStore")`. Testable with plain objects.
2. **Adapter (impure).** The only place that talks to EveJS, GameStore,
   SQLite, the filesystem or Docker. Reached through injected dependencies
   (`options.store`, `options.database`) or one named `load()` helper, so a
   test can replace it.
3. **Mechanism (stateful).** Owns a lifetime that outlives one call: the trip
   director, the fleet materializer, the adoption slot, the journals. May call
   authorities and adapters; may never invent evidence it did not observe.
4. **Telemetry.** `coopObserve.observe` / `noteOnce` only. A throwing probe
   must never change gameplay.

Crossing rules:

- Authority ← Adapter is forbidden (no upward calls; pass data in).
- Two mechanisms may not write the same record. If they must, one of them
  reads only.
- Every mechanism that mutates native state must emit one event with an
  explicit `status` or `reason`, and must fail closed on an ambiguous result.
- A feature is OFF unless `coopFlags.on("EVEJS_...")` returns true, and only
  the exact string `1` enables anything.

## Single owner per record (today)

| Record / decision | Owner | Readers |
|---|---|---|
| native cargo row (haul) | `coopNativeHaulCargo` writes, `coopDurableCargoWrite` makes it survive restart | `coopHaulCargoAdoption`, `coopAlifeStartupCargoAudit` (read-only) |
| re-attaching orphan haul cargo after a restart | `coopHaulCargoAdoption` | audit verifies, never repoints |
| station trip manifest / warp ACK | `coopNativeStationTripJournal` | audit |
| NPC market order | `coopNativeNpcMarket` (never `PlaceOrder` alone) | economy director |
| ISK balance change | settlement modules (`coopEscortContractSettlement`, `coopNativeStationOreSettlement`, …) | economy sensors |
| telemetry | `coopObserve` | every module |
| our own flags | `coopFlags` | every module |
| "did the ore really move?" | `verifyLoad()` inside `coopNativeHaulCargo` | both transfer paths |

`coopAlifeStartupCargoAudit` is deliberately **read-only**: it is the referee,
not a repairer. Anything it refuses needs an operator, not a second heuristic.

## Enforcement in the deploy loop

```bash
node scripts/coop-flags.cjs --check          # FLAGS_OK, no undeclared gate
node scripts/coop-flags.cjs --live \
  --compose compose.yaml,compose.coop-probe.yaml   # which 52 gates are actually on
node --test tests/coop-flag-registry.test.mjs tests/coop-haul-load-verification.test.mjs
```

`docs/coop-flags.json` is generated, but a new key must be reviewed before it
is accepted: `--baseline` then read the diff. `--live` also prints keys the
compose still sets that no module reads (for example the removed
`EVEJS_COOP_NPC_CAPACITOR`); the tool reports them and never deletes them.

## Still mixed, in the order worth splitting

1. **`coopNativeStationArrival` (1060 lines).** Three responsibilities in one
   file: route planning, the trip phase machine, and the impure commit
   (warehouse deposit, sale, ISK). Target seams:
   - `chooseDestination(market, fleet, cargo)` — pure, decides the station by
     argmax of fillable price × volume;
   - `nextPhase(state, observation)` — pure, returns the next phase or the
     reason it cannot advance;
   - `commitArrival(deps, ...)` — impure, the only place that sells, deposits
     and books ISK.
   Payoff: the sell path becomes testable without Docker, which is the last
   unverified link in mining → haul → sell → ISK. Risk: this file is being
   edited by the owner right now, so do it only after the live acceptance run
   and after announcing the seam list.
2. **`coopVirtualWorldRuntime` (2881 lines).** Should be a table of named
   phases plus a runner, not one function that grows. Highest risk, lowest
   urgency: it already works, and a silent reorder would change the world.
3. **The 7 direct `probe.observe` callers.** Mechanical, safe, one commit:
   route them through `coopObserve` so a throwing probe cannot break a
   runtime path.
4. **96 copies of `pos`/`positive`.** Leave them. A shared helper would touch
   every file for no behavioural gain; new modules should import one instead
   of adding a 97th copy.

## What this repository will not do

- A second patching mechanism (`patches/upstream` + one overlay engine only).
- Mass renames or "big bang" module moves while a live acceptance is running.
- CI, network scans or automatic deployments.
- Treat a unit test as proof of gameplay: only observed native events are.
