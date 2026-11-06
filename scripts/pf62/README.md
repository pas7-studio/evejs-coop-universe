# PF-62 — Personal Fleet native composition and local handoff

**Status: REVIEW CANDIDATE ONLY. Personal Fleet is OFF. Do not merge PR #350 as gameplay-complete or touch PLAY.**

PF-52 through PF-66 provide reference implementations, isolated SQLite tests and
source-pinned patches. They are **not** installed into the real EveJS fork. PF-58,
PF-59, PF-61 and PF-66 overlap the two original native source files; applying their three
patches independently would be unsafe. Their archived modules also rely on
`.cjs` imports, while the native hooks resolve `.js` by default. PF-61 has an
archive-relative PF-60 import that cannot work when placed in the native fork.

PF-62 provides **one reviewed composition pipeline** instead of another patch
that must be applied manually:

- Pins the unmodified original Git blobs of `npc/nativeNpcService.js` and
  `npc/nativeNpcStore.js`, checks the original PF-58/59/61/66 builder pin agreement
  and refuses mismatched source.
- Composes PF-58 then PF-59 then PF-66 into **one** `nativeNpcService.js`, and PF-59
  then PF-61 into **one** `nativeNpcStore.js`.
- Stages **18** distinct PF-52–78 `.js` modules in the native `space/`
  directory structure without changing original wallet, ItemStore or GameStore.
  The most recent PF-58 implementation of `OriginalDeployment` is chosen.
- Rewrites archive-relative `.cjs` imports to genuine local `.js` imports,
  including the PF-61 → PF-60 dependency. Refuses missing sibling modules.
- Writes **one complete Git review diff containing BOTH original stock changes AND
  all 18 newly added modules** (20 file paths total), full staged files and an
  SHA256 manifest in a separate **empty output directory**. Rejects a pre-existing
  module path rather than silently overwriting it.
- Before creating output, runs `git apply --check` against the real native
  checkout (read-only) and actually applies the **same patch to a disposable
  temporary source-only tree**; compares every resulting file with the staged
  bytes. Never applies to the actual EveJS checkout. No startup, Docker, CI,
  source write, or feature flag change.
- Runs `node --check` on the two composed stock files and all staged modules.

This does **not** wire native original player authorization, real agent offers,
ship custody arbitration, startup exclusivity, native payroll callbacks, stock
ammunition, command ingress or actual docking. All source-specific writers
still need reciprocal fencing. The staged modules cannot be enabled from a
flag alone; the production composition root must be installed in the *engine
fork* with real original authorities, followed by WORK gameplay acceptance.

## PF79/PF80 complete native WORK preflight

PF79 corrected an accidentally duplicated `coopPersonalFleetNativeReturnExecutor.cjs`
entry; PF62 now stages **18 distinct modules plus two original stock files**,
not 19 modules. Source inventory and local module dependencies fail closed
before network/WORK activity. With the separate source-pinned PF55 arbiter and
bridge updates, the complete review covers **22 native source paths**.

**Preferred full native review:** `Prepare-PF80-CompleteNativeWork.ps1` uses both exact source-pinned patches in one isolated *local* WORK worktree and
runs PF77 against the patched original native bridge. Remote GitHub Actions
are prohibited by `AGENTS.md`; see `PF83_RETURN_SOURCE_AND_MANUAL_GATE.md`. See
`PF80_COMPLETE_NATIVE_WORK.md`. Legacy PF68 prepares only PF62's 20-path
portion; it is not a complete original-command integration.

## Safe local checks (PowerShell 5.1+ / Node 22+ / Python 3.10+)

From the checked-out **PR #350 branch**, run:

```powershell
.\scripts\pf62\Test-PF62-Local.ps1
```

To generate the **read-only native review bundle**, with the fork checked out
separately at `C:\Games\EveCoop\upstream-evejs`:

```powershell
.\scripts\pf62\Test-PF62-Local.ps1 `
  -NativeCheckout 'C:\Games\EveCoop\upstream-evejs' `
  -ReviewOutput 'O:\tmp\PF62-review'
```

The output path must be empty (or absent) and MUST be outside both checkouts.
The engine must match both pinned original blobs. If it has drifted, the command
fails: **do not force the patch**. Linux/WSL tests also include real SQLite
`SIGKILL` scenarios in PF-60; the Windows runner intentionally omits these.

Manual Python equivalent:

```bash
python3 -m unittest discover -s scripts/pf62/tests -p 'test_*.py' -v
python3 scripts/pf62/build_native_review_bundle.py \
  --engine /path/to/EveJS --repo /path/to/evejs-coop-universe \
  --output /tmp/PF62-review
```

## Remaining release gates (mandatory)

1. Obtain GitHub **Contents: Read and write** on `pas7-studio/EveJS` to commit
   a focused, reviewed native change to a new branch. Current action returns
   HTTP 403; `evejs-coop-universe` write permission is **not enough**.
2. Bind original GameStore, ItemStore, player sessions, actual paid NPC offers,
   salary/wallet and authoritative native ship/controller writers in one
   production bootstrap. No mocks, environment-only approvals or stubs.
3. Re-run native source/cross-writer audits, all manual tests and crash
   reconciliation against an actual isolated **WORK** stack and *real* original
   SQLite, not only fixture DBs. Never bypass PF-42 fleet exclusion.
4. Observe an authorized EVE client hiring, assigning an original ship,
   following/warping, using real stock ammo, docking, dismissing, paying wages,
   and recovering a native ship loss without an inventory/ISK duplicate.
5. Prove two independently authenticated clients see one shared NPC fleet and
   cannot control/destroy each other's original ships. Only then separately
   review any activation/merge; **no automatic PLAY restart**.

Original PF-62 baseline evidence: **8/8 Python PASS** on Python 3.13 /
Node 22.16 in synthetic native fixtures (including actual PF-59/PF-61
transforms, staged Node compile and dry-run Git apply). Real full EveJS source
transform and WORK/PLAY E2E have **NOT RUN** on this machine.

## PF-63 safety correction (2026-11-06)

The original PF-62 diff contained only the two stock edits. That was unsafe:
applying the patch could leave all 16 required modules absent. PF-63 corrects
that incomplete package without installing or activating gameplay. The
two-stock + sixteen-added review patch is checked in a throwaway Git repository
for byte-perfect roundtrip. Additional negative tests reject missing terminal
newlines, duplicate paths, output directories that contain the engine tree and
native module filename collisions. Four historical .cjs files without a final
newline are normalized in staging only. See `PF63_INTEGRATION_SAFETY.md`.

Combined isolated PF-59–61 Node regression 59/59 PASS; PF-62+63 Python
composition regression 13/13 PASS. This **does not prove original engine / WORK**.

## PF-66 scoped scene dock composition (2026-11-06)

PF-56's sessionless DOCK_ISSUING previously had no PF59-approved way to
remove the original physical NPC actor before PF60 prepare. PF-66 adds a
separate, source-pinned, durable-once docking bridge: original stock ItemStore
station dock + an original nativeNpcService capability-bound scene detach,
without touching native persisted entity/controller rows (PF61 later removes
those under its separate one-shot custody). The PF62 composer now stages the
PF66 module and source patch **in one historical 19-file review-only bundle**. A new
four-way composition test checks exact PF58/PF59/PF61/PF66 anchors.

Isolated PF66 evidence: 27/27 Node PASS (including 2 Linux SIGKILL plus eight
VM tests of the injected native source) and 6/6 Python PASS. The updated PF62
14-test suite and the actual native fork checkout have not been executed here.
This does NOT resolve real station dwell, original writer exclusivity, game
client integration, or native release approval; keep feature OFF and PR Draft.

## PF87 original title / permit atomicity (2026-11-07)

The PF80 PowerShell `-ApplyToWork` entrypoint now runs PF87 regressions before
generating the native WORK tree. The strict source-bound PF58 adapter moves
the existing ship title under the exact GameStore SQLite transaction that
consumes the one-shot permit, with durable character active-ship checks.
The generic reference bootstrap remains legacy for its previous fixture
contracts; only the source-bound bootstrap forces atomic mode.
Full original engine WORK boot and reciprocal player/NPC writer fences
remain outstanding; see `PF80_COMPLETE_NATIVE_WORK.md` and the PF87
documentation. Personal Fleet stays OFF, no remote CI.

## PF88 reciprocal writer gate (2026-11-07)

The candidate PF58 source bundle includes a new same-transaction
`createReciprocalWriterFence` for all original player/Mining/WAR/
Exploration foreign writers and strict default-deny source-bound bootstrap
until native hooks can be independently attested. The PF80 PowerShell
preflight adds PF88 regression tests, but it does not install those
original EveJS writer hooks. Original writer audit and 2-client
gameplay acceptance remain blocked; see
`scripts/pf88/PF88_RECIPROCAL_WRITER_CONTRACT.md`.

## PF89 actual stock inventory delta gate (2026-11-07)

The source-bundled original PF58 permit module gained the guarded
`mutateOriginalItemsInTransaction` API: it checks **all actual changed**
original item row IDs and module/cargo parent chains under the same
GameStore transaction. The manual PF80 preflight tests this API, but
original EveJS writer hook installation, ItemStore owner refactoring
and WORK gameplay remain blocked. Full PF89 contract:
`scripts/pf89/PF89_ACTUAL_ORIGINAL_ITEMS_DELTA_GATE.md`.

## PF90 original stock owner source gate (2026-11-07)

PF80 PowerShell WORK staging now executes PF90 original owner snapshot
regressions and a **read-only, source-pinned** hazard audit of original
ItemStore, characterState, GameStore and table ownership. This audit
returns `BLOCKED_FOR_ACTIVATION` (expected exit 2) even on the exact
historical source. The preflight may continue staging a review-only
WORK bundle with Personal Fleet OFF; it is *not* proof of original
single-writer integration. Source drift or missing files block review
pending independent re-attestation.
See `scripts/pf90/PF90_ORIGINAL_STOCK_OWNERS.md`.

## PF91 per-character native ownership (2026-11-07)

PF91 removes PF87's synthetic aggregate `characters/characters` read:
the original GameStore character owner persists per-character SQLite
keys. The PF58 native permit and PF87 handoff files already belong to
the existing PF62 source package; no second installer or extra
production native module is introduced. PF80 manual `-ApplyToWork`
preflight now runs both the corrected PF87, PF91 per-character fixture,
and four **source-pinned original characterState/itemStore tests**
against the genuine native checkout before WORK review staging.

These are candidate tests and schema corrections; actual original
player/Mining/WAR/Exploration source hooks are **not installed**,
and native WORK gameplay remains unproven. See the PF91 contract.

## PF92 generic owner write review gate (2026-11-07)

The existing PF58 native permit module now supports original generic
character record before/after protection. No second production module
or patch-installer has been added. Before any PF80 `-ApplyToWork` review
assembly, PowerShell runs 26 PF92 Node/SQLite fixture scenarios,
the PF88 disabled-sourcebound regression and four original
source-pinned owner route checks. All tests are manual, and a
good WORK *review* gate does not activate or install original EveJS
character owner hooks. See `scripts/pf92/PF92_ORIGINAL_CHARACTER_GENERIC_WRITE_FENCE.md`.
