# Stage J — durable RESCUE payout history after NPC inventory turnover

**Task:** Stage J native RESCUE history integrity. **Status:** source patch; full local Node/SQLite and two-client gameplay **NOT_RUN**. All feature flags remain default OFF.

## Defect

Previously `createSalvageNativeRewards.history` re-checked that every paid salvage item was **still** in the NPC corporation warehouse. A legal NPC sale, refining job, or consumption could move or remove that item. The already-committed native wallet payout remained final, but `/events history` could lose the player's legitimate RESCUE record and reputation. This is a historical-vs-current-custody mismatch, not proof of fraud.

## Settlement contract

`coopSalvageNativeRewards.settle` already requires the real original manifest, two independent signed native pilot accepts, corporate escrow, exact original wreck debit, GameStore `DELIVERED` move receipts, and original station stock before it credits either player. This patch additionally stores one `deliveryProof` array **inside the same GameStore transaction** that marks escrow `SETTLED` and updates both native character wallets.

Each entry binds manifestKey, cargoID, wreckItemID, nativeItemID, typeID, quantity, original character and ship, destination corporation and station. IDs must be unique; source records and physical station verification are still mandatory **before** issuing a new payout.

## Historical verification

For new `SETTLED` escrows with a sealed delivery proof, history verifies every proof row against the persisted settlement rows **and** the independently retained `coopSalvageMoves` GameStore receipt. It does **not** require the item still to occupy the original station warehouse. An NPC may subsequently trade, consume, or move that stock without erasing the paid character's historical earnings.

For older `SETTLED` escrows without a `deliveryProof`, the previous strict current-warehouse validation remains. No retroactive proof creation, inferred credits, or automatic wallet edits. Missing/mismatched current receipts or corrupt sealed evidence fail closed with an explicit history error. Refunds remain unchanged. `/events history` displays server-derived records, not client-supplied scores.

## Verification

- `tests/coop-salvage-native-corporation-escrow.test.mjs`: 11 source-backed in-memory scenarios, including persistent reputation after legitimate stock consumption, no double payment on replay, legacy fail-closed behavior, and invalid/missing receipt detection.
- This change passed 11/11 isolated V8 source execution checks with a mock crypto hash and in-memory GameStore. **Not** an actual Node runner, actual SQLite, Docker, native EveJS client, or GitHub CI.
- Before merge, on an isolated local checkout: `node --test tests/coop-salvage-native-corporation-escrow.test.mjs`, `node scripts/coop-test-baseline.cjs`, and pinned overlay `--dry-run` / `--check`. The owner prohibits GitHub Actions.
- On a disposable authorized world with two independent EVE clients: fund real RESCUE escrow, independently accept with both pilots, take original wreck stock to the authentic ship, dock at the correct station, deliver all stacks, verify each real wallet changes **once** and `/events history` records the rescue. Only **after** settlement, let the NPC lawfully sell/consume the recovered item. Repeat `/events history` and reconnect both clients. Verify the recorded payout/rep remains unchanged and no new ISK is credited. Also test ambiguous commit response and server restart without resetting `evejs-data`.
- Do not hand-edit a running GameStore to emulate a sale; a production-world sale/consumption scenario is **NOT_RUN**.

## Rollback

Feature remains OFF unless explicitly enabled on a disposable test world. Revert this PR to restore the previous strict live-stock history behavior; the new `deliveryProof` field is additive and does not change existing escrow or item ownership. Preserve all persistent world volumes and receipts.
