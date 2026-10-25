# LW-04E — Paid original NPC warehouse → manufacturer ore title transfer

**Status:** Source implementation completed as a **manual, feature-OFF**
original GameStore single-writer adapter. Stacked on LW-04D Draft PR #239
→ #229 → #221 → #215 → #210 → #207 → #193. No live gameplay financial
flag enabled. No new shadow economy or NPC market writer.

## What was actually implemented

1. `coopNativeStationOreSettlement` gains
   `EVEJS_COOP_NATIVE_WAREHOUSE_ORE_SOURCE_PROOF=1` strict ALIFE-09
   mode. It still calls the ORIGINAL native
   `itemStore.grantItemToOwnerLocation` under its original durable
   grant-before-write journal. In strict mode, the granted item must
   appear as **one physical, separate, native itemID** with
   `customInfo=coop-warehouse:v1:cargo:<cargoID>` and the exact cargo
   quantity, owner, hangar, type and station. Only then does the
   durable ALIFE-09 journal record `oreItemID` and `sourceCustomInfo`.
   If original ItemStore ignores customInfo or merges the source stack,
   the durable journal remains `GRANT_OUTCOME_UNKNOWN`. There is **no
   automatic second grant** and no invented item ID. Existing legacy
   delivery behavior is unchanged while this new flag is OFF.
2. `coopNpcOriginalWarehouseTitleTransfer` is a NEW manual adapter
   that reuses the **existing** `gameStore.coopAtomicNativeRows.transact`
   single SQLite writer with two existing tables: `items` and
   `corporationRuntime`. Requires genuine source ALIFE-09 completed
   oreItemID+marker, verified original NPC corporations/station,
   synchronous server-authorized operator grant and trusted native
   positive-cent quote. In **one original SQLite COMMIT**, it changes
   the owner's field of exactly one original ItemStore row, debits the
   purchasing NPC corporation's real wallet, credits the warehouse
   NPC corporation's real wallet and writes reciprocal
   `transactionID=coop-warehouse-title:v1:<cargoID>:<buyerCorpID>`
   transactions/journals. Persists a source-bound transfer receipt under
   `corporationRuntime` key `coopWarehouseTitleTransfer\u001f<cargoID>`.
   The receipt is unique per cargo source. No new itemID, player session,
   wallet mint, currency authority, scheduler or independent Rust writer.
3. Replay reads the single native committed receipt and both historical
   wallet transaction journals. A prior transfer might already have
   been refined (original ore item deleted), so it returns
   `ALREADY_TRANSFERRED` without reissuing any cargo or ISK.
   GameStore cache poison, conflicting receipt, same-cargo duplication,
   unverified seller authority or unknown COMMIT ACK all fail closed.
   Unknown outcomes are quarantined in-process for manual recovery.
4. The **read-only** `coopLivingWorldNativeChainProof` now permits
   a different physical warehouse owner **only if** the actual original
   ALIFE-09 station grant contains the same `oreItemID` and original
   cargo marker, plus a committed `coopWarehouseTitleTransfer` receipt
   with exact original item, type, both corporate IDs, price conservation,
   and two independently verified original NPC wallet journals. The
   title receipt and both wallets are re-read after the Rust async
   sale audit to reject races.

## Gating and known native compatibility blocker

The transfer requires ALL three flags:

```text
EVEJS_COOP_NATIVE_ATOMIC_ROWS=1
EVEJS_COOP_NATIVE_WAREHOUSE_TITLE_TRANSFER_PROOF=1
EVEJS_COOP_NATIVE_NPC_CORP_TRANSFER_PAYMENT_PROOF=1
```

All default OFF. Also prohibit A-Life economy ACT, independent NPC
market and NPC economy scheduler.

The ALIFE-09 original item grant may merge inventory or may **not**
honor `customInfo` in options on the pinned native ItemStore.
The source verifier explicitly detects this and refuses the transfer;
this is **NOT verified as supported by the pinned live itemStore**.
The source-only test exercises the intended native response contract,
not the real pinned server. A source patch to the stock ItemStore may
still be required on the original checkout; no claims of native success
until actual ItemStore, SQLite and Rust tests run.

Only whole, unmerged ore stacks and synchronous trusted server grants
are admitted. Split/merge cross-owner stock and tax/fee schedules
require separate original native financial contracts. This does not
register a user-facing transfer command or enable A-Life purchases.

## Source regression and practical local commands

Run all previously integrated original source tests + new warehouse
source and title tests:

```powershell
node scripts/lw04d-native-readiness.cjs --source
```

Or dedicated:

```powershell
pwsh -File scripts/Run-LW04E-Warehouse-Transfer-Gates.ps1
```

Pinned read-only preflight:

```powershell
node scripts/lw04d-native-readiness.cjs --native-preflight --upstream "D:\\disposable\\evejs\\evejs" --rust-source "D:\\disposable\\evejs\\evejs\\rust"
```

The actual paths must be replaced with the developer's disposable
native checkout. Preflight never executes original SQLite/Rust RPCs.

**Tests:** 16/16 new atomic transfer callbacks, 22/22 original full
custody chain callbacks, 10/10 existing + new strict station grant
callbacks PASS in an isolated exact-source JS harness. The original
repo Node/SQLite/Rust process and two authenticated clients were
**NOT_RUN**. Fifteen physical end-to-end scenarios remain `NOT_RUN`
in `tests/scenarios/lw04e-original-warehouse-title-e2e.json`.

## Next real integration and merge dependency

1. Verify whether the exact pinned native ItemStore grant supports a
   dedicated `customInfo` item source without accidental merging.
   Patch the stock grant path only if source verification demonstrates
   the option is ignored.
2. Execute the true GameStore SQLite transactor on a disposable pinned
   checkout, prove reciprocal wallet entries with actual WAL and
   post-restart original ItemStore cache consistency.
3. Verify a live Rust NPC corporate sale and two client sessions for
   the same cargo→refinery→BPO→order→payment lineage.
4. Merge the stacked PRs in dependency order only after source CI and
   native release gates; keep finance flags OFF otherwise.
