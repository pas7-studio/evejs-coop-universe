# COOP-046 — P0 Native NPC ammo to combat-outcome witness

**Status:** source-level implemented on top of merged COOP-044/045. Full Node runner, native Linux crash and two-client combat acceptance **PENDING**. No live Docker/data changes and no GitHub CI.

## Safety boundary

COOP-045 atomically commits all native NPC weapon-bank ammo debits and SQLite module replay fences, then writes COMMITTED to the POSIX bank journal. Actual turret damage or missile creation occurs after that commit. A crash may spend ammo without yielding an observable shot.

COOP-046 stores a durable **combat outcome inside the latest COMMITTED ship-bank receipt**:

- TURRET_RESOLVED — shot resolution and damage-processing path returned, including legitimate misses that consume ammo; stores hit boolean. Not proof of durable damage or client rendering.
- MISSILE_LAUNCHED — successful native scene.launchMissile with a positive spawned missile entity itemID. Not proof of persistent projectile delivery to clients.
- MISSILE_LAUNCH_FAILED — known launcher failure after cargo was debited. Such a witness never authorizes another debit or refund.

After a crash between COMMITTED and outcome write, the next cycle fails closed. On write/fsync/rename error, preserve stale writer lock and temporary receipt. No automatic refund, retry, fabricated damage or missile.

## Opt-in flags — ALL five must be 1

- EVEJS_COOP_NPC_STRICT_AMMO
- EVEJS_COOP_NPC_AMMO_DURABLE_CYCLE
- EVEJS_COOP_NPC_BANK_ATOMIC
- EVEJS_COOP_NATIVE_ATOMIC_ROWS
- **EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS** (new; default OFF)

Use an existing persistent POSIX root specified by EVEJS_COOP_NPC_AMMO_DEBIT_ROOT. Inconsistent flags block native NPC combat before ammo debit. Player and legacy combat remain unchanged.

**Migration warning:** enabling witness mode on a ship with an old COMMITTED bank receipt lacking outcome deliberately blocks the next cycle. Preserve that receipt; controlled operator migration and manual approval are required. Never delete the file or disable safety flags just to bypass the fence.

## Changed code

- integration/coopNpcFireOutcomeWitness.cjs — validate matching COMMITTED receipt, exclusive lock, fsync, atomically persist kind, cycle timestamp and small outcome evidence. Reject duplicates and stale cycles.
- integration/coopNpcAmmoBankAtomic.cjs — require a successful previous outcome witness before writing the next PREPARED when the new flag is enabled.
- scripts/coop-native-npc-fire-debit-patch.cjs — reversible pinned source hooks after turret resolution/damage and after missile launch success/failure. The existing ammo transaction remains authoritative.
- scripts/audit-npc-atomic-sqlite.cjs — optional read-only --require-outcome mode classifies missing/failed outcomes, validates metadata; legacy audit behavior unchanged.
- tests/coop-npc-fire-outcome-witness.test.mjs — 10 dedicated journal and next-cycle tests; tests/coop-npc-fire-debit-source.test.mjs — 2 ordering tests; tests/coop-npc-atomic-sqlite-audit.test.mjs — 4 audit cases.

## Verified now

- Full pinned upstream runtime.js (1,205,085 characters) transformed and syntax parsed; repeated patch identical; uninstall restores byte-for-byte upstream content.
- Isolated V8 filesystem shim demonstrated persisted turret miss, missile entity ID, known launch failure and safe duplicate rejection.
- **Node repository test runner not yet executed**. Real SQLite SIGKILL/restart tests and dual-client gameplay still require local manual acceptance.

## Local commands (Node 22+ in Linux/WSL2)

    bash scripts/test-coop-npc-ammo-atomic.sh

Read-only matching bank journal and native SQLite snapshot:

    node scripts/audit-npc-atomic-sqlite.cjs /path/to/npc-ammo-root /path/to/gamestore.sqlite --require-outcome

On unresolved results, preserve SQLite, receipts, locks, orphan temporary files and server logs. Never auto-delete locks, re-credit ammunition or spawn a substitute missile.

**Residual limitation:** outcome witness does not create a distributed transaction between SQLite, the scene, damage and client visibility; no production flag activation until manual gates pass.
