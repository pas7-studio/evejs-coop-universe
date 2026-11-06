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
- Stages **17** distinct PF-52–66 `.js` modules in the native `space/`
  directory structure without changing original wallet, ItemStore or GameStore.
  The most recent PF-58 implementation of `OriginalDeployment` is chosen.
- Rewrites archive-relative `.cjs` imports to genuine local `.js` imports,
  including the PF-61 → PF-60 dependency. Refuses missing sibling modules.
- Writes **one complete Git review diff containing BOTH original stock changes AND
  all 17 newly added modules** (19 file paths total), full staged files and an
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
PF66 module and source patch **in one 19-file review-only bundle**. A new
four-way composition test checks exact PF58/PF59/PF61/PF66 anchors.

Isolated PF66 evidence: 27/27 Node PASS (including 2 Linux SIGKILL plus eight
VM tests of the injected native source) and 6/6 Python PASS. The updated PF62
14-test suite and the actual native fork checkout have not been executed here.
This does NOT resolve real station dwell, original writer exclusivity, game
client integration, or native release approval; keep feature OFF and PR Draft.
