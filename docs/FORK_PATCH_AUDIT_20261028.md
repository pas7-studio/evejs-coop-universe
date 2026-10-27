# Fork audit: how much of the engine is still a "patch"?

Date 2026-10-28. First audit after the engine became our own fork
(`pas7-studio/EveJS`, `coop/pas7std`, see [DEVELOPMENT_DOCTRINE.md](DEVELOPMENT_DOCTRINE.md) §2).
The question was: *where do we still have patches, and can they be extracted
into reusable server modules?*

Reproduce everything with:

```bash
node scripts/coop-engine-audit.cjs            # prints AUDIT_OK / AUDIT_REGRESSION
node scripts/coop-engine-audit.cjs --json     # full per-file list
```

## Measured state (2026-10-28, before the extraction below)

| Metric | Value |
|---|---|
| Co-op modules in the engine (`server/src/space/coop*.js`) | **392 files, 71 453 lines** |
| Stock EveJS files that mention the co-op layer at all | **56 files** |
| Co-op code inside those stock files | **430 lines, ≈81 000 chars** |
| Monkey patching (`prototype` reassignment, `defineProperty`) | **0** |
| `require.cache` / `Module._load` / self-source rewriting | **0** |
| Largest stock surface | `corporation/allianceRegistryRuntime.js` — 24 identical one-liners, 16 450 chars |
| Legacy `*patch*.cjs` transforms in this repo | **78** (all still referenced: 45 importers + tests) |
| `integration/*.cjs` vs the deployed file | 390 copies, **0 differing** |

Conclusion: **the features are already modules.** The patch-shaped debt is not
a pile of injected logic in the server; it is (a) a few stock files where one
rule was pasted per call site, and (b) the legacy transform library in this
repository, which after the fork import is only needed for history and for
proposing upstream.

## Extraction case study: native alliance authority

`allianceRegistryRuntime.js` guarded 24 alliance mutation RPCs with 24 copies of
the same 685-char statement. Now:

- engine module `server/src/space/coopStructureAllianceGuard.js` — one binder,
  no `require()` of its own, injected `admit`/`readers`/`deny`;
- one lazy binder per native file (`EVEJS_COOP_STRUCTURE_ALLIANCE_GUARD`, default
  OFF: with the flag off no module is even loaded);
- 24 call sites reduced to `coopAllianceGuard.enforce("<Action>", session, args);`.

| | Lines | Chars |
|---|---|---|
| Before | 24 | 16 450 |
| After | 27 (24 calls + binder) | 1 707 |

Tests: `tests/coop-structure-alliance-guard-module.test.mjs` (flag off = no
`admit`/`readers` call; deny path raises `CrpAccessDenied`; allow path forwards
action/session/args; construction validates its inputs).
The legacy `coop-structure-alliance-guard-patch.cjs` no longer matches the
engine anchor — expected, it is a **historical** transform now.

## Rules that keep this from rotting

The audit tool enforces budgets (`BUDGET` in `scripts/coop-engine-audit.cjs`):

- stock files touched ≤ 70, co-op lines ≤ 700, co-op chars ≤ 67 000;
- one stock file ≤ 15 000 chars — above that, extraction is mandatory;
- runtime patching (monkey patches / require-cache / source rewrite) = **0**;
- legacy patch scripts ≤ 78 — **may only shrink**, a new patcher fails the audit;
- `integration/*.cjs` must equal the deployed copy (`0` drift).

Raising a budget is a decision to write down here, not a side effect of a commit.

## Next extraction candidates (measured, in order)

1. `services/market/marketProxyService.js` — 81 co-op lines, 41 hook calls, 14 143 chars.
2. `services/mining/miningNpcOperations.js` — 78 lines, 41 hook calls, 10 379 chars.
3. `space/npc/nativeNpcWreckService.js` — 27 lines, 8 hook calls, 4 430 chars.
4. `services/map/fwWarzoneSolarsystemService.js` — 3 lines but 3 725 chars: the
   same "one pasted statement" smell as the alliance guard.

## Giga files: split, do not let them grow

One file with thousands of lines in a single scope cannot be tested in
isolation and every edit risks hidden coupling. Engine files above ~1 000 lines
must be split by responsibility; the tool does the mechanical part and refuses
to write anything it cannot verify:

```bash
# dry run: which declarations touch no module state and can move?
node scripts/coop-split-module.cjs --file space/coopVirtualWorldRuntime.js
# apply: write the slice, rewrite the parent, require it back, node --check both
node scripts/coop-split-module.cjs --file <rel> --out <rel> --apply
```

Rules the tool enforces: only declarations that reference **no** mutable module
state (`let`/`var`) and no non-movable sibling move; the parent keeps a
destructuring `require`, so exports and call sites never change; a failed
`node --check` restores the original file.

Current state of the giant modules:

| File | Lines | Split |
|---|---|---|
| `space/coopVirtualWorldRuntime.js` | 5 330 | **blocked** — see below |
| `space/coopAdminBridge.js` | 1 518 | not started |
| `space/coopNativeStationArrival.js` | 1 451 | not started |
| `space/coopCourierRuntime.js` | 975 | not started |

### Attempted split of `coopVirtualWorldRuntime.js` (reverted)

The tool found a clean, state-free slice: 55 declarations, 911 lines (distance
and belt summaries, NPC module summary, raid leash, PVE wave helpers, sale
notes, war presence math) → `space/coopVirtualWorldPure.js`, parent 4 419 lines.
Behaviour was verified: the engine still exported the **same 21 names**, and the
26 test files referencing the runtime reported **188 pass / 20 fail both before
and after** the change.

It was reverted anyway, because **10 tests assert on the *text* of
`integration/coopVirtualWorldRuntime.cjs`** (`read("integration/…")` +
`assert.match`). Once the archived copy is refreshed, those assertions look for
code that legitimately moved. The split is therefore blocked on a test
migration, not on the tool:

1. read `runtime + pure` together in the text-assertion helpers;
2. re-run the 26 files and require the same 20 pre-existing failures only;
3. then re-apply `--apply` and refresh the archived copies.

Do not "fix" this by freezing the archived copy at the old text: an archive that
disagrees with the engine is worse than a big file.

## Performance traps: look for them statically, then prove with a profile

`node scripts/coop-perf-audit.cjs` ranks co-op modules by shapes that are cheap
once and catastrophic per tick: deep clones at call time, `readFileSync` inside
a function, `sort()`/quadratic `filter().find()` in a tick phase, `require()`
inside hot bodies, `JSON.stringify` cache keys. It fails with
`PERF_REGRESSION` when a class grows past its budget (budgets are freezes, so
raise one only together with a measurement in this file).

Measured win (`engine ca94bf5`): `advanceNativeSalvageRivals` re-read and
re-parsed every witness manifest on **every tick**, and
`confirmedNativeNpcWreck` re-parsed the whole identity registry per wreck. Both
now use the shared `space/coopJsonFileCache.js` (mtime+size key, no TTL, no
watcher, `clone: true` for mutating callers): **80 000 reads 1950 ms → 390 ms**.

Traps that are *not* worth fixing and must not be "optimised" blindly:
`require()` inside a function body (Node caches resolution; 600 edits in a hot
file for microseconds is a net loss) and `JSON.stringify` over a 3-element array
of skip reasons.

Next candidates, in measured order, each needing a live CPU profile before a
change: `space/runtime.js` (95 unbounded `push`, 21 `sort`),
`services/dungeon/dungeonUniverseRuntime.js` (25 `sort`, 8 `JSON.stringify`
cache keys), `services/inventory/invBrokerService.js` (quadratic scans).
Profiling runs on the agent stack only: `compose.agents.yaml` already sets
`NODE_OPTIONS=--cpu-prof --cpu-prof-dir=/var/lib/evejs/prof`; never profile the
owner's play stack.

## Why the 78 legacy transforms were not deleted

They are imported by 45 scripts/tests (`coop-state.cjs`, `coop-test-baseline.cjs`,
`Run-Pve-Native-Gates.cjs`, the per-feature contract tests). Deleting them would
delete working tests, not debt. They are **frozen**: no new one may be added,
and every new engine change is a module + a commit in the fork.
