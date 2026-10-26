# LW-04D — Real native EveJS economy E2E readiness

## Status

**LW-04D source instrumentation implemented; physical native integration
NOT_RUN.** Stacked on Draft PR #229 → #221 → #215 → #210 → #207 → #193.

### Newly implemented real original-source custody

- COOP-032B/E `coopNpcIndustryOfflineAtomic` writes
  `industryJobs.coopMaterialDebits` in the SAME existing original
  GameStore transaction as the BPO lock, source mineral decrement and
  corporate ISK debit. Each row contains the original `itemID`,
  `typeID`, `ownerID`, `stationID`, before/consumed/after quantities and
  immutable source `customInfo`. These are NOT virtual items.
- `coopLivingWorldNativeChainProof` is a strict **read-only source
  verifier**, not a game command. It reconciles:
  - ALIFE-07 real asteroid + native miner cargoID GameStore COMMIT;
  - ALIFE-10 original miner → hauler transfer with the same cargoID;
  - ALIFE-09 original station warehouse grant to the actual owner;
  - COOP-031 refinery journal from `coop-warehouse:v1:cargo:<id>`
    to exact source mineral item IDs and type/quantity;
  - COOP-032 native industry job persisted material inputs, produced itemID,
    original corporate debit;
  - COOP-033/035/047 original durable producer SOLD entry,
    Rust FINALIZED fills, buyer ItemStore and wallet receipts attested by
    the already-built strict sale auditor.
- The gate re-reads EVERY custody source after async Rust audit. It never
  mutates original native authority and deliberately reports
  `realNativeE2E:false` even for perfectly shaped fixture evidence.

### Important P0 blocker discovered

The original station-ore grant in `coopNativeStationOreSettlement`
credits the **station warehouse owner**, not necessarily the corporation
that will manufacture ammunition. This is a real ownership distinction.
If the warehouse, hauler and manufacturer owners differ, the new gate
returns `LW04D_WAREHOUSE_TO_MANUFACTURER_TITLE_TRANSFER_NOT_PROVEN`,
not PASS. An independent reviewed original GameStore ItemStore corporate
title-transfer operation is needed for cross-owner production; the gate
must not pretend the item is free or silently reassign it.

The conservative v1 gate requires one isolated mined cargoID from an
initially empty ship cargo stack, plus a refinery output line traceable
to one original mineral itemID. Mixed preexisting cargo, merged ore
stacks, production material lines consumed across earlier jobs and
post-sale item consumption require extended original custody tracing,
not weakened source checks.

### Commands

Node source tests (do not start original server or touch production):

```powershell
node scripts/lw04d-native-readiness.cjs --source
```

Pinned original game checkout / installed overlay and **Rust source
symbol** preflight (read-only, not proof that Rust RPC actually works):

```powershell
node scripts/lw04d-native-readiness.cjs --native-preflight --upstream "D:\\disposable\\evejs\\evejs" --rust-source "D:\\disposable\\evejs\\evejs\\rust"
```

Use your actual isolated source directory for `--rust-source`.
This command checks exact native commit
`c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`, installed `.js`
overlay file equality, and source definitions for six original Rust NPC
market methods. **It does not execute a Rust RPC**, start Docker, open
SQLite for mutation, connect player sessions, or produce an E2E PASS.

Local full source runner:

```powershell
pwsh -File scripts/Run-LW04D-Source-Gates.ps1
```

Every one of the 19 physical evidence scenarios in
`tests/scenarios/lw04d-original-native-e2e.json` starts `NOT_RUN`.
Only explicit real pinned SQLite/Rust + two-client gameplay tests can
change their status. Never mount or overwrite protected `evejs-data`.

### Next remaining implementation

- Create and verify an original ItemStore/ GameStore **title-transfer**
  mechanism for warehouse owner → manufacturing corp where owners differ.
- Build the real pinned original in-process adapter to read mining,
  hauling, station grant, refinery and job rows; use the original Rust
  daemon (not stubbed promises) for sell and fill evidence.
- Execute 19 native fault/cold restart/two-client scenarios with a
  disposable cloned database. Attach concrete logs and original itemID,
  orderID, wallet transaction ID invariants to release evidence.
- Then reconcile staged PRs in dependency order, run CI and consider
  live financial flags. No automatic NPC financial mutation is enabled.
