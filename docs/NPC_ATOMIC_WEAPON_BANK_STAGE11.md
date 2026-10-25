# COOP-045 — Native NPC atomic weapon-bank ammunition (2026-10-25)

**Status: source implemented; native SQLite/Linux and two-client acceptance pending.** Stacked on PR #87. No deployment, Docker restart or evejs-data changes.

## Real persisted authority

Pinned EveJS stores NPC ammo in the SQLite-backed GameStore npcCargo table. Native cargo is keyed under the cargo row, mapping cargoID to record. npcEntities and npcModules are wrapper tables with per-entity module rows. The existing coopGameStoreAtomic single-owner BEGIN IMMEDIATE bridge now permits these three authoritative native tables.

New integration module: integration/coopNpcAmmoBankAtomic.cjs. A single GameStore transaction:

1. Re-reads the native ship, owner, system, every fitted module, source ammo stack, compatibility and exact quantity.
2. Rejects duplicate module/cargo IDs, transient cargo, stale cycle boundaries and any invalid module or ammo.
3. Atomically decrements all involved stacks in npcCargo.cargo, removing a row only at zero.
4. Updates npcCargo metadata row coopAmmoCycles_<shipID> with every contributing module's latest boundary **in the same SQLite transaction**.
5. Returns only after native cache reconciliation and a post-commit full bank quantity re-read.

No shadow inventory, player item table writes, market trades, counterfeit charge or secondary SQLite writer is introduced. Too-large rows, unavailable GameStore and unquiesced native persistence fail closed.

## Durable ship-bank journal

Path: AMMO_DEBIT_ROOT/bank-ships/<shipID>.json. A POSIX-exclusive lock and fsynced PREPARED receipt are written before opening the native transaction. COMMITTED follows successful native SQLite transaction, verified readback and filesystem sync. Only then are NPC in-scene cargo cache and charge results updated.

- ROLLBACK: native inventory unchanged; uncertain PREPARED is still quarantined for operator review.
- COMMIT acknowledgement lost: cargo may have been spent; PREPARED blocks retries or refunds.
- After COMMITTED but before actual shot/spawn: ammo might be lost without damage. Do not invent a shot or auto-refund.
- Replayed latest cycle is rejected before PREPARED; older per-module boundaries are rejected by SQLite replay fences even after bank composition changes.
- An atomic ship cannot silently downgrade to per-module writes while its durable atomic receipt exists.
- Stale lock, orphan atomic temporary, unreadable stock, corrupt receipt and unknown commit state halt future ship firing.

## Exact opt-in flags — all four required

- EVEJS_COOP_NPC_STRICT_AMMO=1
- EVEJS_COOP_NPC_AMMO_DURABLE_CYCLE=1
- EVEJS_COOP_NPC_BANK_ATOMIC=1
- EVEJS_COOP_NATIVE_ATOMIC_ROWS=1
- EVEJS_COOP_NPC_AMMO_DEBIT_ROOT=/var/lib/evejs/coop-npc-ammo-debits (existing persistent POSIX mount)

All remain OFF for the actual running server. Do not use or reset the owner's existing evejs-data volume for crash experiments.

## Read-only operator commands

- node scripts/audit-npc-ammo-debits.cjs /path/to/disposable/root
- node scripts/audit-npc-ammo-banks.cjs /path/to/disposable/root

Preserve the original SQLite file, receipts, locks and relevant logs before any reconciliation. These scripts never clear locks or issue refunds.

## Verification actually performed

- Full pinned upstream space/runtime.js (1,205,085 characters) transformed; patched JavaScript syntax parsed; idempotent apply and byte-for-byte remove passed. Both turret and missile paths invoke atomic bank debit before their old effect paths.
- Isolated V8 mock SQLite and POSIX filesystem check: two bank cargo rows moved 5 to 4 together; both module replay fences persisted; repeated same boundary denied without another transaction.
- Committed **15** atomic-bank behavior tests, **2** Linux `SIGKILL` child-process tests backed by `node:sqlite`, **1** added GameStore/SQLite bridge integration case and **2** source-transform regression tests (20 newly added cases in this PR). A safe Windows runner is `scripts/Test-Coop-NpcAmmoAtomic.ps1`. These committed Node tests have **not** been executed in a checkout with the full Node runner. Live native EveJS and two-client combat are unverified.

## Merge and live acceptance gates

1. Run `scripts/Test-Coop-NpcAmmoAtomic.ps1` in Windows PowerShell, or the equivalent `node --test` list on Linux. Then run the complete local Node 22 test suite on a disposable checkout, including node:sqlite. The SIGKILL tests run only on Linux; on Windows they are skipped.
2. Native crash injection before debit, between journal PREPARED and SQL COMMIT, immediately after COMMIT and before missile spawn; verify real durable row IDs on restart.
3. Pinned overlay dry-run, check and exact remove on a disposable upstream checkout.
4. Throughput and lock contention/load testing: this path flushes three native tables, rewrites an npcCargo.cargo JSON blob and performs several fsyncs per bank.
5. Owner-approved server World, a real client and two authenticated clients sharing combat effects.

**Residual limits:** cargo update is atomic only within the bank's SQLite transaction. Damage, missile creation, client visibility and other external writers are not covered by that SQLite commit. This is not a fully atomic combat outcome.
