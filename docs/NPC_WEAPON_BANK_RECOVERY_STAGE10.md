# COOP-044 — P0 Native NPC weapon-bank replay preflight (2026-10-25)

**Status:** coded and verified against isolated JavaScript fixture / in-memory POSIX shim; **live gameplay, real Linux Node test suite and native EveJS combat not yet accepted**. Builds on merged PR #80's durable per-module journal. No deployment, Docker changes or `evejs-data` mutation.

## Failure being closed

A native NPC turret bank may debit module A, then fail on module B. Module A has a valid `COMMITTED` receipt; module B might retain `PREPARED` and a lock. Without checking all bank journals before the next cycle, module A could spend another round before module B blocks the bank again. The same class of risk applies to grouped missiles.

## Change

- Before the first turret debit or missile charge result, `coop-native-npc-fire-debit-patch.cjs` calls `coopNpcAmmoDebitJournal.preflightBank` for **all currently armed/active modules** in that bank.
- The new read-only preflight scans each module's persistent last-cycle record, rejects `PREPARED`, stale locks, orphaned atomic temporary receipts, corrupt JSON, owner/module mismatch, duplicate modules and equal/older cycle timestamps.
- A single unsafe module blocks the **entire current bank**, prior to consuming a good sibling's ammunition.
- The new hooks are enabled only with **both** `EVEJS_COOP_NPC_STRICT_AMMO=1` and `EVEJS_COOP_NPC_AMMO_DURABLE_CYCLE=1`; normal player and legacy paths remain unchanged.
- Source transformer preserves the old pinned patch, recognizes previously patched v1 source, is idempotent, supports LF/CRLF and reverses nested insertions in the correct order. This still uses the existing reversible installer, not a second patch path.
- The preflight is read-only and never refunds charges, removes lock files, fabricates shots or modifies native inventory.

## Verification performed

- The pinned-style isolated source fixture was successfully patched, syntax-checked, reapplied and removed byte-for-byte. Updating from the prior PR #80 transform produced the exact same output as a pristine patch (verified for both LF and CRLF).
- An isolated V8 POSIX filesystem shim passed the key partial-bank scenario: module A `COMMITTED`, module B `PREPARED`, new bank preflight rejects the cycle, module A remains at quantity 4. Duplicate-module and changed-owner cases were also checked.
- Committed 4 extra journal behavior tests and 1 source-order regression test. **These new Node tests have not yet been run in a full repository checkout** and may require follow-up fixes.

Manual next tests:

```sh
node --test tests/coop-npc-durable-ammo-debit.test.mjs tests/coop-npc-fire-debit-source.test.mjs tests/coop-npc-ammo-posix-crash.test.mjs
node scripts/patch-evejs-coop.cjs --dry-run --code-path /path/to/disposable/EveJS/Code
node scripts/patch-evejs-coop.cjs --check --code-path /path/to/disposable/EveJS/Code
```

## Still not solved

This **does not** make all barrels and projectile creation one native database transaction. A partial failure **during the same cycle** can still spend already-committed charges without producing damage or a missile. A module omitted from the next armed bank is not scanned, and external inventory writers are not covered by this per-module journal. Also, a failure before any journal is created for the later barrel will not leave a durable pending receipt.

The next P0 engineering requirement is bank-level durable intent and a transaction or quarantine shared across all module debits, integrated with native inventory CAS, plus live crash/fault injection. No safe automatic refund can be inferred from cargo alone. This patch should remain OFF on the live world until manual native acceptance.
