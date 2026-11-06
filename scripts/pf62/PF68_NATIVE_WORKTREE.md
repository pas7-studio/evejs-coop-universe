# PF-68 — optional owner-controlled native WORK worktree

**Status:** Tested local preparation utility, not a native game integration. The
Personal Fleet feature is **OFF**; no source is pushed, committed, merged,
started, deployed or enabled by this workflow. Never point this at PLAY.

## Purpose

GitHub App access to `pas7-studio/EveJS` currently fails with `403 Resource not
accessible by integration`. PF-68 allows a developer to validate PR #350's
**complete** original-source-pinned 20-file native patch *locally* and,
only with a separate explicit opt-in, apply that reviewed patch to a NEW local
Git WORK worktree. This does **not** install original server bootstrap
authorities or turn on game functionality.

The native source checkout must be the clean Git root on `coop/pas7std`, with
both original stock source blobs matching PF62's pins. The orchestration
checkout must also be a clean Git root on branch
`docs/personal-fleet-contract-freeze-v1-4-20261104` (PR #350). Require Git,
Python 3.10+, Node 22+, and an isolated path for each output.

## Step 1: read-only preflight (default)

From the orchestration PR #350 checkout in PowerShell:

```powershell
.\scripts\pf62\Prepare-PF68-NativeWork.ps1 `
  -NativeCheckout 'C:\Games\EveCoop\upstream-evejs' `
  -ReviewOutput 'O:\tmp\PF68-source-review' `
  -WorktreeOutput 'O:\tmp\PF68-native-work'
```

This runs the real PF62 source-pinned builder, stages the complete 20-file
review patch, runs Node syntax checks, `git apply --check`, and a byte-exact
replay in an ephemeral Git directory. It emits `PF62-MANIFEST.json` in the
review directory. **No worktree is created.** An existing nonempty review
folder is rejected. A source SHA mismatch fails closed: do not force-apply.

## Step 2: explicitly create a separate WORK worktree (optional)

Use a **fresh empty review path, fresh absent worktree path and unclaimed branch**;
the step-1 output is not silently reused. There is a deliberate dual opt-in:

```powershell
.\scripts\pf62\Prepare-PF68-NativeWork.ps1 `
  -NativeCheckout 'C:\Games\EveCoop\upstream-evejs' `
  -ReviewOutput 'O:\tmp\PF68-source-review-2' `
  -WorktreeOutput 'O:\tmp\PF68-native-work' `
  -WorkBranch 'work/pf-native-review' `
  -ApplyToWork `
  -ConfirmWorkOnly 'WORK-NOT-PLAY'
```

This creates **only a new local Git worktree** and applies the reviewed patch
there. It verifies every resulting `.js` file byte-for-byte with the PF62
manifest and retains the uncommitted diff for manual review:

```powershell
git -C 'O:\tmp\PF68-native-work' status --short
git -C 'O:\tmp\PF68-native-work' diff --stat
```

No `git add`, `commit`, `push`, `merge`, `docker compose`, PLAY restart, API
command or feature activation occurs. The original native checkout's working
files remain untouched, although Git adds **local worktree metadata** to the
repository's `.git` directory. On failure *after* worktree creation, the
utility intentionally leaves it for operator inspection rather than retrying,
deleting, or rolling back unknown writes.

## Hard safety gates

- Exact original branch + PR #350 branch; both Git working trees clean.
- Exact 20-file manifest: two original source updates, eighteen **distinct** native modules
  and one full review patch; all paths/bytes and both stock Git blob IDs checked.
- A byte-consistent on-disk `PF62-MANIFEST.json` receipt.
- Worktree path, review path and both checkouts may not overlap or be ancestors
  of each other; any path component `PLAY`, `PROD`, `production`, `deploy`, or
  `deployment` is denied.
- Worktree destination must not exist. Review directory must be absent or empty.
- New branch must start `work/pf-` and must not already exist.
- `--apply` requires exactly `--confirm-work-only WORK-NOT-PLAY`; no default
  writes to a native worktree.

PF-68 itself has **12 synthetic Git/worktree regression tests**, including an
actual `git worktree add` + `git apply` on an isolated fixture; these are not
tests on the real EveJS source tree. Execute:

```powershell
python -m unittest discover -s scripts/pf62/tests -p 'test_prepare_native_worktree.py' -v
```

**Remaining P0:** real PF58/PF59/PF61/PF66 bootstrap authorities, original
ItemStore/session/market/Mining/WAR/Exploration writer fencing, stock fittings
and ammo, true docking and loss witnesses, native engine startup, and two real
EVE clients on isolated WORK. Do not enable Personal Fleet or merge PR #350 as
gameplay-complete based only on this worktree patch.
