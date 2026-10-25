# COOP-024E stage 2 — Native NPC wreck → cargo custody (2026-10-25)

**Status:** Source implementation with isolated verification. **Not approved or enabled in a live game.** This builds on [PR #45](https://github.com/pas7-studio/evejs-coop-universe/pull/45): a real named native NPC has already received *source-proven attacker evidence*, physically approached the resulting wreck and can now collect its pre-existing items **only where EveJS already proves native loot entitlement**.

## Actual item lifecycle (no fake inventory)

`integration/coopNpcWreckCustody.cjs` executes one full native wreck-item stack per transaction:

1. Revalidate an exact durable `coopNpcWreckClaims` kill receipt, unique named NPC pilot ↔ same native physical ship, native controller idle, active system and **2.5 km physical pickup range**. The physical wreck must be alive, durable, match the destroyed victim, and contain the same native item in `nativeNpcStore`.
2. Require explicit existing wreck owner matching NPC ship owner **or** `lootRightCorpID` matching the ship's verified corporation. A separate caller callback must also approve; mismatched rights fail closed. **Suspect theft / illegal NPC looting is NOT implemented or permitted.**
3. Resolve native type metadata and hull capacity, count every existing native cargo stack's volume. Refuse unknown item type, unmeasurable capacity, overcapacity, transient goods or a player-controlled hull. No partial stack or arbitrary item conversion.
4. Allocate a unique native cargo ID from pinned upstream `nativeNpcStore.allocateCargoID` (durable counter) and write a versioned `PREPARED` journal **with file fsync and parent-directory fsync** before any source mutation.
5. Debit the exact original wreck-item using `removeNativeWreckItem`; re-read its absence. Persist a `DEBIT_CONFIRMED` journal record before crediting any cargo.
6. Credit **the same type, quantity and module state** to native NPC cargo with `upsertNativeCargo`, verify exact persisted owner/location/type/amount, refresh the actual native ship's `nativeCargoItems` cache, persist `SETTLED`. No wallet, price, market, salvage-right or mission reward writes.

### Crash/retry semantics

This is explicitly **NOT a database-level atomic cross-table transaction**. Instead it is *source-first*, durable-intent with crash fences:
- `PREPARED` after a crash has an **unknown debit outcome**. Even if the source appears missing, the system **does not auto-credit** a ship, because the removal may have happened through another actor. It refuses all new transfers until operator reconciliation.
- `DEBIT_CONFIRMED` means the source debit was positively observed and the journal marker persisted. On restart it can safely finish the *same cargo ID* and verify the resulting persisted cargo. A failed cargo credit is retried from this marker only; never a new allocation.
- `SETTLED` is a durable tombstone; repeat requests do not create more cargo. Conflicting destination identity or changed ship owner blocks settlement. Corrupt journals, temporary files, unavailable storage and unknown outcomes block future transfers rather than resetting state.
- The journal is bounded to 10,000 transactions (explicit cap). Recovery runs **before** new transfers during each opt-in World tick. This source-first design prioritizes avoiding duplicate cargo; ambiguous operations can temporarily leave resources unavailable until manual repair.
- The **interprocess writer fence** is `<root>/native-wreck-custody.writer.lock`, created exclusively using `wx`, with file and directory fsync before any native store mutation. Only the owning process releases it after work. A stale lock after a crash is **never automatically removed**; an operator must inspect native source/destination and transaction journals before clearing it. This prevents concurrent EveJS worker processes from debiting the same item simultaneously.

### Integration

- `coopNpcWreckRecovery.cjs`: with collection enabled, native approach continues into a **2 km orbit** until physically within 2.5 km rather than stopping at the previous 5 km inspection radius. With collection disabled, the previous behavior is unchanged.
- `coopVirtualWorldRuntime.cjs`: adds a separate, limited `native-wreck-custody` phase after combat, tactical and physical wreck-recovery checks. Reads the actual *durable* claim journal afresh, refuses work during asynchronous native market processing, and performs at most two native item pickups per 30-second cycle.
- Every native pickup still runs the above independent per-item proof and rights checks. Successful telemetry is `living-npc-wreck-cargo-settled`; refused/repair evidence is separate and contains no invented ISK.
- `scripts/patch-evejs-coop.cjs`: adds one reversible overlay module without modifying pinned upstream EveJS. **No GitHub Actions or CI.**

## Explicit activation gates (default OFF)

```
EVEJS_COOP_VIRTUAL_WORLD=1
EVEJS_COOP_MATERIALIZE_NPCS=1
EVEJS_COOP_NPC_WRECK_RECOVERY=1
EVEJS_COOP_NATIVE_WEAPON_EVIDENCE=1
EVEJS_COOP_NPC_ORDER_ARBITER=1
EVEJS_COOP_NPC_WRECK_TRANSFER=1
# Optional, must point to a persistent writable directory for disposable tests:
EVEJS_COOP_NPC_WRECK_CUSTODY_ROOT=/var/lib/evejs/coop-npc-wreck-custody
```

Do not enable this in a production server until the following acceptance gates have real evidence. The state directory must survive restarts. The default root is `/var/lib/evejs/coop-npc-wreck-custody`.

**No rights bypass:** hostile NPC pirates normally **will not** own the victim's wreck or share its `lootRightCorpID`; those items therefore remain **blocked**. Implementing lawful/illegal stealing with correct native security consequences, suspect timers and counterplay is a *separate* Crimewatch project. Successful wreck approach is not a grant of legal salvage rights.

## Evidence and required game tests

- **18/18** committed custody tests passed in isolated JS (in-memory filesystem): durable source debit, exact cargo credit, type/quantity/owner, repeat and restart, rights rejection, no invented NPC wallet, 2.5-km range, cargo volume cap, pilot uniqueness, active combat, source failure, recovery from confirmed debit, changed owner rejection, corrupt journal, simulated crash between debit and durable marker, stale writer lock and concurrent worker race.
- **12/12** committed native wreck-approach tests passed in isolated JS, including the new 2-km orbit regression (previous 11 + one).
- The exact pinned upstream `nativeNpcStore` API surface (remove wreck item, allocate cargo ID, write cargo, query source and build cargo) was inspected. These tests used native-shaped mocks, **not a live upstream database, real two-client server or replay of actual native files**.
- **Still required:** real `node --test` on pinned checkout, source overlay round-trip, native database failure injection and flush verification, two-client wreck spawn and approach, active player-vs-NPC loot-right adjudication, trade/market concurrency and restart without resource duplication. No native player ISK wallet is credited by these changes.
- Future economic cycle: lawful/Crimewatch-correct loot pickup → actual station travel → seeded native market sale → independently evidenced NPC purchase/repair/replacement; no unbacked ISK.

**Draft only. No main merge, Docker restart, CI or `evejs-data` modification.**
