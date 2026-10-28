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
`node --check` restores the original file; `--out` must stay in the parent's
directory; the `require()` back into the parent is inserted where the first
extracted declaration was, so a moved `const` is initialised before the parent
reads it.

`scripts/coop-engine-audit.cjs` keeps this from rotting: any co-op module above
2 000 lines that is not on the frozen list fails with `AUDIT_REGRESSION`, and a
frozen one may only shrink. The ratchet is what stops the next 5 000-line file
from appearing.

Current state of the giant modules:

| File | Lines | Split |
|---|---|---|
| `space/coopVirtualWorldRuntime.js` | 4 379 | **unsafe as done** — 56 declarations moved to `coopVirtualWorldRuntime.pure.js`, but 23 state names ended up declared in both modules; repair in progress in the engine |
| `space/coopAdminBridge.js` | 451 | **done** — the whitelisted actions in `coopAdminBridgeActions.js` (1 067 lines) |
| `space/coopNativeStationArrival.js` | 1 451 | not started |
| `space/coopCourierRuntime.js` | 975 | **not a split** — 956 of its 975 lines are already one closure factory; moving them would be a rename, not a separation |

### The runtime split, and the test migration that unblocked it

`space/coopVirtualWorldRuntime.js` went from 5 349 to 4 379 lines: 56
declarations (970 lines) moved into `space/coopVirtualWorldRuntime.pure.js` -
distance and belt summaries, NPC module summary, raid leash, PVE wave helpers,
sale notes, war presence math, the headless retry policy, the salvage/wreck
witnesses. The parent destructures them back, so the runtime still exports the
**same 21 names**.

**This split was not safe, and the cost was real.** The splitter decided what
could move by looking for names declared with `let`/`var` - but it only read the
**first** name of a multi-declarator line. The parent declares its state as
`let world=null,bridge=null,...,warpPointDirector=null;`, so `bridge`,
`warpPointDirector` and a dozen relatives looked like free variables. Their code
moved, and on the live stack each phase that used one threw
`ReferenceError: warpPointDirector is not defined` the moment it ran - no crash at
load, no `node --check` complaint, no failing test. The faction war stopped
advancing, and an attempted recovery (restoring the pre-split single file) then
reset a live war state row. Repair is still in progress in the engine: 23 names are
declared in both modules and kept equal by a `bindWarRuntime()` call, which is two
copies of one state, not a clean split.

Two tools now make that class impossible:

- `scripts/coop-split-check.cjs` reads both modules and reports `UNDECLARED` (a
  name the sibling uses and never declares - the ReferenceError class),
  `COUPLING` (a name only the parent declares), `UNBOUND_STATE` (the name exists
  in both modules, the parent assigns its own copy, and no `bind*()` call hands
  the live object over - a stale copy by construction) and `TWO_STATES` (the same
  name declared in both modules). A `DEAD_STATE` note covers the harmless variant
  where the parent declares the name and never assigns it, so only the sibling's
  copy is live (that is `warFleetRegistry` today). `coop-engine-audit.cjs` runs
  it: `UNDECLARED`, `COUPLING` and `UNBOUND_STATE` are hard failures, and
  `TWO_STATES` is a ratchet with a ceiling that may only be lowered.
- `scripts/coop-split-module.cjs` now reads every declarator of every
  declaration, and after `--apply` it runs the checker and **restores both files**
  if the split is not safe. `node --check` cannot replace that: it cannot see a
  name that only fails when the line runs.

Both share `scripts/lib/js-declarations.cjs`, a small lexer (comments, strings and
regex literals stripped; all declarators, parameters, method-definition params,
destructuring and catch bindings collected). `tests/coop-split-tooling.test.mjs`
pins the behaviour, including the `actionID -> actionI` regex-backtracking bug
that made every long identifier look like a free variable.

**Reproduced against the real broken commit.** Extracting `eec175f` into a temp
tree and running the checker prints 23 `COUPLING` names - `bridge`, `economy`,
`identityRegistry`, `raidDirector`, `warpPointDirector`, `warFleetRegistry` and
their relatives - i.e. exactly the state that made those phases throw
`ReferenceError` in the live world. The same check on the repaired tree reports
0 hard findings and 23 `TWO_STATES`, which is the honest description of the
current design: the split still keeps two copies of that state in step through
`syncWarRuntime()`/`bindWarRuntime()`.

What actually blocked the first attempt was not the code but 10 wiring tests
asserting on the *text* of `integration/coopVirtualWorldRuntime.cjs`: after the
archive was refreshed, they looked for code that had legitimately moved. The fix
is the reusable helper `tests/_support/coopSourceText.mjs`:

- `readModuleText(rel)` inlines **only** split siblings (`*.pure.js`, and the
  archived `.cjs`/shim equivalents) in place of their `require()` call, so text
  assertions and slices keep working after code moves and a later split cannot
  silently hide an assertion. One caveat by design: a split sibling appears where
  the parent requires it (near the top), not at each original position, so use
  `functionText` rather than hand-written "next declaration" ranges. Nothing else
  is inlined - a test that reads `scripts/overlay-spec.cjs` must still see that
  file alone, or a `doesNotMatch` would trip over an imported copy of the same
  string.
- `functionText(text, signature)` returns one top-level function from its
  signature to its closing brace, replacing hand-written
  `indexOf(nextFunction)` slices that break as soon as the *next* function moves.
- `{depth: 0}` means "this exact file", for tests that execute an extracted
  function body in a sandbox.

Verified after the split: the 26 test files referencing the runtime report
**187 pass / 21 fail**, and the 21 are the pre-existing failures that also fail on
the unchanged tree (overlay-spec and other sessions' work); one baseline failure
(`the diagnostic is exported from the world runtime`) now asserts the real
`require()`d export object instead of the text of an export list, and passes.
The gates stay green: `AUDIT_OK`, `PERF_OK`.

Two rules learned here, both cheap to forget:

1. A split sibling is a **deployed module**: it must be registered next to its
   parent in `scripts/overlay-spec.cjs` `names`, or the legacy installer copies
   the parent without the file it requires.
2. `--out` must stay in the **same directory** as the parent. The splitter moves
   bodies that contain relative `require()` calls; a subdirectory would silently
   change what they resolve to. The tool now refuses a different directory.

And one the splitter had to be fixed for: the `require()` back into the parent is
inserted **where the first extracted declaration was**, not at the top of the
file. Moving a `const` config value (`REQUESTS`, `RESULTS`) to the top broke
`coopAdminBridge.js` at load with `Cannot access 'REQUESTS' before
initialization`, because `module.exports` at the bottom read it before the
destructuring ran. `node --check` cannot catch that; the split of the admin bridge
was reverted and re-applied after the fix.

Do not "fix" a broken text assertion by freezing the archived copy at the old
text: an archive that disagrees with the engine is worse than a big file.


## Tests that still speak to the pinned checkout

Since D1 ("we own the fork") `C:\Games\EveCoop\upstream-evejs` is our branch
`coop/pas7std`, not `c3ea396`. A large part of the suite still asks about the
*pinned* tree through the legacy installer: 164 of 659 test files reference
`scripts/patch-evejs-coop.cjs`, `scripts/overlay-spec.cjs` or `PIN`, and 93 of
them classify source files as `PRISTINE`/`PATCHED`/`DRIFTED`. On this machine they
fail with answers like:

```
EX03B18_PINNED_WRECK_SOURCE_DRIFT:server/src/space/npc/nativeNpcWreckService.js
```

That is a correct answer to a question that no longer describes the deployment:
the file really is not the pinned one, because we changed it on purpose and
committed the change in the fork.

**How to read a red suite right now**

1. Gate: `node scripts/coop-engine-audit.cjs` → `AUDIT_OK` and
   `node scripts/coop-perf-audit.cjs` → `PERF_OK`. These measure *our* burden.
2. Parity: run exactly the files a change touches and compare with the same run
   before the change (that is how both splits today were accepted: 187/21 before
   and after, every failure pre-existing).
3. Everything else that fails on `_DRIFT`, "pinned", "installed by the overlay" or
   "installer contains no duplicate" is describing the pin, not the game.

`docs/evidence/test-baseline.json` was recorded on 2026-10-25 (82 files, 538 pass,
0 fail) against the pinned checkout, so `scripts/coop-test-baseline.cjs` currently
reports hundreds of "new failures" that are all pin drift. It cannot be used as a
regression gate again until it is re-recorded — and re-recording is an owner
decision, because it freezes whatever is red today, including other sessions'
unfinished work.

Measured on 2026-10-28 (`node --test "tests/*.test.mjs"`): **6 174 cases, 5 543
pass, 541 fail, 90 skip**. Of the 541 failures 109 name the pin, the overlay, the
installer or a source hash directly; the rest are the native/SQLite cases that
need the deployed modules and the containers those tests were written against.
None of them is a newly broken co-op unit.

The working gate for a change is therefore scoped:
`scripts/coop-test-parity.cjs` stores the *names* of the failing cases for the
files a change touches (`--files a,b,c --record`) and fails on any case that
passed in the snapshot and fails now, so a fix and a new break cannot cancel out:

```bash
node scripts/coop-test-parity.cjs --files coop-npc-probe-wiring,loop-verdict --record
node scripts/coop-test-parity.cjs            # re-check every recorded file
```

Porting the 164 files is a separate, mechanical job: point the source assertions
at the fork's own files (drop the hash equality), keep every behavioural case, and
retire only the tests that prove the *transform* is reversible — the fork does not
need a transform.

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
