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

## Why the 78 legacy transforms were not deleted

They are imported by 45 scripts/tests (`coop-state.cjs`, `coop-test-baseline.cjs`,
`Run-Pve-Native-Gates.cjs`, the per-feature contract tests). Deleting them would
delete working tests, not debt. They are **frozen**: no new one may be added,
and every new engine change is a module + a commit in the fork.
