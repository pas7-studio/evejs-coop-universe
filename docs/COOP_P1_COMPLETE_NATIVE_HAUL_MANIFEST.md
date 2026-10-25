# P1: native hauler COMPLETE cargo manifest / exact station custody proof

## Why this is needed

The previous stock fleet station-route controller (PR #40) could return `DELIVERED` after any nonzero sequence of native warehouse `deposit` successes without an immutable record of **all original cargo IDs** loaded before departure. That is not sufficient to classify an escort convoy as saved, nor to authorize a paid native contract.

This change is **stacked on PR #40** and adds `integration/coopNativeHaulManifest.cjs` plus a default-OFF native station-route gate. It does not require PR #48/53 to execute the warehouse logic. The future convoy-incentive path must cross-reference this proof with PR #48 combat incidence and PR #53 observed station cargo/loss receipts by exact native ship and cargo IDs.

## Source truth and no imaginary goods

1. `coopNativeStationArrival.start()` verifies physical durable NPC haulers and genuine same-system NPC-owned SDE station; both `npcEntities` and `npcCargo` tables are flush-acknowledged.
2. **Before sending any native warp order**, `coopNativeHaulManifest.prepare()` reads native `npcCargo` for **all** haulers of that specific fleet. Each recorded stack has a real unique `cargoID`, native `entityID`, fleet ID, real originating miner ID, SDE type ID and exact positive quantity. Invalid, duplicate, foreign, transient or ambiguous cargo refuses departure in this mode.
3. The full expected cargo manifest is created exclusively with `O_EXCL`, file `fsync`, and containing-directory `fsync`. Same system/fleet/start timestamp cannot be overwritten; ambiguous write/durability leaves the trip stopped and the file for inspection. Journal is persisted under `/var/lib/evejs/coop-native-warehouse/trip-manifests/`.
4. The game still drives physical warps. Each hauler must actually reach the exact station surface and complete the existing native dwell test. During the trip, an unmanifested new cargo stack cannot be silently passed into `factory.deposit`.
5. After **all original** warehouse deposits, `manifest.verify` reads the immutable full manifest, checks exact same hauler/fleet/station/corporation/system, checks all source `cargoID` rows are now absent, and for **every original cargoID** requires a native warehouse receipt `phase:COMMITTED` matching hauler/type/quantity/owner/station/fleet, plus an exact existing tagged `itemStore` station stock item. Missing one stack or a modified item/receipt refuses full delivery.
6. Only then may `coopNativeStationArrival.tick()` return `{status:'DELIVERED',nativeFullManifestProof:{status:'FULL_NATIVE_CARGO_DELIVERY_VERIFIED',...}}` (real native movement still governs arrival). The manifest proof sets **`convoySaved:false`, `paidReward:false`**. Cargo settlement is not a wallet or mission payout.
7. When the flag is OFF, the existing native station route is unchanged and **does not** automatically assert this new full manifest proof.

## Failure/recovery policy

- A native warehouse error cannot be smoothed over by a later empty-hauler tick. If cargo was lost, one exact warehouse receipt is missing or the resulting itemStore stock differs in identity, the director does **not** return `DELIVERED`.
- A power loss after the manifest was fsynced, during warp, or while executing a native warehouse debit leaves independently inspectable cargo and receipt files. The in-memory route itself is **not replayed from disk** on this PR; no restart automatically implies arrival or permission to award ISK.
- If storage does not support directory `fsync`, the opt-in gate refuses to declare a durably prepared manifest. The Windows source-test harness uses injected sync-capable FS; there is no false durability claim on unverified production mounts.
- The immutable manifest **never creates** cargo, NPC items, station stock, market orders, a wallet/LP transfer, a forced warp, a rescue result, or fake telemetry. It only validates genuine EveJS source and existing `coopNativeWarehouse` COMMITTED custody.

## Operator and test gates

Default OFF. Owner may explicitly enable `-LivingCoop -EnableNpcStationDelivery -EnableFullHaulManifest` in the existing operator deployment script; enabling the manifest without physical station delivery is rejected.

Recommended local checks:

```powershell
node --test tests/coop-native-haul-manifest.test.mjs tests/coop-native-haul-manifest-station.test.mjs
node --test tests/coop-native-station-arrival.test.mjs tests/coop-native-station-arrival-patch.test.mjs
node scripts/patch-evejs-coop.cjs --code-path C:\Games\EveCoop\upstream-evejs\Code --dry-run
```

**Current evidence:** 12/12 immutable source-manifest, missing/altered warehouse, duplicate/corruption and replay tests plus 6/6 physical-station integration scenarios PASS in isolated JS/V8. New official Node tests exist, but full local Node runner, Windows Docker, pinned native client World and two actual clients are **not** yet proven. Do not claim deploy readiness.

## Release acceptance and dependencies

Needs PR #40 physical native NPC hauler station approach/warehouse flow, with its actual pinned native mining patch and GameStore custody. For the end-to-end co-op escort operation, also combine PR #48 (actual two authenticated pilots vs the same physical pirate), PR #53 (verified real cargo/loss attribution), and this manifest proof. A successful paid escort additionally requires an authorized pre-funded native NPC or corporation wallet and crash-fenced, replay-safe non-minting transfers. **No payment path is implemented here**.

No main merge, Docker restart, `evejs-data` reset/change, GitHub CI or production wallet/item mutation performed.
