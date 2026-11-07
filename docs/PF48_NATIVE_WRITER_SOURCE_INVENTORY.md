# PF-48 — Native Writer Coverage Inventory (READ-ONLY; NOT a release gate)

Date: 2026-11-05. Target: `pas7-studio/EveJS` branch `coop/pas7std`.
Scope: local source enumeration / tamper-evident inventory only. **Not native gameplay integration.**

## What PF-48 does

- Looks only inside `<fork-root>/Code/server/src` and only reads `.js`/`.cjs` files (with git `rev-parse HEAD` read-only). It does not run the game, compile the fork, open databases or touch Docker/PLAY.
- Inspects 17 known authority/competing-writer source paths and expected interface anchors, including stock `miningNpcOperations`, ALIFE-08 durable startup/restore, ore settlement, haul transfer/custody/station arrival, player mining shifts, exploration, WAR, native gate transfer and order arbiter/bridge.
- Conservatively searches relevant source files for native mutation call sites; records file path, line number, API-shaped pattern and per-file SHA-256. The audit fingerprint covers **all inspected JS/CJS files**, sorted by path, not only known paths.
- Detects source drift, omitted critical files, missing native PF45/46/47 components, unreadable or oversized files and symlinked paths.
- Always returns `status: BLOCKED_FOR_ACTIVATION`, with `releaseAuthority: false` and `gameplayProven: false`. Detection of a string/anchor is **not** evidence that a writer is correctly fenced.

## Usage: Windows PowerShell

From `evejs-coop-universe` on the PF #350 branch:

```powershell
node --test tests/pf48-native-writer-audit.test.mjs
node scripts/personal-fleet-audit-native-writers.cjs --fork-root 'C:\Games\EveCoop\upstream-evejs' > .\pf48-native-inventory.json
$LASTEXITCODE  # 2 = source inventory completed, but activation BLOCKED (expected)
```

Error codes: `2` audit completed but native ownership remains unproven; `3` invalid/missing source or scanner error; `64` wrong command line. There is deliberately **no exit code 0 for activating Personal Fleet**.

## Audited upstream evidence (read through connected GitHub)

Fork branch: `pas7-studio/EveJS@coop/pas7std`, tree SHA `9de4f74868f226451cd1c75ef5be00d4bd7c4851` at inspection time.
Relevant verified source:
- `Code/server/src/services/mining/miningNpcOperations.js`: stock `spawnFleetWing`, native cargo upsert/remove.
- `Code/server/src/space/coopNativeMiningFleetDurable.js`: durable `npcEntities` slot writes, entity/controller upserts, native materialization.
- `Code/server/src/space/coopNativeMiningAtomic.js`: `miningRuntimeState + npcCargo` atomic ore mutation.
- `Code/server/src/space/coopNativeHaulTransferAtomic.js`: `npcCargo` native transfer.
- `Code/server/src/space/coopPlayerMiningShiftOrders.js`: separate atomic shift-order transaction.
- `Code/server/src/space/coopWarFleetRegistry.js`: WAR's exclusive `corporationRuntime` claim transaction.
- `Code/server/src/space/coopGameStoreAtomic.js`: original `BEGIN IMMEDIATE`, `synchronous=FULL`, poison on uncertain COMMIT, gameStore adapter.

**Integration challenge**: adding `corporationRuntime` to existing mining and mixed-transient `npcCargo` transactions is not necessarily safe with the current `coopNativeCargoTransientIsolation` table-contract matching. A simple `beginPermit` followed by an out-of-transaction check cannot prove ownership. The actual original writer must be fenced in the same serialized authority as its effects, or the lease must remain protected by a proven pending permit until all original writers are quiescent.

## Next required native work (P0)

1. In local PF-43/44/45 source, identify and verify the exact PF44 lease key, status transition and native audit API. There is no PF45 module at the inspected fork path. Do not synthesize one from a reference test stub.
2. Attach the authoritative state machine to all explicit paths in this report, then search all discovered possible writers and delayed callbacks to add per-path runtime proof.
3. Extend original atomic cargo isolation contracts with regression coverage before mixing ownership rows with mining/haul rows.
4. Implement native controller shutdown plus independent, restart-safe proof and prohibit stale callback writes.
5. Under WORK, perform two concurrent claimants/2-process recovery, real SQLite `SIGKILL` crash matrix, cargo/wallet identity audit, two-client gameplay.

No merge to main and **no PLAY deploy** until these gates pass. Feature flags default OFF; PF-42 mutual-exclusion restriction stays in force. This file and the scanner are diagnostics only.