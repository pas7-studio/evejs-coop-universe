# Chat 25 — real player ore custody and crash-safe native reprocessing slice

**2026-10-25 | CODE_READY / LIVE_UNVERIFIED | feature default OFF.**
EveJS pinned upstream: `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.
This is a limited, fail-closed **native integration**, not full co-op logistics certification.

## Verified upstream custody chain

- `miningRuntime` and `miningCommandService` create real inventory items from actual resource sites (player mining is Chat 24's authority).
- `jettisonRuntime.jettisonItemsForSession` creates a real jetcan in the player's solar system and moves owned ship-hold items through original `itemStore.moveItemToLocation`. The container is created **before** item moves and each move is independent; a crash between these steps is **not atomic**. No claim of exactly-once jettison is made.
- `invBrokerService` and `itemStore.moveItemToLocation` / `transferItemToOwnerLocation` own genuine player cargo, legal loot and station inventory transfers. Fleet membership does **not** itself grant inventory permissions. Stock paths are untouched by this slice.
- Compression via `inSpaceCompressionMgrService` and `structureCompressionMgrService` updates actual item type/quantity in `itemStore`; no alternate compression economy is introduced. These original writes have no new durable crash receipt in this slice.
- `reprocessingRuntime.reprocessItems` is **not failure-atomic**: it debits character ISK, consumes individual input stacks, then grants mineral outputs. `reprocessingService.materializeOversizedSelectionsForReprocess` may also split original stacks before entering `reprocessItems`. Retrying after crash can therefore lose or duplicate resource movements if treated as a single transaction.

## Changes (opt-in safe personal-station single-stack reprocessing)

1. `integration/coopPlayerOreReprocessing.cjs`: a server-only entry point that reads real docked EveJS character context and one real personal station-hangar source `itemID`. The quantity and native SDE-derived quote from `reprocessingRuntime.buildReprocessingQuoteForItem` determine the consumed ore, leftovers, material types and amounts. No second inventory, synthetic client object, fabricated ore/material/position, or fee change.
2. `scripts/coop-player-ore-atomic-patch.cjs`: three reversible transformations at pinned native sources, **not registered in central installer**:
   - `services/station/reprocessingService.js`: a one-line default-OFF hook bypasses the *pre-reprocess split mutation*; accepts one unsplit itemID only.
   - `services/reprocessing/reprocessingRuntime.js`: a one-line default-OFF hook dispatches the reprocessing action to the verified coordinator.
   - `services/inventory/itemStore.js`: internal-only `coopPlayerOreReprocessAtomic(plan)` uses original cached items, metadata, itemID allocator and a **single items-table write plus synchronous native flush** for ore debit and material credit. The original input ID remains reserved until output itemIDs are allocated. All output inventory records are real original GameStore items with exact owner, location, flag, quantity and tagged provenance; source leftovers retain original ID.
3. The coordinator writes an fsync'd `PREPARED` receipt **before** any native mutation, then verifies every new native material row and remaining original ore before marking `COMMITTED`. Unknown flush, missing material, crash or replay returns an explicit operator-reconciliation status **without repeating native writes**.
4. An explicit `review({operationID,authorize:true})` performs **read-only** native station inventory reconciliation; it can mark an already-executed mutation `COMMITTED` only after exact real itemIDs, types, owners, quantities, remaining source and customInfo are independently proven. It cannot grant or restore stock.

### Payment and supported input limits

- Native `quote.totalISKCost` must equal **0**. Any positive/negative ISK debit or structure tax transfer not modeled inside a shared durable wallet+items transaction is rejected with `PLAYER_ORE_ATOMIC_WALLET_TAX_REQUIRED`. Native material deductions already reflected in actual `quote.recoverables[].client` are **not** artificially bypassed. **Do not enable globally** for customers requiring taxed reprocessing.
- Only **one** full, real, non-singleton stack owned by the authenticated player in that player's docked **personal HANGAR** can be processed per RPC. Multi-stack, mixed player/corporate output, remote station, unsupported randomized recipes, or different output owner/flag is rejected before mutation. This is deliberately narrower than standard EveJS reprocessing. Excessive material quantities are rejected by the native helper before any items-table write.
- All IDs come from original `itemStore.nextItemID`; split/new output rows are not drawn from virtual NPC cargo stores. Receipt filenames are derived solely from validated original numeric IDs.
- The new exported itemStore method is accessible only through the **server's internal module**. The in-game client has no new direct RPC.
- Operator must configure an **absolute path** `EVEJS_COOP_PLAYER_ORE_RECEIPTS_DIR` on the same durable server volume as the world (not `/tmp`). The process must have exclusive ownership of that path. Multiple operating-system writers to one inventory table are not certified.

## Chat 01 overlay integration handoff

Chat 01 owns `scripts/patch-evejs-coop.cjs`, deployment and the shared one-statement hook budget. This commit does **not** edit that installer. After reviewing upstream and any concurrent changes, Chat 01 should:
1. Copy `integration/coopPlayerOreReprocessing.cjs` to `Code/server/src/space/coopPlayerOreReprocessing.js`.
2. Chain `scripts/coop-player-ore-atomic-patch.cjs.patch(source,relativePath,remove)` for the three native source paths **under the pinned SHA**. Use the same transactional overlay install and byte-exact rollback. Do not manually patch the running tree.
3. Run dry-run, drift-check, full overlay roundtrip, disposable SQLite tests and client RPC tests with default flag OFF.
4. Enable `EVEJS_COOP_PLAYER_ORE_ATOMIC=1` **only in a disposable world** with receipt path configured, after verifying that supported client UI calls the exact native RPC and that zero-ISK-cost quotes exist for the chosen native ore.

### Direct tests completed in this chat

- 8/8 source-backed reprocessor test scenarios executed using actual module source with a V8 harness and an in-memory filesystem. Tests include one exact real item source -> mineral itemID/owner/readback, positive ISK fee deny, foreign actor deny, multi-stack deny, randomized recipe deny, failed PREPARE fsync, unknown mutation after restart, crash after native write and proof-only receipt recovery.
- 4/4 patch regression scenarios PASS with LF/CRLF roundtrip, drift rejection and default-OFF hooks; also byte-exact **read-only** patch/remove + source syntax verified on all three original pinned upstream files.
- The official Node test suite and real EveJS SQLite/GameStore with two client sessions were **NOT RUN** here. The native helper was syntax-checked against pinned source; unit test mocks are not physical mining or inventory evidence.

## Mandatory end-to-end gate (NOT RUN)

Use `tests/scenarios/coop25-player-ore-haul-refine-e2e.json` on an authorized **disposable** upstream world:
A mines a real ore site; A jettisons the original ore items; B loots through the stock legal loot/inventory interface, respecting ownership and capacity; B docks and unloads to their own station hangar; B optionally compresses via native UI; B reprocesses one stack with a truly zero-ISK-cost native quote; both players independently inspect actual inventory and output quantities. Cold restart and reconnect **between every two stages**. Verify exact source itemIDs or a legitimate native split ID with `stackOriginID`; never equate mere matching ore type to ownership. Check material output owner B, reprocessing expense 0, original ore remainder, real resource site depletion, legal jetcan closure and no duplicated cargo. Repeat same RPC after crash and verify repair gate.

Other hard blockers before declaring `GAMEPLAY_READY`:
- No single atomic transaction currently covers stock player **jettison**, third-party loot, ship-to-ship transfer, compression, station inventory unload or wallet taxes. These must be implemented/tested by their owning streams, or put behind their own durable receipts.
- The stock native ReprocessingService may return client-specific errors/notifications; these must be verified against a real EVE client rather than inferred from a synthetic response.
- This slice has no fleet cargo routing/autopilot, native compression crash journal or general taxed, randomized, multi-stack reprocessing.
- The original `GameStore.flushTableSync('items')` is used, but full power-loss proof and on-disk SQLite cold restart are still required; a positive return is not two-client gameplay evidence.

**Do not mark the full user-requested co-op mining → hauling → refining pipeline complete yet.** All unsafe paths explicitly remain unverified, with the initial native reprocessing hardening staged for central integration.
