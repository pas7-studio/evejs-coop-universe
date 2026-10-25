# Development doctrine — overlay engineering and upgrade safety

**Status: binding for all coding agents and human contributors (2026-10-25).**
Task: `COOP-023`. This document is the single source of truth for *how* the
co-op overlay is allowed to change the pinned EveJS server. It does not replace
gameplay acceptance ([GAMEPLAY_TESTING.md](GAMEPLAY_TESTING.md)) or provenance
rules ([UPSTREAM.md](UPSTREAM.md)); it constrains the engineering that feeds
them.

If a rule here blocks an urgent fix, change the rule in this document in the
same commit — do not work around it silently.

## 1. Layer model and ownership

| Layer | Location | Owner | Rule |
| --- | --- | --- | --- |
| L0 upstream EveJS | `C:\Games\EveCoop\upstream-evejs` (Docker `evejs-local`) | upstream | Never forked, never committed here, never hand-edited |
| L1 native hooks | 22 insertions in 9 upstream files | this repo | ≤1 statement per insertion, env-gated, default OFF |
| L2 integration modules | `integration/*.cjs` → `server/src/space/*.js` | this repo | repo copy is the only truth |
| L3 tooling | `scripts/` (installer, deploy, verify) | this repo | read-only unless a named action mutates |
| L4 evidence + docs | `docs/`, `docs/evidence/`, `test-results/` | this repo | no claim without evidence |

The server foundation is **L0**. Everything this project writes lives in L1–L4.
A repo that contains no upstream source is the intended state, not an omission.

## 2. Decision: overlay, not fork (D1)

We keep upstream byte-identical and apply a transactional overlay
(`scripts/patch-evejs-coop.cjs`) because:

- a fork pays the same re-anchoring cost on every upstream release, but also
  loses `git pull`, upstream issue reporting and PR contribution;
- 59 modules are *new files*, only 22 statements touch upstream — the blast
  radius of a release is small and enumerable;
- the installer refuses unknown revisions and rolls back on failure, so a
  mismatch is loud instead of corrupting the world.

**Revisit this decision** if any of these become true:

1. upstream adds real extension points (event bus, NPC behaviour registry,
   plugin loader) — then L1 shrinks to zero and we adopt them;
2. one release needs more than 5 files re-anchored — then evaluate a tracked
   fork branch with a rebase runbook;
3. more than ~40 anchors exist — anchor churn becomes the dominant cost.

Until then: no fork, no vendored upstream source, no in-place upstream commits.

## 3. Rules for touching upstream (L1)

- **R1** Never edit the deployed tree by hand. `--check` exists to catch exactly
  that; a hand fix is a future silent overwrite.
- **R2** An insertion is one statement: `require("...").hook(...)` or a guarded
  `if (env) ...`. No multi-line logic, no local variables, no control-flow
  rewriting. Logic belongs in L2 where it can be tested.
- **R3** Every hook is gated by `process.env.EVEJS_COOP_*` and defaults **OFF**.
  A feature that changes player-visible behaviour is enabled only after the
  corresponding gameplay gate passed.
- **R4** Observational hooks must never throw into upstream control flow. Blocking
  hooks (loot quarantine, fleet trade safety, warp safety) must fail closed with
  an explicit error string and have a unit test for the blocked path.
- **R5** Anchor choice: the smallest *unique* statement that expresses intent;
  prefer a stable call or assignment over formatting-sensitive lines; never
  anchor inside generated/minified or one-line bodies.
- **R6** Adding a hook requires all five: `specs` entry, L2 module, unit test,
  `--dry-run` output, and roundtrip evidence from
  `tests/coop-crossstream-overlay-roundtrip.test.mjs`.
- **R7** No upstream behavioural change outside the co-op gate: no silent market,
  wallet, standings or SDE mutation, no economy rewrites to make a test pass.
- **R8** No new dependency in the upstream tree and none in this repo — Node
  builtins only. Dependency upgrades are a separate security track, never a
  gameplay fix.
- **R9** Large artifacts go to `O:\AI` or `O:\tmp`, never to `C:`.
- **R10** Never delete, reinitialise or rewrite the `evejs-data` volume to make a
  check pass. Recovery is diagnosed, not reset.

## 4. Rules for integration modules (L2)

- **M1** Modules export functions; top-level side effects are forbidden except
  env-guarded lazy timers.
- **M2** Fail closed on ambiguity: an unclear native/RPC result halts that NPC or
  action. Never retry a possibly completed fill, jump or transfer.
- **M3** Never fabricate evidence. No synthetic activity events, no "PASS" from a
  unit test, no inferred killer identity.
- **M4** Restart safety first: durable state lives in native stores; journals are
  recovered before identity links are pruned; corrupt durable records halt with
  `NEEDS_OPERATOR_REPAIR`.
- **M5** The repo copy is the only truth. Deployment copies files; `--check`
  reports `STALE` when a deployed module differs.
- **M6** Each module has `tests/coop-<topic>.test.mjs`. A module without a test is
  not mergeable.
- **M7** Modules do not reach into each other's private state; they compose through
  exported functions or native stores.
- **M8** Destruction attribution comes only from the explicit
  `options.attackerEntity`. No correlation, no last-target guessing.

## 5. Upgrading to a new upstream SHA (runbook)

Do this on a throwaway worktree, never on the running world.

1. Record the current pin and status: `git -C <upstream> rev-parse HEAD`.
2. Fetch the new revision into a **separate** checkout; leave the live tree alone.
3. `node scripts/patch-evejs-coop.cjs --code-path <new>/Code --dry-run`
   → the expected outcome is `Refusing incompatible EveJS version`. That refusal
   is the safety feature working, not an obstacle.
4. Change `PIN` in the installer **and** add the old→new row to
   [UPSTREAM.md](UPSTREAM.md) in the same commit.
5. Re-run `--dry-run`. Every `Unknown or duplicate source anchor` is a manual
   re-anchor: apply R5, keep the diff minimal, note the reason in the commit.
6. Run the roundtrip test against the new tree:
   `EVEJS_COOP_CODE_PATH=<new>/Code node --test tests/coop-crossstream-overlay-roundtrip.test.mjs`
7. `node scripts/patch-evejs-coop.cjs --check --code-path <deployed>/Code` must
   report `OVERLAY_OK` before any deployment.
8. Backend verifier only ([VERIFY_BACKEND_ONE_COMMAND.md](VERIFY_BACKEND_ONE_COMMAND.md)).
   It is not gameplay proof.
9. Deploy only with owner approval, then follow
   [GAMEPLAY_TESTING.md](GAMEPLAY_TESTING.md) from Phase 1.
10. Rollback = `--remove` or restore the tree from git. Both are byte-exact; use
    them instead of manual editing.

## 6. Drift detection

`node scripts/patch-evejs-coop.cjs --check --code-path <EveJS/Code>` is
read-only and prints:

- `PRISTINE` / `PATCHED` / `MISSING` / `DRIFTED` / `ANCHOR_MISMATCH` per native file;
- `CURRENT` / `STALE` / `MISSING` per overlay module;
- `OVERLAY_OK` only when the SHA matches the pin and nothing is drifted.

Run it before every deployment, after any manual investigation of the container,
and as the first step of any bug report about "the fix did not work".

## 6a. Regression baseline (no CI, so noise must be explicit)

`node scripts/coop-test-baseline.cjs` runs every local `tests/*.test.mjs` file
separately and compares failing test names against
`docs/evidence/test-baseline.json`. `--record` rewrites the baseline;
`--include-upstream` adds the isolated `upstream-*` contracts (they need
`EVEJS_COOP_CODE_PATH`). Exit code 1 means a **new** failure.

Recorded 2026-10-25: 78 files, 518 pass, 0 fail, 16 skipped. A baseline with
known failures is a baseline nobody reads; keep it empty or explain every entry
in the commit that adds it.

## 7. Anti-footgun list

These are real ways this project can break itself. Each one has already been
possible at least once.

| Temptation | Why it hurts | Instead |
| --- | --- | --- |
| Hand-edit `server/src/space/*.js` in the container | next deploy overwrites it; drift invisible | edit `integration/*.cjs`, redeploy, `--check` |
| Write a multi-line anchor joined with `"\n"` | silently never matches a CRLF checkout (this really happened in `coop-player-damage-native-patch.cjs`, found by `--check` on 2026-10-25) | always derive `eol` from the source, as the other helpers do |
| Add a test file but not to the runner list | the old hand-written list meant a new test never ran (fixed 2026-10-25: the verifier now globs `tests/*.test.mjs`) | rely on the glob; never reintroduce a list |
| Duplicate the module list somewhere | two sources of truth, silent mismatch | one `names=[...]` array, guarded by a uniqueness test |
| Bypass the PIN by checking out upstream in place | destroys rollback and provenance | new throwaway worktree |
| Put the fix logic in the anchor line | untestable, unreviewable, breaks on refactor | one-call hook + L2 module + test |
| Enable a feature by default "because it works locally" | unverified gameplay becomes "supported" | keep `EVEJS_COOP_*=0` until the gate passed |
| Reset `evejs-data` or rebuild the market to get NPCs | destroys the world and the evidence | diagnose the first real blocker |
| `npm audit` / dependency bump as a gameplay fix | unrelated risk, no gameplay signal | separate security track |
| Kill processes/containers you did not start | this is a shared machine | ask the owner for the PID |
| Add GitHub Actions | owner prohibition | manual local runs with recorded evidence |
| Claim PASS from tests or TCP sockets | acceptance requires observed activity | follow the gate ladder |

## 8. Definition of done ladder

A change may only claim the highest rung it actually reached:

1. code + unit test;
2. `--dry-run` + roundtrip test green on the pinned tree;
3. deployed (owner-approved) and `OVERLAY_OK`;
4. server-native evidence (World / telemetry), no client;
5. one authorized client visually confirms;
6. two authenticated clients share the world.

Rungs 4–6 are evidence, not opinions. Documentation alone never advances a rung.

## 9. Decision log

- **D1** Overlay instead of fork — see §2, with explicit revisit triggers.
- **D2** One transactional installer, concern-specific transform helpers in
  `scripts/coop-*-patch.cjs`. Rationale: atomic rollback across all files.
- **D3** `.cjs` modules are deployed as `.js` into `server/src/space`. Accepted
  duplication, mitigated by `--check` reporting `STALE`.
- **D4** No CI and no remote automation (owner decision). Local runs only.
- **D5** Runtime monkey-patching/around-wrapping is *not* a second mechanism: it
  may only be introduced to *replace* an existing anchor, never alongside it.

## 10. Known debt and next steps

1. Inline one-liners that violate R2 remain in `tradeMgrService.js`,
   `beyonceService.js`, `agentMgrService.js`, `miningNpcOperations.js`. Convert
   them to one-call hooks, one file per commit.
2. Per-SHA anchor notes are not yet archived; after the first real upgrade,
   start `docs/evidence/overlay-<sha>.md` with the re-anchor diff.
3. Around-wrapping experiment (D5) is unstarted; it is the main lever that would
   make future refactors cheap.
4. `--check` is now a post-install gate in `Deploy-Coop-RuntimeProbe.ps1` and is
   printed by `Diagnose-LivingWorld.ps1`; the remaining gap is that it runs on
   the host checkout, not inside the built image.
5. `scripts/Verify-Local-Coop.ps1` now discovers `tests/*.test.mjs`; the
   `upstream-*` contracts still use the isolated runner by design.
6. Regression noise is explicit: `scripts/coop-test-baseline.cjs` compares
   against `docs/evidence/test-baseline.json` (0 local failures on 2026-10-25).
   Re-record it deliberately, never to hide a regression.
