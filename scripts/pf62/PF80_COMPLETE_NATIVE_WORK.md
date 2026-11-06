# PF80 — one local WORK review, both source-pinned native patches

**Review-only / feature OFF / PR #350 Draft.** This does not enable gameplay,
install server authorities, start an EVE process, modify PLAY, or merge code.
The original EveJS fork integration remains blocked by GitHub App HTTP 403;
this local tool is a review workaround, NOT a security/operational bypass.

## Problem closed

The original PF68 local script applied only PF62's native bundle. the historical PF74 review design
subsequently applied PF55's `coopNpcOrderArbiter.js` and `coopNpcOrderBridge.js`
patch separately. A local owner could therefore prepare an **incomplete** WORK
installation and incorrectly assume they had reviewed the same tree as CI.

PF79 also found a duplicate PF56 return adapter path in the archive module
inventory: 19 source entries but just 18 distinct modules, so the actual
native PF62 build would refuse duplicate names. After the correction, the
inventory is **18 modules plus 2 stock files = 20 PF62 paths**, plus **2 PF55
original arbiter/bridge paths = 22 actual changed native source files**.

PF80 `prepare_complete_native_work.py` first validates both source-specific
bundles against the same clean source-pinned original EveJS branch, then calls
the existing PF68 isolated-worktree assembler, applies the second PF55 patch
only in the already isolated WORK tree, checks the **exact 22-path Git status**,
verifies PF55 patched bytes against its original source transformer, executes
`node --check` and PF77's original-native arbiter/bridge test on WORK, and
produces `PF80-COMPLETE-WORK-REVIEW.json` with immutable source/hash evidence.
Python imports do not write `__pycache__` into either Git checkout.

## Run on Windows after syncing PR #350 and native EveJS source

From the **clean** orchestration checkout on
`docs/personal-fleet-contract-freeze-v1-4-20261104`:

```powershell
# 1. Read-only source preflight. No WORK worktree created.
.\scripts\pf62\Prepare-PF80-CompleteNativeWork.ps1 `
  -NativeCheckout 'C:\Games\EveCoop\upstream-evejs' `
  -ReviewOutput 'O:\tmp\PF80-review-01' `
  -WorktreeOutput 'O:\tmp\PF80-native-work-01'

# 2. Explicit isolated WORK application. Use FRESH paths.
.\scripts\pf62\Prepare-PF80-CompleteNativeWork.ps1 `
  -NativeCheckout 'C:\Games\EveCoop\upstream-evejs' `
  -ReviewOutput 'O:\tmp\PF80-review-02' `
  -WorktreeOutput 'O:\tmp\PF80-native-work-02' `
  -WorkBranch 'work/pf-native-review' `
  -ApplyToWork `
  -ConfirmWorkOnly 'WORK-NOT-PLAY'
```

Use Python 3.10+, Node 22+, Git and PowerShell. Four paths (source engine,
source orchestration, review, WORK output) may not overlap. The engine must be
a clean Git root on `coop/pas7std` with unchanged stock Git blobs. The
orchestration repo must be a clean Git root on the exact PR branch. All
`PLAY`/`PROD`/`production`/`deploy` path components and implicit patching are
rejected. Worktree branch must be new, review folder absent/empty and WORK
folder absent. No existing worktree is cleaned up on error; inspect it first.

## Evidence and limitations

- `PF62-MANIFEST.json`, `PF62-NATIVE-REVIEW.patch`, `PF55-NATIVE-OWNER.patch`
  and `PF80-COMPLETE-WORK-REVIEW.json` are in the separate review folder.
- The receipt must say `totalNativePaths: 22`, `featureEnabled: false`, and
  `pf77NativeArbiterGate: PASS` and `postTestNativeIntegrity: PASS` only when
  `-ApplyToWork` succeeded and the post-test re-attestation was clean.
- Native original tracked source remains clean; only the separate local WORK
  worktree and Git's worktree metadata can change.
- The synthetic Git acceptance has a real `git worktree add` + two `git apply`
  operations and PF77 subprocess. It is **not** a full real-source EveJS boot.
- The required next steps are still original bootstrap authority wiring,
  reciprocal writer fences, native stock ammo/docking/wages, complete WORK
  E2E with two authenticated clients and independent acceptance.

Direct script entrypoint: `python scripts/pf62/prepare_complete_native_work.py --help`.
Synthetic regression: `python -m unittest discover -s scripts/pf62/tests -p 'test_prepare_complete_native_work.py' -v`.

## PF81 — post-test source integrity (2026-11-06)

PF80 originally attested 22 source paths **before** running PF77. An apparently
successful Node test could then write a foreign file, corrupt either a PF62
or PF55 stock native source, or create an ignored file, while the combined
review receipt still claimed an accepted patch. PF81 reproduced all three
classes of false positive with real temporary Git worktrees.

After PF77 exits, the same exact 22-path Git inventory and SHA256 hashes are
checked **again**, against the hashes established **before** the Node test.
Ignored/untracked paths and symlinks also fail closed. Both original source
checkouts (native and orchestrator) must still be clean. Only then is
`postTestNativeIntegrity: PASS` written to the receipt; a failed post-test
check leaves the untrusted WORK tree for operator inspection and does not
return an accepted report.

The regression suite includes deliberately mutated PF55 and PF62 source files,
rogue untracked or ignored files, and modifications to the orchestration
checkout. This establishes the behavior of PF80's synthetic WORK harness, not
full native gameplay acceptance or an atomic fencing guarantee against an
external process changing the real WORK tree after the check returns.

## PF87 — atomic stock title + permit preflight (2026-11-07)

The Windows `Prepare-PF80-CompleteNativeWork.ps1 -ApplyToWork` wrapper runs
the PF87 original-title atomic contract regression (after PF85/PF86 and
before staging/applying any native WORK files). It verifies that a strict
source-bound PF58 handoff consumes the durable original permit and transfers
the **same original ItemStore title** under one GameStore
`BEGIN IMMEDIATE` transaction, including `characters` active-ship guards.
The legacy postcommit ItemStore move is disabled in source-bound mode.

The manual bare Python `prepare_complete_native_work.py` entrypoint **does
not** automatically run PF85/PF86/PF87 source gates; use the PowerShell wrapper
for the complete manual preflight. See
`scripts/pf58/docs/PF87_ATOMIC_ORIGINAL_TITLE_AND_PERMIT.md`.
This closes one transaction-boundary race, NOT the missing original player,
Mining, WAR and Exploration reciprocal writer gates or native WORK E2E.
No remote CI, main merge, PLAY start or Personal Fleet activation.

## PF88 — reciprocal native writer custody (2026-11-07)

The PF80 PowerShell `-ApplyToWork` preflight now runs the PF88 original
GameStore reciprocal-writer and source-bound fail-closed regressions
before generating a WORK review tree. The existing PF58 native permit
module already appears in the exact 22-path PF62 package, so its new
`createReciprocalWriterFence` export is staged automatically.

**This does NOT install the necessary hooks** in the original EveJS
`itemStore`, `characterState`, Mining, WAR or Exploration writers.
The source-bound bootstrap rejects activation without the separately
provided original writer hook witness. A read-only, source-pinned audit
of those six original domains is available at
`scripts/pf88/inspect-original-writer-hooks.cjs`, and never exits
successfully for activation. See the PF88 contract document.

## PF89 — actual stock item mutation delta preflight (2026-11-07)

The PF80 Windows `-ApplyToWork` preflight also runs the PF89 original
inventory before/after delta tests **before** applying any WORK review
patch. PF89 extends the PF58 native permit module already included in
the exact 22-file bundle; no extra native file or second installer is
introduced. The candidate bootstrap exports
`mutateForeignOriginalItemsWithinTransaction`, but the original
`itemStore.writeItems` and `characterState.writeCharacterRecord`
writer owners still need genuine fork commits to call the custody gateway
from their own SQLite transaction. This is NOT installed or activated
by the PF80 review builder.

See `scripts/pf89/PF89_ACTUAL_ORIGINAL_ITEMS_DELTA_GATE.md`.

## PF90 — original stock owner source gate (2026-11-07)

Before any `-ApplyToWork` review staging, the PowerShell preflight
runs 16 PF90 original owner snapshot tests and 8 original-source audit
tests. It executes the source-pinned original owner audit on the genuine
native checkout, requires all five known stock GameStore/ItemStore/
characterState source blobs/anchors to match and requires a
`BLOCKED_FOR_ACTIVATION` report with exit 2 and the original cache
alias risk. Unknown source drift blocks staging until independently
reviewed. A good source audit **does not install hooks or authorize
activation**: it confirms the exact *unmodified* original stock owner
is still unsafe for Personal Fleet. The WORK result remains review-only
with Personal Fleet OFF.

PF90 adds a detached owner snapshot policy in the existing PF58 native
module. Real original owner hooks still require reviewed commits in
`pas7-studio/EveJS`, preserving cache invalidation, original owner
repository, transfer/transaction semantics and client notifications.
Full spec: `scripts/pf90/PF90_ORIGINAL_STOCK_OWNERS.md`.

## PF91 original per-character row and player activation gate

The original `characterState` writes `characters/<characterID>`,
not synthetic `characters/characters`. PF91 corrects the PF87 strict
handoff's character scan within the **same** GameStore transaction.
PF80 `-ApplyToWork` runs nine corrected strict PF87 cases, 22 PF91
original-row/atomic-activation cases and four local original-source
pin tests before any review-only WORK output. The original source test
environment variable is safely restored afterwards.

The bundled PF58 permit module now also has a default-OFF player
activation candidate using real per-character rows, current/target
PF custody and source-bound native session checks. The *real* original
`characterState.activateShipForSession` is **not patched or
activated**. Do not claim acceptance until original engine owner hooks,
actual SQLite WORK testing and two-client gameplay are complete.
See `scripts/pf91/PF91_ORIGINAL_CHARACTER_ROWS_AND_ATOMIC_PLAYER_SWITCH.md`.

## PF92 source-bound generic character writer before WORK review

Original EveJS `characterState.writeCharacterRecord()` is called not
only by player ship switching, but also by generic record updates,
active ship repair and normalization. PF92 extends the already-bundled
PF58 native permit authority to check any sensitive original character
field change in one SQLite owner transaction and leaves wallet/skill
writes unchanged only if their original before-image is still current.
An independent native session witness is required for ship identity
changes, and bootstrap exposure is guarded by feature enabled plus
verified original writer hook evidence. The manual PF80 WORK staging
preflight includes PF92 candidate SQLite tests and source-pinned
original paths. The real engine owner hook is **not** installed;
activation remains blocked. See
`scripts/pf92/PF92_ORIGINAL_CHARACTER_GENERIC_WRITE_FENCE.md`.
