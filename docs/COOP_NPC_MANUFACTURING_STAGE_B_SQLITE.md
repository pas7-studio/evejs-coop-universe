# COOP-032B — Real native industry install, offline transaction proof

**Status:** implemented as an **OFFLINE-ONLY atomic installer proof**. Not plugged into the running EveJS process, not a player-accessible factory, not an industrial scheduler. **Do not run on `evejs-data` or a live `gamestore.sqlite`.**

## Why this is different from the existing player install

Pinned EveJS `industryRuntimeState.installIndustryJob` first calls `takeItemTypeFromOwnerLocation` for each material, then `adjustCorporationWalletDivisionBalance`, then persists `industryJobs`, `industryBlueprintState` and finally moves BPO. `gameStore.flushTablesSync` loops per-table flushes and is **not** a multi-table transaction. A crash in this sequence can strand resources or duplicate jobs. Fake player sessions would bypass industry permissions and add a second security flaw.

Source: `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. Pinned SQLite row key conventions are from `gameStore/sqliteStore.js`: `items` uses direct itemID keys; `corporationRuntime` uses `corporations\u001f<ownerID>`; `industryBlueprintState` uses `records\u001f<itemID>`; `industryJobs` uses `jobs\u001f<jobID>` plus `_meta.nextJobID`. All four tables share **one** `gamestore.sqlite`.

## Implemented code and invariants

`integration/coopNpcIndustryOfflineAtomic.cjs` accepts only an explicitly offline SQLite connection and two independently supplied **trusted native verifiers** (NPC corporation / station and canonical native blueprint/quote). The production server must not provide `offlineExclusive:true` while GameStore is running. It is not exported as `supportsAtomicInstall` and cannot be wired to COOP-032A journal as the live native port.

During one SQLite `BEGIN IMMEDIATE` / `COMMIT`, it:

1. Rejects malformed/changed native quote (materials, single product quantity, cost, tax, production time, owner, real BPO/station/activity); refuses any absent native verifier.
2. Checks an **already existing** real original NPC-owned BPO at station, matching explicit `industryBlueprintState.records`, idle `jobID` and native item flag. Does **not** seed blueprint instances or forge a capsuleer session.
3. Finds existing **real item stacks** with correct `ownerID`, `locationID`, flag, item ID and type, consumes exact blueprint bill in deterministic itemID order, and leaves any remainder. Cannot touch foreign-player items.
4. Checks corporate wallet division `1000` and available balance. Charges native ISK, includes a native-shaped journal transaction, and rejects insufficient funds.
5. Allocates an unused **native industry job ID** from `_meta.nextJobID`, moves BPO to the stock installed location `2003`, updates native BPO state and creates a stock-shaped `industryJobs.jobs` record with the actual endDate and an extra immutable `coopOperationID` and quote signature.
6. On any failure before COMMIT, rolls back **all four tables together**. On repeated `operationID`, returns the original job without another debit. The same BPO cannot serve a second operation.

**Test evidence:** 18/18 local Node 22 tests PASS using `node:sqlite` **real file-backed disposable SQLite** with the pinned native table/row layout. Faults deliberately thrown after BEGIN, after validation, after material writes, after wallet writes and before COMMIT leave every row byte-for-byte unchanged. Two separate SQLite connections see exactly one installed job; missing resources, foreign items, invalid BPO, changed quote/output and changed operation ID fail closed.

## Explicitly still blocked before gameplay

**Live cache coherence:** the running `gameStore/index.js` stores mutable cached tables, dirty row tracking, baselines and a persistence worker; writing behind that cache would corrupt its authority and could overwrite committed transactions. This module deliberately cannot mutate a running server. Next COOP-032B integration must add a **first-class atomic multi-table GameStore operation** which (a) serializes against in-flight persistence, (b) revalidates authoritative in-memory tables, (c) executes one SQLite transaction on the same connection, and (d) updates cache, baseline and dirty-tracking *as one observable operation*. Do not simply `flushTablesSync` or open a second external writer on the live DB.

**Native quote trust:** the offline module requires explicit `verifyNativeQuote` and `verifyNativeOwner`, but this PR does not yet implement the server-bound factory-capability and wallet quote adapter. It MUST reject all unverified quote inputs. Do not accept a player-provided price, time, owner, BPO or recipe.

**Real delivery:** READY -> output item grant, job status transition, BPO restoration and output ownership still need COOP-032C one-write/transaction with replay-safe job ID. `installOnce` only creates an **INSTALLED**, time-gated job; it never fabricates finished ammo.

**Acceptance gate:** only claim a live NPC factory after an isolated GameStore startup with cache-coherent adapter, real corp wallet, native BPO, failed-write fault injection, real READY timer, exactly-once output, Rust sell stock, actual player buy and restart persistence. No Docker or `evejs-data` writes from this PR.