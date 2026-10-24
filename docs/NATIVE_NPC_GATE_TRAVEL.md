# Native NPC stargate travel — controlled P1 implementation

**Current status: implemented behind two OFF-by-default feature flags; live EveJS gameplay and cross-system arrival not yet verified.** Do not claim that an NPC crossed systems from a warp order or a virtual-world timer.

## What is real

- `coopNpcGateTravel.cjs` reads actual source stargates in the authoritative EveJS `scene.staticEntities` array, validates both ends using `worldData.getStargateByID` and requires reciprocal `destinationID` links. It picks only routes for which real adjacent gates exist.
- Traders and patrols that are already physically materialized use `npcRuntime.warpToEntity` to approach a real gate. PvP/PvE combat controllers and active tactical NPC orders take priority. Patrol/civilian wandering does not interrupt an active gate approach.
- After the real ship physically arrives within **2,500 m of the stargate surface** (using actual scene radii; missing radii default to zero conservatively), the state is `AT_REAL_GATE`. This **is not a jump**.
- `coopNativeGateTransfer.cjs` is a separate optional native transfer, preserving **the exact same entityID**. It uses native `dematerializeNativeController` (which saves the existing ship and controller state) and native `materializeStoredNativeController` in the destination scene. It changes only native entity/controller system, movement and gate anchor; modules and cargo remain attached to the same entity ID.
- The original shield/armor/structure condition data are preserved. Native store module/cargo signatures, source absence, destination presence, exact ID and matching persisted records are checked before the named pilot's durable registry is relocated. No clone, fake warp, invented cargo or session spoofing.
- A synchronous per-pilot JSON journal is written before the move, with checkpoints and a compensating rollback on failure. On startup, incomplete journals can be recovered to the original system if possible. A corrupt/inconsistent journal fails closed as `NEEDS_OPERATOR_REPAIR`.

**Crash safety limit:** the upstream native store is not a transactional cross-system migration API; this module uses compensating writes. There may be uncommon power-loss windows or runtime state unsupported by the upstream persistence mechanism that require operator repair. Keep the transfer flag off until QA demonstrates a real round trip with cargo, modules, damage state, observers and a forced crash mid-transaction.

## Configuration (disabled for current playtesting)

```ini
EVEJS_COOP_NATIVE_GATE_APPROACH=0
EVEJS_COOP_NATIVE_GATE_TRANSFER=0
```

To try **approach only**, enable `EVEJS_COOP_NATIVE_GATE_APPROACH=1` while leaving transfer at `0`. To trial full transfer in an isolated disposable world, both must be `1` and the upstream source/destination gates must actually be connected. Never enable on a public server before end-to-end verification.

The persistent journal directory defaults to `/var/lib/evejs/coop-native-transfers`. If recovery returns `NEEDS_OPERATOR_REPAIR`, the runtime does not attempt more transfers. Back up this directory and the native EveJS persistence store together before any manual repair. Do **not** simply remove a journal when a ship is missing.

Native evidence event: `living-native-gate-approach`. `NATIVE_WARP_TO_REAL_GATE` proves an accepted native warp request, not arrival; `AT_REAL_GATE` proves same-scene gate proximity; `VERIFIED_NATIVE_GATE_TRANSFER` requires actual destination scene and original ship identity verification. Manual inspection of two clients is still needed to prove rendering and player visibility.

## Local, manual verification

```powershell
node --test tests/coop-npc-gate-travel.test.mjs tests/coop-native-gate-transfer.test.mjs tests/coop-identity-registry.test.mjs
```

Acceptance on a real server:
1. Use a real reciprocal stargate pair and at least one named `trader` or `patrol` NPC without active combat.
2. Observe NPC warp to the real gate and arrive. Check it is still the **same original native entity ID**, with no duplicate ship.
3. In disposable test data only, enable transfer and verify the same ID disappears from the source scene and exists in the destination scene.
4. Check durable identity registry and virtual pilot's next tick; they must agree with the actual destination.
5. Confirm module IDs, cargo IDs, cargo quantities, fitting, damage/HP, and NPC controller are retained across the jump.
6. Simulate a destination materialization error, confirm rollback restores the original scene, then restart with a prepared incomplete journal and verify recovery.
7. Confirm combat, warp scramble, failed gate reciprocity, missing source/destination, and corrupted journal all block travel.

### Tests completed in isolation

- Seven gate-route/unit scenarios and five native transfer/rollback unit scenarios passed in the local JavaScript harness (not a real EveJS container).
- Existing physical NPC and economy tests are separate; neither these tests nor an accepted warp request certify live-client stargate behavior.

Owner policy: **no GitHub Actions/CI; no merge to main without owner authorization**.
