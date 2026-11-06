# PF83 — revalidate native Return destination; manual-only release gate

**PR #350 Draft; Personal Fleet OFF.** This corrects a source-level defect,
not a playable feature or evidence of in-game docking.

PF56 previously built the warp destination before the native order arbiter's
callback. If the canonical station moved before the arbiter executed, a
successful second identity check could still send stale coordinates to native
physics. PF83 recalculates the destination from the **reverified** station
inside the callback and rejects non-finite output (for example, overflow when
adding station radius and clearance).

PF83-B adds combat return quiescence after stock ATTACK promotes the live
Personal Fleet controller to nativeCombat. A one-shot native STOP must be
acknowledged and independently read back as manualOrder.type=stop with
currentTargetID=0 before a return warp can be issued. A failed or lying
STOP blocks warp; no automatic retry or gameplay success is claimed.
Three additional pf56-native-api.test.cjs regressions cover those cases.

Three new tests check: changed station coordinates during arbitration, numeric
overflow, and changed station identity inside the callback. These are
isolated tests and do not establish an actual server warp or station arrival.

The repository's `AGENTS.md` explicitly prohibits GitHub Actions. The
`.github/workflows/pf-native-work-review.yml` workflow was removed, and the
local unittest `test_pf83_no_remote_ci.py` guards that restriction. **No
remote CI should be restored or run.** PF74 documents are historical only.

Run locally on Node 22+ / Python 3.10+ from this branch:

```sh
node --test scripts/pf56/tests/pf56-native-api.test.cjs
python3 -m unittest discover -s scripts/pf62/tests -p 'test_pf83_no_remote_ci.py' -v
```

Then, on the owner's Windows workstation, run the actual original engine
`Prepare-PF80-CompleteNativeWork.ps1` in the separated WORK checkout and
review its evidence. The two PF62 source blobs match the fork's current
`coop/pas7std` files as of 2026-11-06, but an actual local `git apply`
and real WORK server startup have **NOT RUN** here.

The GitHub App still receives HTTP 403 when creating a branch in
`pas7-studio/EveJS`. Native bootstrap, GameStore/ItemStore/wallet authority,
stock combat arbitration, two-player gameplay, restart and crash recovery
remain unverified. No PLAY/main change is authorized.
