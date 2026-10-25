# P0 — Durable native NPC ammunition-cycle debit fence (2026-10-25)

**Status:** implemented and isolated-tested on source; **disabled by default**, **NOT accepted in a live EveJS server**. Branch from current `main`, where PR #73 has already been merged. Pinned upstream EveJS revision: `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

## Why

The source-corrected `consumeTurretAmmoCharge` from PR #73 already verifies native cargo and executes authoritative turret/missile debits at the correct firing boundary, but an in-memory `effectState` replay fence does not survive an NPC-server restart. If the process dies between persistent cargo debit and successful shot/spawn, it cannot safely infer whether the charge was spent. Retrying blindly creates double-spend risk; issuing a refund risks minting ammunition.

This patch adds **one persistent last-cycle record per native ship/module**, not a second inventory. It never mints, removes, refunds or adjusts any item itself.

## Exact transactional ordering

The pinned reversible overlay still modifies only the original `consumeTurretAmmoCharge` native fire-cycle function, after the existing exact native source proof:

1. Native `coopNpcFireDebitProof.verify` confirms stored owner, fitted module, exact cargoID/type/quantity and SDE compatibility.
2. **When enabled**, `coopNpcAmmoDebitJournal.begin` validates positive ship/module/cargo ID and a finite positive native `whenMs` cycle boundary; rejects any previous `PREPARED` receipt, stale writer lock, corrupted file or equal/older cycle. Before native debit it requires an existing persistent root, validates non-symlink ship directories, creates missing `ships/` and ship ID directories with restrictive permissions, and **fsyncs each parent directory**. It then obtains a `wx` exclusive lock, fsyncs it, and atomically writes `PREPARED` using a fsynced temporary file + rename + directory fsync. **No native debit has happened yet.**
3. The **original pinned EveJS** `nativeNpcStore.upsertNativeCargo`/`removeNativeCargo` debits the actual native stack. No shadow debit is introduced.
4. PR #73's source code re-reads authoritative native cargo and verifies the precise expected remaining quantity and owner/type/module.
5. `coopNpcAmmoDebitJournal.commit` re-reads the journal and **native cargo** again. Only on verified stock does it atomically write and fsync `COMMITTED`; the exclusive lock is released after a durable commit. The original runtime cache can then be updated and the game can proceed to turret shot/damage or missile launch.

**Crash safety:**
- Crash before writing `PREPARED`: retained lock blocks reentry if ownership became uncertain.
- Crash with `PREPARED`, whether before or after native cargo debit: **automatic replay/refund is blocked** until operator reconciliation.
- Crash after `COMMITTED` but before shot/spawn: same or earlier native cycle boundary is rejected across process restart. Ammo may have been spent without a projectile; **never automatically refund or claim fire settlement**.
- `COMMITTED` with a leftover lock, invalid JSON or orphaned atomic `.tmp` files: read-only audit marks operator review. No automated lock stealing/cleanup.
- A new, later native boundary may proceed only after the previous cycle was committed and the exclusive writer lock was safely removed.

The record file is overwritten atomically after each successful later boundary. It stores the **latest committed boundary**, not complete historical event sourcing. A replay with an equal or smaller boundary is always denied.

## Production flags — OFF by default

```sh
EVEJS_COOP_NPC_STRICT_AMMO=1
EVEJS_COOP_NPC_AMMO_DURABLE_CYCLE=1
EVEJS_COOP_NPC_AMMO_DEBIT_ROOT=/var/lib/evejs/coop-npc-ammo-debits
```

Both opt-in flags are required. If the root is absent/unwritable, `begin` fails closed rather than firing for free. The parent directory must be a **persistent, writable POSIX/Linux mount** with supported atomic rename and directory fsync. Directory fsync may fail on non-POSIX development systems; the feature remains disabled by default. Expect at least two fsynced receipt transitions **per expended module/cycle**, plus lock fsyncs: perform sustained performance/load testing before enabling at scale.

Do **not** use the existing `evejs-data` production volume for unapproved fault tests. No deployment or volume migration is included in this PR.

## Read-only operator audit

```sh
node scripts/audit-npc-ammo-debits.cjs /var/lib/evejs/coop-npc-ammo-debits
```

Returns `CLEAN`, `NOT_INSTALLED`, `NEEDS_OPERATOR_RECONCILIATION` or `INCOMPLETE`; exits nonzero for unresolved findings. Reports exact IDs, most recent boundary and quantities for:
- `PREPARED_RECONCILE` — crashed or uncertain debit; no retry
- `LOCKED_RECONCILE` — stale writer lock, even if last receipt says committed
- `ORPHAN_TEMP_RECONCILE` — uncertain fsync/rename state
- `CORRUPT_RECONCILE` — damaged or mismatching journal

**Operator procedure:** stop new NPC firing for the affected ship, retain a backup of receipt + lock + native cargo store and full server logs, compare the persisted item row with the journal's `beforeQuantity` and `afterQuantity`, locate the native cycle and any visible weapon event, then apply a reviewed reconciliation process. This PR deliberately provides **no automatic repair/lock deletion**, because the journal alone cannot establish whether a shot or missile spawned.

## Tests actually performed

- **14/14** new WAL tests PASS (durable PREPARED/COMMITTED, genuine store re-read, same/older replay after simulated re-instantiation, crash before/after native debit, corrupted record, stale lock, concurrent writer refusal, lost/stolen exclusive writer lock, forged token, complete depletion).
- **7/7** new read-only audit tests PASS (clean/empty, prepared, stale lock, orphan temp, corrupt data, bounded scan), all in isolated JavaScript with a POSIX filesystem shim.
- **20/20** existing committed native fire-source/proof tests PASS after integration, including new source ordering assertion.
- **41/41 committed isolated cases PASS**. The actual complete pinned 1.2 MB `space/runtime.js` was patched with the existing reversible installer and parsed; idempotent and byte-for-byte rollback. Tests are **not** real SQLite/native store crash injection or full `node --test` from a running pinned EveJS checkout.
- **3 additional committed POSIX regression cases** in `tests/coop-npc-ammo-posix-crash.test.mjs`: parent directory fsync on the first cycle, a Linux `SIGKILL` after `PREPARED` followed by replay denial, missing-root failure, and symlink refusal. **These Node tests still need execution on a Linux checkout**. An additional in-memory V8 POSIX shim check of the amended journal passed (`PREPARED` → `COMMITTED` → replay rejection → later `PREPARED`, including root/ship-parent fsync calls). This is not power-loss evidence.

## Remaining engineering gates — still P0

1. **Multi-barrel atomicity:** locks are per module, not a single bank-wide transaction. If one bank debit succeeded and a later one failed, the successful charge remains spent without a shot. No unsafe refund. Full bank-wide atomic commit must integrate with authoritative native item store.
2. **External writers:** the lock is respected by this fire patch; it is **not** a DB-level compare-and-swap shared by the native market, rearm or other inventory writers. Global native inventory concurrency is not guaranteed.
3. **Crash after COMMITTED before projectile/shot:** prevents double debit on replay but can still lose ammunition. There is no cross-store atomic shot/spawn acknowledgement; receipt describes **ammo debit**, not a confirmed hit or launched missile.
4. **Crash fault injection:** fsync, rename, lock persistence and SQLite writes must be tested against an actual disposable Linux filesystem with process kill points.
5. **Native acceptance:** two-client NPC engagement, actual turret hit/miss, grouped missile bank, reload, retreat, earned-market rearm, kill evidence, performance and host restart. No existing production state touched here.

**Source integration does not enable the flag. No live deploy, Docker restart, existing `evejs-data` mutation or production flag activation has been performed.**
