# Stage J P0 — authoritative NPC salvage delivery into the native warehouse

**Status:** source patch; independent Node 22 runner, real SQLite/GameStore, Docker and two-client EVE gameplay **NOT_RUN**. Default OFF, no live server/world writes.

## Problem

The A-Life rival NPC already performs a physical approach and a native transaction from its original `npcCargo` into real station `items`. However, between the preflight cargo scan and SQLite `BEGIN IMMEDIATE`, it did not recheck some original source identity: `ownerID`, `flagID`, original `sourceWreckID`, source `salvageManifestKey`, and full rival receipt. A missing native `nextItemID` was also silently replaced with a guessed allocator value. Additionally, an optimistic COMMITTED response was logged as a successful delivery without verifying that `itemStore` and the durable movement receipt could actually be read after the commit.

## Fix

- Under the **same native GameStore transaction** that debits `npcCargo`, validate the original ship and item owner, flag 5 and non-singleton stock, source wreck/manifest, all source IDs, quantity/type, and `coopSalvageRivalMoves` `NPC_CARGO` receipt (v1, wreck, manifest, item, NPC, corporation).
- Require the existing native `identityState.nextItemID` allocator to be valid; never invent an ID if it is corrupt/missing.
- Validate the `buildInventoryItem` result strictly, including destination `flagID=4`, quantity/stacksize and singleton=0. Debit the exact source cargo and credit the exact native station item in the existing atomic writer.
- Following a successful COMMIT, read **native** `npcCargo`, `coopSalvageRivalMoves`, and EveJS `itemStore.getAllItems()` through the existing A-Life runtime. Only return `ALIFE_SALVAGE_RIVAL_STOCK_CONFIRMED` when old cargo is gone and the unique destination item/receipt are consistent.
- A post-commit unknown/dirty native index returns `ALIFE_SALVAGE_RIVAL_COMMITTED_NEEDS_RECONCILIATION`, **never** retries stock creation, and is not reported as a confirmed sale or physical pickup. Corrupt/pre-commit source fails closed without minting items.
- No additional scheduler, no invented NPC items/ISK, no changing native market prices, no new overlay hooks. Existing feature flags remain OFF unless explicitly enabled in a disposable world.

## Test evidence

- `tests/coop-salvage-npc-warehouse-original-custody.test.mjs`: 11 in-memory source-backed cases: normal custody, replay, stale postcommit item index, changed owner/wreck/manifest/receipt, missing allocator, malformed output item, in-combat block, flag disabled.
- **11/11 isolated V8 source executions PASS**, including syntax validation of modified runtime. This is **not** the actual Node runner or native SQLite.
- Manual run on an isolated local clone: `node --test tests/coop-salvage-npc-warehouse-original-custody.test.mjs` then `node scripts/coop-test-baseline.cjs`, verify pinned overlay via `node scripts/patch-evejs-coop.cjs --code-path <PINNED_CODE> --dry-run`. **Do not run GitHub Actions.**
- Run actual physical NPC salvage pickup and return with real source wreck on disposable `evejs-data` copy, inspect `npcCargo` debit, unique `items` row, `coopSalvageRivalMoves` receipt, original same NPC entityID and station, and native market eligibility **separately**. Restart and verify same item ID/owner. Inject unknown SQLite ACK and postcommit stale-cache case; only read/reconcile before retries.
- Full physical scenario list: `tests/scenarios/coop-stage-j-npc-warehouse-custody.json`.

## Limitations and next stage

Warehouse custody is **not** native market settlement. Selling salvaged cargo requires a separate corporate sell authority with proper escrow, order ID, real sale wallet receipt and exactly-once crash recovery. Do not assume all `coop-salvage-rival:v1` items are safe to list through player-like orders. Full two-client game proof is still required.

## Rollback

Revert this PR and redeploy only through the pinned transactional overlay installer after explicit operator approval; never reset the persistent `evejs-data` volume. Newly added `readNativeItems` injection is sourced from the existing pinned native itemStore.
