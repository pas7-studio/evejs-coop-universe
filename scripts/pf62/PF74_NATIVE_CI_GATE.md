# PF-74: real-source native WORK integration gate (PR #350)

**Not a gameplay acceptance or deployment.** Personal Fleet remains OFF; the workflow does not start EveJS, mutate `PLAY`, commit/push the native repository, or provision real server authorities.

The workflow at `.github/workflows/pf-native-work-review.yml` is restricted to this feature branch and to changes under `scripts/pf*/**` or the workflow itself. GitHub Actions has `contents: read` only. It runs on Linux with Node 22 and Python 3.13.

## What it proves, when the job runs to completion

1. Checks out the **exact** SHA of PR #350 and asserts the source branch. Stale PR head rejects the run.
2. Clones the **public, original** `pas7-studio/EveJS` branch `coop/pas7std` into a disposable GitHub runner directory. It does not write to that GitHub repository.
3. Calls the **actual** PF-68 opt-in tool, which invokes PF-62 to verify the two pinned original native source Git blobs, compose PF-58/PF-59/PF-61/PF-66, and create the complete 20-file review patch (two changed original files plus eighteen unique native JS modules, including the PF56 return executor and PF78 shared actor proof). **PF75 additionally builds the independently source-pinned PF55 original native owner/claim patch and applies its two original code changes to that same isolated WORK worktree, for 22 native paths total.**
4. Runs `git apply --check` and byte-exact application verification; applies only in a **new local WORK Git worktree** with the explicit `WORK-NOT-PLAY` confirmation. Tests the two transformed original files with `node --check` and asserts all 20 PF62 patch paths are present. Original checkout remains clean.
5. Executes the original PF-58/69-73 Python/Node tests on the complete PR checkout, **including PF-70's real-adoption/validator cross-contract test**, which was previously unrun in partial local staging.
6. Before the PF55 reference suites, executes **PF77's 24 scenarios against the actual source-patched stock `coopNpcOrderArbiter.js` and `coopNpcOrderBridge.js`** inside isolated WORK, with an explicit `PF77_NATIVE_WORKTREE` path. Then executes PF-55/59/60/61/62/66 Node and Python suites, including the Linux SQLite `SIGKILL` tests. PF-55 includes a real two-module `createNpcRuntimeExecutor` -> `createPersonalFleetNativeOrders` object-adapter contract. The original PF55 arbiter and bridge JavaScript files receive separate WORK-only syntax/apply checks; **no live actor/wallet bootstrap is installed**.
7. Uploads only `PF62-MANIFEST.json` and `PF62-NATIVE-REVIEW.patch` as a short-retention review artifact.

## What PASS does not prove

- No original EveJS service boot or native gameplay route installation; all new native modules are still **not wired into original application bootstrap**.
- No real player login, station/UI interaction, authentication/authorization, original entity session ownership, live writer fencing, payroll execution, ammunition/weapon firing, real docking repair, or two-client gameplay E2E.
- A clean CI result alone is **not approval** to enable Personal Fleet, deploy to PLAY, or merge PR #350.

## If no CI run appears

A valid workflow source file by itself does **not** mean a GitHub Actions run has executed. Check the repository **Actions** tab for `Personal Fleet native WORK source integration` on the exact branch. Repository Actions policy, first-run approval, or organization settings may block execution. In that case treat this gate as **NOT RUN**, not PASS. Re-running a workflow is not a substitute for recording its green job URL and checking the attached manifest.

## Local equivalent, without CI

Use the existing `scripts/pf62/Prepare-PF68-NativeWork.ps1` as documented in `scripts/pf62/PF68_NATIVE_WORKTREE.md` with two clean, source-pinned checkouts and four distinct directories. First do read-only preflight; separately opt into WORK application. Then run `scripts/pf62/Test-PF62-Local.ps1`. Any stale source pin must **fail closed**, not be bypassed with `git apply --reject`, `--3way`, or reset of an original durable custody row.

## Proof to record for a native WORK acceptance

Record the exact orchestration commit SHA, original engine checkout SHA, Node version, manifest Git blob source pins, `git apply` result, 20-path source receipt, full suites including PF-70, and WORK client E2E. Until those exist, the engineering status is **integration candidate / Draft / OFF**.
