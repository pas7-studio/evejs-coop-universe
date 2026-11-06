# PF-60 — Original Ship Terminal Custody Handshake (candidate)

**Personal Fleet OFF; native EveJS not patched; no gameplay / WORK acceptance.**

PF59 blocks generic NPC cleanup for original player ships. PF56 docking and PF57 native wreck loss in turn require native entity/controller absence. PF60 is the missing narrow terminal coordination step, not authorization to call generic NPC cascade.

1. `prepare`: in the original `corporationRuntime + items + npcWrecks` `BEGIN IMMEDIATE`, check PF54 ACTIVE, PF58 CONSUMED ship lock, original PF52 reservation/actor claim, real dock item or wreck and immutable independent terminal witness. Commit PREPARED plus a durable terminal-ship fence. Reject unresolved native modules/cargo or live scene actors.
2. `issue`: commit `ISSUING` and dispatchCount=1 *before* calling one **separately provided, trusted, narrowly scoped native cleanup executor**. Never redispatch after an unknown result. The executor must not call PF59-protected generic NPC destroy or touch ItemStore/ISK/wreck; it removes only the exact originally certified native controller/entity while maintaining its own fail-closed authority.
3. `reconcile`: independent physical readback must confirm no original native controller/entity or scene actor, no clone modules/cargo and the same dock/kill witness. Can reconcile an already-absent native row directly from PREPARED (no deletion). Do not synthesize any ship or payment.
4. Native PF56 `reconcileDock` or PF57 `loss` independently releases the original roster and actor claim after their existing strict evidence checks. PF60 does **not** call these operations or bypass their native requirements.
5. `finalize`: after PF56 DOCKED or PF57 LOST, verify native clearance again, ItemStore/wreck, original roster, PF52 index and actor claims. In ONE original GameStore commit, set PF58 ship lock to `null`, write a finalized terminal-ship tombstone and mark assignment FINALIZED. Leave PF58 per-assignment consumed permit immutable. Replays verify the lock/tombstone.

Original ship `itemID` is never recreated or changed; a docked ship can enter another assignment only with a **higher** original PF52 generation and an older finalized DOCK tombstone. The LOST tombstone prevents re-adoption.

## Local tests

```bash
node --test scripts/pf60/tests/pf60-terminal.test.cjs scripts/pf60/tests/pf60-sigkill.test.cjs
```

`Test-PF60-Local.ps1` runs manual tests on Windows; real SIGKILL tests are only supported on Linux/WSL. Node >=22 with `node:sqlite` required. Original native source, scoped cleanup executor, PLAY/WORK, real pilot wallets, stock ammo, and two-client in-game proof are **NOT tested**. Do not merge PR #350 or enable flags from these fixtures.

Local 2026-11-06: **30/30 PASS**, 6 Linux Node child-process SIGKILL tests, SQLite `journal_mode=WAL`, `synchronous=FULL`; the native API remains an injected test double.
