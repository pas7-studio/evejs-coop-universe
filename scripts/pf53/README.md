# PF-53 — Original player ISK wallet paid hire + PF52 native hangar roster

**Status: SOURCE CANDIDATE / NOT GAMEPLAY READY.** 2026-11-05.

This module is a **single-server, single-original-GameStore** implementation of the monetary and durable roster part of Personal Fleet hire. No ship is minted, no named pilot is synthesized, no inventory item is transferred and no NPC is spawned. The module is **inert until injected with trusted engine-local authorities**. It neither enables flags nor deploys to WORK/PLAY.

## Functional behavior

`native/coopPersonalFleetPaidHiring.cjs` exports `createPersonalFleetPaidHiring()`, which accepts `hire(command)` with `operationID`, trusted session, `ownerCharacterID`, existing `pilotID`, original `agentID`, `contractID`, `offerID`, expected immutable offer revision, and expected PF52 roster revision. The client cannot set the amount or recipient.

One original `gameStore.coopAtomicNativeRows.transact(['characters','corporationRuntime','npcEntities'], ...)` performs ALL the following **under the same BEGIN IMMEDIATE/COMMIT**:

- Rechecks account ownership, global writer-fence readiness, feature enablement and authoritative original agent offer; verifies an existing original NPC pilot and independently confirmed NPC employer.
- Rejects conflicting WAR fleet/native PF actor claims, duplicate pilot/contract, stale roster revision, bad original wallet, insufficient ISK, invalid offer or transaction ID collision.
- Debits the original player `characters/characters[owner].balance` in integer cents and appends a native-compatible character `walletJournal` debit.
- Credits the original employer `corporationRuntime` key `corporations\u001f<employerCorpID>` division `1000` and appends original corporation journal **and** transaction rows.
- Creates a durable global wallet-ID reservation, immutable paid-hire evidence, and enrolls the NPC in the **same PF52 canonical `hangar-reservations-v1` + per-owner `hangar-roster-v1` rows**. There is no separate PF53 roster.
- Returns a stable idempotent receipt. A retry of an already committed operation never debits ISK again; a changed operation fingerprint is refused. Replay verifies BOTH original wallet journals and canonical paid-hire proof, failing closed if evidence has been pruned.
- Notifies the original wallet/session owner **only after confirmed COMMIT**. A failed native notification yields `notificationStatus:'PENDING'` without compensating or repeating the debit.

A subsequent PF52 `RESERVE_HANGAR_SHIP` reserves **the same original ItemStore itemID**. This second operation has its own durable transaction; a crash between paid hire and ship reservation leaves a paid but unassigned pilot, not a lost ship or second debit. Local integration test covers this handoff.

## Required trusted original-native bindings (not included)

`createPersonalFleetPaidHiring({ gameStore, pf52, access, resolveNativeOffer, verifyOriginalNpcPilot, verifyNativeEmployer, verifyJournalID, originalTransactionID, notifyOriginalWallet, allWalletWritersFenced, enabled, clock })`.

- `gameStore` must be the **original in-process** `SERVER_INTERNAL_FLAGGED` GameStore with `coopAtomicNativeRows` and a strict durable SQLite owner; no shadow SQLite/wallet.
- `pf52` must be the exactly reviewed **PF52 module**. The `deps/pf52-reference-hangar.cjs` file in this package exists ONLY for isolated tests and must NEVER become a second deployed authority.
- `resolveNativeOffer` and `verifyOriginalNpcPilot` must derive price, agent employment and **existing named pilot** from the original native NPC/agent authority (not user input, a mock `npcEntities.pilots` record or a quote with invented cost). `npcEntities` is declared for read-only native proof; no NPC is created here.
- `verifyNativeEmployer` must prove the stock NPC corporation and original account `corporations\u001f<id>`; the server determines the recipient.
- `originalTransactionID` must call the **original wallet ID source**, and `verifyJournalID` must check its uniqueness/validity against the real owner. The in-transaction PF53 global journal key also fences PF53-against-PF53 collisions. The stock original ID generator is probabilistic, so its use alone does not prove global uniqueness.
- `allWalletWritersFenced()` MUST prove reciprocal participation of **all original** character wallet, corp wallet, ItemStore, personal/WAR/mining, market, payroll and inventory mutators in the same authoritative guard; it is currently **false/not integrated** in the target engine.
- `notifyOriginalWallet` must publish through the stock wallet/session owner and be retry-safe; direct socket fake notifications are not authority. The current module does not dispatch UI events or create agent buttons.

**Do not set** `EVEJS_COOP_PERSONAL_FLEET=1`. PF42 mutual-exclusion restriction remains. No PLAY, no main merge, no GitHub Actions.

## Verify locally (Node 22.16+)

From this standalone package root:

```powershell
node --test .\tests\pf53-paid-hiring.test.cjs .\tests\pf53-paid-hiring-sigkill.test.cjs
.\Test-PF53-Local.ps1 -ForkRoot 'C:\Games\EveCoop\upstream-evejs'
```

The PowerShell runner is **read-only**; with `-ForkRoot` it checks the original upstream source against known Git blobs, never patches it. The manual Node regression **PF53 36/36 PASS** and **PF46–53 273/273 PASS** were run in this container on Node 22.16.0. Tests use the original SQLite API (`node:sqlite` `BEGIN IMMEDIATE`, `synchronous=FULL`, `COMMIT`, rollback) and child process SIGKILL, but the native engine itself was **not** patched/compiled/run. Windows PowerShell and WORK gameplay E2E are **NOT RUN**.

## Unfinished actual gameplay

This is the first candidate that **charges original character ISK**, but it is **NOT a deployable personal pilot hiring system** until original NPC offers, original pilot identity, all wallet writer fences and native notifications are integrated and independently proven. Recurring salaries/payroll, physical ItemStore custody moves, original NPC controller spawn, fleet orders, docking/return, UI and two-player WORK E2E are still incomplete. The upstream repo branch write was previously rejected (GitHub API 403). Do NOT merge or deploy the draft PR as gameplay-ready.