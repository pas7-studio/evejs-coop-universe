# Chat 17 - NPC native industrial economy / crash reconciliation (2026-10-25)

Status: CODE_READY / LIVE_UNVERIFIED. Scope: existing manufacturing director and its native receipt recovery. This change does not add a second market, wallet, scheduler or synthetic inventory, and does not enable gameplay flags.

## Authorities and current native path

The repository already has warehouse ownership and native stock (coopNativeWarehouse), SDE/blueprint/material planner (coopNpcManufacturingPlanner), GameStore/SQLite transaction kernels (coopNpcIndustryGameStoreScope, coopNpcIndustryReady, coopNpcIndustryOfflineDelivery), the one journalled native economy director, Rust pending order and market escrow (coopNpcPendingMarketEscrow), and corporate settlement (coopNpcCorporateSettlement / coopNpcCorporateBuyerAtomic). A-Life ACT delegates to this director; it must never write a second ledger.

Source pin: gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f. Baseline for this isolated work: pas7-studio/evejs-coop-universe@a1b5baea0bc58413320f628a51b8adf984495abd.

## Exact repair

Before this change, the existing director refused every INSTALL_UNKNOWN and DELIVERY_UNKNOWN indefinitely after a lost response, even when the original GameStore transaction had committed. Blind retries of install/delivery would instead double-debit ISK/materials or duplicate a manufactured stack.

coopNpcEconomyUnknownRecovery.reconcileUnknown performs read-only comparisons to the original durable journal:

- INSTALL_UNKNOWN: exact coopOperationID, job ID, NPC corporation, station, facility, BPO, manufacturing activity, output type, job status INSTALLED/PAUSED/READY only, original canonical quote signature/cost and unique native corporate wallet-debit receipt. Returns journal transition to INSTALLED, not a second installOnce.
- DELIVERY_UNKNOWN: the same job with status=4 and matching persisted coopDelivery for the operation, production quantity, item ID, native corporation owner, station-hangar location/flag, output stack size and provenance customInfo. Also rechecks the exact original ISK debit. Returns journal transition to DELIVERED, not another deliverOnce.
- LIST_UNKNOWN, corrupted/foreign records, missing inventory/receipt, an unproved COMPLETED=100 job, changed owner, moved output or unavailable store stay BLOCKED. An uncertain Rust order is never reserved, activated, bought or finalized twice by this repair.

The existing station lock and fsync journal remain authoritative. Recovery has priority over new production and other station actions. No Rust RPC, native SQLite write or item grant occurs in the verifier; only the existing director journal advances after positive native receipts.

## Tests and limits

- Local Node v22.16.0: node --test tests/coop-npc-economy-unknown-recovery.test.mjs: 13/13 PASS against the identical committed helper blob; includes lost ACK, PAUSED/READY, unverified debit, false completed job, ghost output, wrong owner, moved/duplicated cargo, wrong quantity, and read failures.
- Two extra tests were added to the existing director test suite for lost install and delivery ACK followed by journal restart and onward listing. Full director test suite was not run in this environment (complete repo checkout unavailable).
- No GitHub CI, deployed Docker, player EVE clients, production SQLite/worker, Rust cargo test or actual two-client purchase/sale was run. No game data, server volume, credentials, market orders or corporate wallets were changed here.

## Chat 01 integration / blockers

The director remains proof-only and not registered as an automatic live economy scheduler. The general overlay module copy list does not currently install this proof-only director and its new helper. Chat 01 owns central bootstrap/hooks and must arrange deployment only after pinned production GameStore/SQLite plus Rust validation and operator approval, keeping flags default OFF.

Mandatory acceptance on a disposable pinned server: true station-owned mineral inputs and BPO; actual manufacturing job and one material/ISK debit; native PAUSED/READY timer; crash and restart around install/ready/delivery; same native output itemID in hangar; pending Rust order invisible before physical escrow; one buyer claim; one actual player wallet debit and physical item transfer; one NPC corporate wallet credit; replay/reconnect before/after each Rust and GameStore commit; five replenishment/sale cycles without ghost WIP. Test stock Rust settlement and seller/corp-buyer separately, confirm cache invalidation across persistence-worker restart. Do not claim complete playable NPC economy or mark the acceptance manifest PASS until real artifacts are observed.

Related existing design docs: docs/COOP_044_NATIVE_ECONOMY_LOOP_AUDIT.md, docs/COOP_034_RUST_NPC_PENDING_ESCROW.md, docs/COOP_035_NPC_CORPORATE_SETTLEMENT.md, docs/COOP_NPC_MANUFACTURING_STAGE_F_READY.md.
