# P0 — Native PvE wreck loot conservation audit

**Base:** post-global-merge `main` `1d71e7fac47ab28dfead53ba7b63482d37e1df41`.

**Scope:** strengthen the read-only `scripts/coop-pve-chain.cjs` report. This is **not** a new loot system, item grant, bank transaction, NPC reward or player-side gameplay implementation.

## Root cause

The previous PvE chain considered a JSONL row with `status: VERIFIED_NATIVE_LOOT_PICKUP`, wreck/item IDs, character and quantity sufficient for loot participation. It did **not** require the actual inventory-evidence contract already produced by `coopNativeLootPickupEvidence.verify()`: a saved source debit, authoritative destination/ownership and **remaining native wreck-item quantity**. Replayed or contradictory rows for one native item could be counted as two independent looters even if the same inventory stock was debited twice. The report never touched game state, but its positive result could overstate what the evidence proves.

## Implemented

`nativeReceipt(event)` now accepts only the exact producer contract: `event=living-native-loot-pickup`, `status=VERIFIED_NATIVE_LOOT_PICKUP`, `evidence=NATIVE_GRANT_SUCCESS_PLUS_PHYSICAL_WRECK_AND_POST_TRANSFER_SOURCE_STORE`, valid native source/wreck/item/character/ship IDs, positive `typeID` and `destinationLocationID`, positive integer `quantity`, and a non-negative safe integer `remainingQuantity`.

`nativeLootConservation(receipts)` then checks every source-debited receipt, in event order, by **`systemID:wreckID:wreckItemID`**:

- The first receipt establishes its post-debit residual; the producer already checked the pre-transfer quantity in authoritative native item state.
- For each next receipt of that *same item*, `prior.remainingQuantity - next.quantity === next.remainingQuantity`.
- A depleted item cannot be granted again; a changed `typeID` or native `sourceEntityID` for the same item is a conflict.
- Independent wreck items are tracked independently; splitting an item stack between two distinct authenticated pilots is **valid** when remaining quantities reconcile.

A contradictory proof from the **same matched physical wreck/source** returns `NATIVE_LOOT_CHAIN_INVALID`, not `BOTH_PILOTS_LOOTED_SAME_NATIVE_WRECK`. The report does not expose raw character IDs or wallet/inventory contents, does not mutate source data, and still keeps `gameplayVerified=false`, `combatParticipationVerified=false`, `missionProgressVerified=false`, and `clientRenderingVerified=false`.

The original `tests/coop-pve-chain.test.mjs` was already included in `Verify-Local-Coop.ps1`; all conservation regressions were added **inside that existing registered suite**, avoiding a change to the shared verifier currently also modified by PR #13.

## Verification

Using the **actual GitHub-committed** report code and consolidated tests in an isolated V8 JS harness:

- **24/24 assertions PASS** (14 original PvE-chain tests plus 10 new conservation tests).
- New tests cover two distinct items; valid shared partial stack; same full-stack duplicated by another player; impossible residual; late replay; missing authority/evidence/type/destination/remaining; wrong system/source/wreck; false ghost looter; and independent item ID handling.
- No formal Node `node --test` run, pinned EveJS runtime, live Docker event file, native persisted item store, or two game clients were available in this environment. These remain explicit acceptance gates.

### Operator validation after authorized deployment

```powershell
node --test tests/coop-pve-chain.test.mjs

# Read-only on an already running approved server:
docker compose exec -T server cat /var/lib/evejs/coop-events.jsonl |
  node scripts/coop-pve-chain.cjs --window-minutes 120
```

Require two real clients, authenticated players, physical native pirate wreck, independent item pickup to player-owned inventory, source-item debits including valid partial-stack transitions, and a corresponding persisted record after reconnect. Check **P0 mission credit and both players' actual combat contributions separately**; this report intentionally cannot prove those or player-visible UI.

**No deployments, main merge, Docker restarts, data resets, volume changes, user inventory writes or remote CI.** PR #12 reliability long-uptime and PR #13 live looter-session proof remain independent; this code does not alter their files.
