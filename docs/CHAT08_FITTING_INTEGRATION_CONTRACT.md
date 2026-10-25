# CHAT-08 — Native fitting / Dogma integration contract

Status: CODE_READY / LIVE_UNVERIFIED / CENTRAL_HOOK_BLOCKED.

Source: pinned gameboys84/EveJS `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.
Base co-op observed: `bb3ff00dcf3605c5b6ff7bdf5bd01e4b47be1adb` (2026-10-25; re-check origin/main immediately before integration).

## Confirmed defect 1 — zero available module slots

`Code/server/src/services/fitting/liveFittingState.js:getSlotFlagsForFamily()` does:

```
const limit = toInt(slotCounts[family], 0);
return limit > 0 ? baseFlags.slice(0, limit) : [...baseFlags];
```

For a concrete ship with 0 high/med/low/rig/subsystem/service slots, native code returns all 8 flags, bypassing hull capacity in `validateFitForShip`. Missing/invalid slot-count metadata also becomes 0 and silently allows fitting. This is *source-confirmed*, not proven with a client.

Chat-01 contract: register `integration/coopNativeFittingSlotGuard.cjs` as `server/src/space/coopNativeFittingSlotGuard.js` in the single installer, and register `server/src/services/fitting/liveFittingState.js` as a new native spec. Wire `scripts/coop-native-fitting-slot-patch.cjs` into `transform()` exactly once. The helper inserts a single opt-in statement immediately after the unique `const limit = toInt(slotCounts[family], 0);` inside `getSlotFlagsForFamily()`, and reverses it byte-for-byte. Feature flag: `EVEJS_COOP_FITTING_SLOT_GUARD=1`; **default OFF**, no deploy flag should set it automatically.

Additional checks for Chat 01: pinned `--dry-run`, `--check`, apply twice, remove, full native roundtrip with both LF and CRLF, and no stale imported module. Real client tests with ships having 0 and nonzero slot family counts, a fitted module online/offline, relog and switch ships. Confirm pinned SDE really populates the slot counts. Do not enable on an existing world before that verification.

## Risk 2 — FitFitting item/ship source authorization

`Code/server/src/services/inventory/invBrokerService.js:Handle_FitFitting()` uses a globally resolved `itemID` through `_findTransferSourceItem(itemID,sourceLocationID)`. Unlike `Handle_Add`, the inspected section does not explicitly call `_isTransferSourceLocationMatch` / `_canTakeFromCorporationHangarSource` before the move. It has destination service checks and native fit validation, so this is a **potential authorization gap**, not a confirmed exploit.

`integration/coopNativeFittingSourceGuard.cjs` supplies a deliberately strict *personal ship / personal item* fence, with no inventory writes. It rejects other owners, native wrecks, insufficient source-location proof, unchecked ship access and malformed stacks. Before enabling, Chat-01 should insert **one default-OFF guard** into `Handle_FitFitting` after resolving the source descriptor and before constructing the destination, passing verified native inputs:

- `characterID`: `_getCharacterId(session)`
- `ship`: the source-resolved `shipRecord`
- `descriptor`: `sourceItemDescriptor`
- `sourceLocationID`: RPC origin; must match the actual item via `_isTransferSourceLocationMatch`
- `sourceLocationVerified`: `_isTransferSourceLocationMatch(sourceItemDescriptor,sourceLocationID)`
- `sourceAccessVerified`: only an authoritative session/ship/container permission decision, not possession of the itemID
- `shipAccessVerified`: `Boolean(findCharacterShip(characterID, shipRecord.itemID))`

If `allowed !== true`, deny **before** calling `_moveSourceItemToDestination`, without decrementing/reparenting any item. Do not enable this strict personal-only guard for corporate hangar fitting, docked structure fitting or in-space depot fitting until their native permission semantics have separate positive tests. Don't substitute a virtual owner registry.

## Additional review findings

- Native `validateFitForShip`: required skills, slot family, max type/group fitted, rig size/calibration, hardpoints; an invalid zero slot count is a meaningful gap.
- Native `resolveFitOnlineState`: online modules check CPU and powergrid; overbudget fits are left offline, not rejected. This preserves the supported fitting behavior. No evidence yet that all 2026 ship/skill bonuses match a modern client.
- Native `invBrokerService.Handle_FitFitting`: resolves existing item IDs and returns missing-by-type, rather than minting missing modules. Direct ownership and cross-location behavior require live negative tests.
- Native `fittingStore`: saved presets are not physical module grants; `saveManyFittings` persists separate owner records. Separate regression needed for negative saved quantities, two independent owner scopes and atomic crash/replay.
- Native `fittingIntegrity`: loaded incompatible/orphaned charges are moved to ship cargo during parity repair. A failed move is recorded but rollback behavior/reconnect client state still require running-server validation.

## Local test coverage

`node --test tests/*.test.mjs` within this isolated Chat-08 bundle: 25 PASS, 0 FAIL. Includes six slot families, zero/positive/invalid counts, cross-ship independence, source/ship ownership isolation, missing items, 2-pilot separation, hook idempotence and LF/CRLF roundtrip on a source-shaped fixture. These are **not** native pinned server integration tests or real two-client evidence.

## Required live acceptance

1. Chat 01 integrates both hooks with flag defaults OFF, then runs pinned disposable `--dry-run`, apply/remove/roundtrip. No existing world or volumes touched.
2. Review and verify exact SDE attribute keys, including truly zero slots; make sure no unknown counts accidentally block supported ships.
3. On a disposable pinned instance, fit/unfit rigs, charges, low/medium/high modules and change slot layouts; verify CPU/PG, online state, skill bonuses, turret/launcher hardpoints and absence of duplicates.
4. Test genuine character A and B with separate ship IDs and inventory: wrong itemID, wrong source location, wrong owner, corporation hangar with/without roles, mobile depot, available/missing charge stacks, repeat requests and restart.
5. `SaveFitting` / `SaveManyFittings` only changes native presets. `FitFitting` must never create modules from missing inventory; restart preserves active fitted item IDs and cargo quantities.
6. Real authorized clients observe consistent server fitting and Dogma. Without these steps: `LIVE_UNVERIFIED`, not gameplay PASS.

This bundle deliberately does not change `scripts/patch-evejs-coop.cjs`, `Deploy-Coop-RuntimeProbe.ps1`, or any running service; those are Chat-01-owned.
