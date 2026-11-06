# PF80 — one local WORK review, both source-pinned native patches

**Review-only / feature OFF / PR #350 Draft.** This does not enable gameplay,
install server authorities, start an EVE process, modify PLAY, or merge code.
The original EveJS fork integration remains blocked by GitHub App HTTP 403;
this local tool is a review workaround, NOT a security/operational bypass.

## Problem closed

The original PF68 local script applied only PF62's native bundle. PF74 CI
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
  `pf77NativeArbiterGate: PASS` only when `-ApplyToWork` succeeded.
- Native original tracked source remains clean; only the separate local WORK
  worktree and Git's worktree metadata can change.
- The synthetic Git acceptance has a real `git worktree add` + two `git apply`
  operations and PF77 subprocess. It is **not** a full real-source EveJS boot.
- The required next steps are still original bootstrap authority wiring,
  reciprocal writer fences, native stock ammo/docking/wages, complete WORK
  E2E with two authenticated clients and independent acceptance.

Direct script entrypoint: `python scripts/pf62/prepare_complete_native_work.py --help`.
Synthetic regression: `python -m unittest discover -s scripts/pf62/tests -p 'test_prepare_complete_native_work.py' -v`.
