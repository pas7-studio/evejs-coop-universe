# Chat 27 — native player industry, resource custody and exactly-once safety

**Status:** SOURCE_WIRED_IN_PR_177 / NOT_DEPLOYED / LIVE_UNVERIFIED.
Pinned upstream: `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.
Chat 27 originally staged source modules and an integration contract. PR #177 wires
those existing authorities into the single transactional installer and the original
industryManager RPC handlers, default OFF. No modifications to GameStore, native
persistent volumes or live world have been performed.

## What the client and pinned server actually support

EveJS has native industry RPC in `Code/server/src/services/industry/industryManagerService.js`:
`InstallJob`, `CompleteJob`, `CompleteManyJobs`, `CancelJob`, jobs and counts.
`blueprintManagerService.js` exposes blueprint instances, ME, TE, runs and locations;
`facilityManagerService.js` and `industryStaticData.js` expose facility activities and
service/rig/system/skill bonuses. `industryRuntimeState.js` supports:

| Activity ID | Native acceptance | Evidence / constraint |
| --- | --- | --- |
| 1 Manufacturing | yes | BPO or eligible BPC, real minerals, account charge, job time, output |
| 3 ME-independent time research (TE) | yes | BPO only; level capped at TE 20 |
| 4 Material research (ME) | yes | BPO only; level capped at ME 10 |
| 5 Copying | yes | BPO only; physical BPC itemIDs, licensed runs, copied ME/TE |
| 9 Reactions | yes | valid BPO/activity and facility, material consumption and product |
| 8 Invention | **NO** | constant and service mapping exist, but `quoteIndustryJob` rejects it as INVALID_ACTIVITY; do NOT fake an invention job or pretend UI support |

`quoteIndustryJob` incorporates native SDE activity definitions,
`resolveIndustrySlotContext`, native skill and slot restrictions,
facility services, range/standings, system cost index, material efficiency,
rig and hull modifiers, wallet division roles, and time. The overlay must
invoke native quote instead of manufacturing its own cost/time/products.

## High-priority upstream failure modes (not fixed by this patch alone)

1. `industryRuntimeState.js:1768-1894`: install separately removes materials,
   charges ISK, writes `industryJobs`, updates `industryBlueprintState` and moves
   the BPO/BPC to installed location `2003`. If any step fails or a process
   stops in between, some prior writes may survive. A retry may remove
   more ore/ISK or create another job.
2. `industryRuntimeState.js:1979-2105`: delivery calls
   `grantItemsToCharacterLocation` / `grantItemsToOwnerLocation` before
   persisting DELIVERED and returning/decrementing the blueprint. A crash
   can grant native product items, leave the job READY, and grant them again.
3. The native role checks are separate from wallet/account, input hangar
   take permission and output hangar view permission. A shared corporation
   does **not** authorize arbitrary member use of another member's personal
   BPO; other corp members require real `ROLE_FACTORY_MANAGER`,
   appropriate hangar permissions and wallet division access.
4. `markIndustryJobReady` exists outside the client completion path; no
   test shortcut or fake clock advance is allowed as gameplay evidence.

## New source modules

### `integration/coopPlayerIndustryGuard.cjs`

`makePlayerIndustryGuard(bindings)` is a fail-closed, read-only native-state
preflight. Operator supplies exact native callbacks:
`getSessions`, `getCharacterRecord`, `getInventoryItem`,
`getBlueprintByItemID`, `getBlueprintState`, `getJobByID`,
`quoteIndustryJob`, `getAvailableMaterials` (native
`resolveAvailableMaterials`), `hasCorporationIndustryJobAccess`,
`canTakeFromOwnerLocation`, `canViewOwnerLocation`,
`canUseCorporationWallet`, `getCharacterWallet`,
`getCorporationWalletBalance`, `getActivity` (native
`industryParityHelpers.getIndustryActivity`), and `nowFiletime`
(native FILETIME).

- `checkInstall(session,parsedNativeRequest)` rejects forged owner, stale
  or double sessions, mismatched native account/corporation, blueprint item
  outside the actual owning inventory, installed blueprint, bad BPO/BPC
  run budget, unsupported activity/invention, offline or incompatible
  facility, invalid corporate permissions, unfunded wallet, wrong stock
  quantity, zero-cost/zero-material manufacturing/reaction and quote
  identity/price/time inconsistencies. Output is an immutable **proof
  description**, not a command to create resources.
- `checkDeliver(session,jobID)` requires real READY native job, elapsed
  FILETIME, matching installed blueprint (`locationID=2003`), locked
  native state `jobID`, BPO/BPC restrictions, ownership/corporation rights,
  and installation-cost evidence. It never overrides native delivery logic.

### `integration/coopPlayerIndustryReceipts.cjs`

`makePlayerIndustryReceipts(bindings)` reads **actual** native inventory,
wallet and blueprint/job state. Requires `getJobByID`, `getBlueprintState`,
`getInventoryItem`, `listContainerItems`, `getWalletBalance`,
`getBlueprintDefinitionByTypeID`, `getIndustryActivity`.
- `capture(proof)` records real pre-operation resources.
- `verifyInstall({proof,nativeResult,before})` checks the exact native
  created job and blueprint lock, the specified material decrements and
  wallet debit including tax/surcharges.
- `verifyDeliver(...)` requires native DELIVERED, the correct
  deliverer, actual material output delta OR new BPC itemIDs and
  copy-specific runs/ME/TE OR research-level increment and BPO return.
  Previously spent BPC must not magically persist when exhausted.
- `captureHandoff` / `verifyHandoff` check equal and opposite actual
  quantity changes between two owners' native inventory locations after
  an **already authorized native trade / corporation hangar transfer**.
  They are observers, not an item-transfer or permission-bypass API.

Important: the exact-delta receipt is conservative: unrelated concurrent
trades on the same owner/type/location may produce `UNKNOWN`, not a free
pass. Verify actual inventory snapshots and coordinate operator review.

### `integration/coopPlayerIndustryFence.cjs`

`makePlayerIndustryFence({file})` is a fail-closed append-only JSONL
`PREPARED → SETTLED | UNKNOWN` journal, with process-independent
on-disk exclusive writer lock and `fsync`. Use a **real persistent
path**, e.g. `/var/lib/evejs/coop-player-industry.jsonl`, never /tmp.

A trusted native handler must:
1. Perform a **fresh** `checkInstall` or `checkDeliver` immediately
   before native side effects.
2. Call `fence.execute({proof,captureNative:receipts.capture,
   nativeExecute:()=>nativeInstallOrDeliver(),verifyNative:(args)=>...,
   readPreviousJob:...})`. The fence fsyncs PREPARED **before**
   capture and native work. It calls native work at most once. If
   native returns success and receipts verify, fsyncs SETTLED; otherwise
   persists UNKNOWN and refuses automatic retry.
3. On retry/reconnect/restart, a PREPARED/UNKNOWN entry, corrupt/truncated
   journal or stale lock **blocks** the native operation until manual
   reconciliation. A SETTLED delivery cannot be replayed by a different
   authorized character. A BPO may start its next valid *paid* installation
   cycle only after the previous native job is independently confirmed
   DELIVERED or CANCELLED and native blueprint availability is rechecked.
4. In `CompleteManyJobs`, invoke the protected delivery separately for
   each native jobID (no pre-granted batch outputs).

The journal does **not** make native GameStore, inventory, wallet and
job-table writes atomic. It deliberately trades automatic crash
recovery for at-most-once invocation. In UNKNOWN a paid job might
require human repair; there is no silent mint, refund, GM completion or
automatic second attempt. A truly closed unattended cycle requires a
single native SQLite atomic transaction spanning item materials, owner
wallet division, blueprint, job, output items and allocator. This
cannot be honestly claimed without modifying and live-verifying the
native runtime transaction architecture.

## Real cooperation contract

Player A and player B are always distinct native characters. Move
minerals or produced items only using EveJS native trade/docked cargo,
or corporation hangar flows with the correct roles and owners. The
industry job debits the inventory **of its actual owner**, not fleet
members. Corp jobs charge the approved corp wallet and deliver to the
native corp output division. The receipt verifier then checks both
real owner inventories; there are no synthetic trade or inventory rows.

**Integration ownership:** Chat 01 owns `scripts/patch-evejs-coop.cjs`,
the shared native hook manifest and deployment. Chat 25 handles native
player transfer/hauling mechanics. Central installer integration is now included in draft PR #177 behind
`EVEJS_COOP_PLAYER_INDUSTRY_GUARD=1` (default OFF) and the absolute persistent
`EVEJS_COOP_PLAYER_INDUSTRY_JOURNAL_FILE`. Original native RPC actions
`Handle_InstallJob`, `Handle_CompleteJob`, `Handle_CompleteManyJobs` (each job)
and `Handle_CancelJob` route through the co-op custody fence only when enabled.
This remains source-wired, not deployed or live-verified. Do not modify pinned upstream or deployed world by hand.

## Tests and acceptance

```sh
node --test tests/coop-player-industry-guard.test.mjs \
  tests/coop-player-industry-fence.test.mjs \
  tests/coop-player-industry-receipts.test.mjs \
  tests/coop-player-industry-cycle.test.mjs
node scripts/patch-evejs-coop.cjs --code-path "$EVEJS_COOP_CODE_PATH" --dry-run
node scripts/patch-evejs-coop.cjs --code-path "$EVEJS_COOP_CODE_PATH" --check
```

Isolated JS harness against exact GitHub blobs:
**19 preflight + 12 journal + 10 receipt/handoff + 1 cycle = 42/42 passed**.
Tests use trusted **disposable fake native stores** for deterministic
crash/permission/amount behavior. GitHub remote is inaccessible from
this execution container (`Could not resolve host: github.com`);
official repository `node --test`, cross-overlay dry-run, actual
SQLite GameStore, Docker, Rust, EveJS client and two-player live tests
were **not** run here.

Required operator-controlled gameplay acceptance, without touching
valuable production state: each character builds separate BPO jobs,
verify one real BPC exhausts licensed runs, ME 0→1 and TE 0→2,
copying creates true new BPC itemIDs, research/copying dates, real
manufacturing and reaction recipes, station/structure bonuses, lack of
invention in pinned client, corp permissions and wallet division denial,
same-site native trades, fees, cargo owner changes, physical output,
cancel, READY vs PAUSED, reconnect, and crash injection between each
native inventory / wallet / job / blueprint write. Compare persisted
itemID, owner, stack quantity, wallet transaction IDs, jobIDs and
all blueprint metadata after each restart. Test legitimate re-install
of returned BPO after successful delivery. Never equate simulated
or source-only tests with gameplay PASS.

**Original Chat 27 result: CODE_READY (42 isolated checks originally recorded).**
**PR #177 result: source-wired, default OFF, LIVE_UNVERIFIED.** Native invention
remains unimplemented in this pin; cancellation now has native ownership and
terminal blueprint-custody receipts.
