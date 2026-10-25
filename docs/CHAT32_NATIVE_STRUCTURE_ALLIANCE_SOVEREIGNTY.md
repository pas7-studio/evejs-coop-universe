# Chat 32 — native structure, alliance, war and sovereignty admission integrity

**Source audit:** 2026-10-25. **Pinned EveJS** `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.
**Status:** SOURCE-READY / **LIVE_UNVERIFIED**. Optional native guard default **OFF**. No central installer, Docker, EVE account, or persisted database modified.

## Grounded native support (not reconstructed / not a shadow universe)

| Area | Authoritative server source | Available native operations / limits |
| --- | --- | --- |
| Citadels, engineering complexes, refineries, FLEX | `services/structure/structureState.js`, `structureService.js`, `sovPlayerDeployment.js` | Original create/anchor/unanchor, ownerCorpID, access/docking, structure timers, reinforcement and damage state |
| Access lists / services | `structureProfilesState.js`, `structureProfilesService.js`, `structureServiceAuthority.js`, `structureServiceModules.js` | Real access-profile entries, corporation access and online service-state checks, not virtual member permissions |
| Fuel / upkeep | `structureFlexFuelRuntime.js`, `structureAutoMoonFuelRuntime.js`, `structureState.tickStructures` | Native fuel and upkeep scheduling; inventory-backed fuel consumption paths; clock and failure durability need live testing |
| Destruction and asset safety | `structureAssetSafetyState.js`, `structureWreckState.js`, `structureState.tickStructures` | Original wrapped inventory transfer, owner-based delivery, docking evacuation and notification paths. Never synthesize wrap IDs or refund destroyed assets |
| Alliances | `corporation/allianceRegistryRuntime.js`, `corporationState.js`, `corporationRuntimeState.js`, `allianceViewState.js` | Real member corporations, executor support, applications, contact lists, executor settings, capital system |
| Wars | `warRuntimeState.js`, `warRegistryService.js`, `warCostState.js`, `warPermitState.js` | Native war declarations, billing, war HQ, lifecycle and notifications. No new war ledger |
| Sovereignty | `sovereignty/sovState.js`, `sovPlayerDeployment.js`, `sovModernState.js`, `sovFlexStructures.js`, `sovAutoState.js` | Native TCU/Sov Hub/flex placement, alliance prime time, strategic state and timers |

The pinned upstream source contains no separately accessible `Code/client` client implementation. Server method existence is **not** client UI support proof. Protocol bindings need a real authenticated original EVE client to validate input shapes, visibility, tooltips, vulnerabilities, timers and RPC effects.

## Confirmed authorization defects in pinned server

1. `sovPlayerDeployment.requireStructureManagementSession` only compares corp IDs when *both* are truthy. A session with a missing corp ID could bypass owner comparison and satisfy the next branch via a claimed management role / `isCEO`.
2. The `allianceRegistryRuntime` methods `Handle_UpdateApplication`, `Handle_GMForceAcceptApplication`, `Handle_DeleteMember`, `Handle_SetPrimeHour`, `Handle_SetCapitalSystem`, `Handle_DeclareWarAgainst` and other mutations write native state without independently proving that the caller is the executor corporation's authorized director.
3. `Handle_DeclareWarAgainst` creates a payable CONCORD bill *before* `createWarRecord`, while `createWarRecord` may reject invalid IDs. A failed war can leave an orphan bill. This guard prevents unverified callers and invalid/foreign HQs from reaching that path, but **does not make native billing and war creation transactional**.

## Implemented narrow solution

- `integration/coopStructureAllianceAuthority.cjs` is a read-only admission helper. It checks the actual canonical character record, durable player corporation record, authoritative corporation member role record and alliance membership index, then executor corporation and the specific action. It does **not** trust only user-session `isCEO`, `corprole` or `allianceID`. Executor corp CEO/director may manage alliance, a different allied corp's real director may cast executor support but not change central policy. No unsupported GM grant: exposed `GMForceAcceptApplication` is blocked unless a future explicit server-side GM authority contract is provided. Native unanchor/management requires same actual corporate owner, proper roles, and a non-destroyed structure.
- Reversible `scripts/coop-structure-alliance-guard-patch.cjs` inserts one default-OFF guard into **24 original alliance RPC handlers and 3 original structure session-gates**. It uses existing `getCharacterRecord`, `getCorporationRecord`, `getCorporationMember`, `getAllianceRecord`, `getAllianceCorporationIDs`, `getAllianceRuntime` and `getStructureByID`. No parallel alliance member state or asset ledger.
- Invalid war targets, own-alliance targets, absent/foreign/destroyed war HQs, fabricated applications, cross-corp structure admin and stale claims fail before the original mutation. If the native records are missing, operations are denied rather than waived.
- The new code does not create any structures, charge ISK, refill fuel, change ownership, advance timers, steal assets or bypass live native service rules. Flags remain **OFF** by default.

## Central installer integration (Chat 01)

1. Copy `integration/coopStructureAllianceAuthority.cjs` as `Code/server/src/space/coopStructureAllianceAuthority.js` under the pinned deployment. The file is the only backing authority for both hooks.
2. Call `require('./coop-structure-alliance-guard-patch.cjs').patch(text,relativeNativePath,remove)` for both supported native files, under the sole existing installer. Source paths are `server/src/services/corporation/allianceRegistryRuntime.js` and `server/src/services/sovereignty/sovPlayerDeployment.js`. Do not add a second installer. Review combined hooks and roundtrip across Chat 31, Chat 28 and other concurrent work.
3. Test existing default-OFF behavior and activate `EVEJS_COOP_STRUCTURE_ALLIANCE_GUARD=1` **only on a disposable server** after authentic two-client role/UI tests. This narrow policy may restrict a genuine GM RPC or non-executor director role delegation; those require authoritative explicit membership and permission designs, not shortcuts.

## Verified in this chat

- **7/7** actual helper-source, two-player authorization / denial regression cases in an isolated V8 runner.
- **4/4** actual patch-source regression cases in an isolated V8 runner, including duplicate anchors and LF/CRLF.
- Both native original pinned files syntax-checked after hook insertion. Patch, reapplication and remove are byte-exact. No native EveJS server/Docker/client was started and no persistent world volume was mutated.
- Official on-machine test command (NOT EXECUTED IN A REAL CHECKOUT): `node --test tests/coop-structure-alliance-authority.test.mjs tests/coop-structure-alliance-guard-patch.test.mjs`.

## Critical remaining blockers for full user-requested mechanics

**Native deployment is not crash-atomic:** `sovPlayerDeployment.deployStructureFromInventoryItem` first creates/anchors the structure or sovereignty state and only then calls `consumeInventoryItemForDeployment`. A failure/power loss between can produce an unpaid structure, possibly followed by an unsafe replay. Do **not** assert free-structure protection from this authorization-only guard. Production requires a durable two-store deed/structure transaction or an operator-reconciled immutable prepare/outcome journal, with unique deed provenance and source itemID.

**Asset safety / destruction:** native `structureAssetSafetyState` handles actual inventory movements and wrap state, but no two-player storage crash/restart tests were possible. Must prove no double movement, missing asset, lost rig, unearned asset-safety fee, duplicated wreck or unjustified insurance/refund.

**War financing and sovereignty:** native bill, war, structure and sovereignty data reside in separate persistence flows. This change does not solve two-table atomic billing, out-of-date alliance executor rotation, fuel double consumption on cold restart or arbitrary owner transfer authorization. Do not enable unrestricted wars, sovereignty or owner transfer based only on this guard.

**Interface/time:** server-side handlers and tick functions were inspected; actual installed client binaries, screenshots, UI service availability, reinforced/vulnerable windows and live RPC return compatibility are **NOT_RUN**.

## Full test gate

`tests/scenarios/coop32-structure-alliance-sovereignty-e2e.json` contains a sequence for genuine corporation A/B permissions, original deed deployment, service and fuel conservation, war declaration billing, reinforcements, loss and asset safety, alliance change, sovereignty claim and cold restart after each phase. **All scenarios remain NOT_RUN.** Coordinate corporation membership/roles and shared hangar decisions with Chat 31, and moon/fuel ownership with Chat 28. Never reset `evejs-data`.

**Conclusion:** supported native service locations audited and a concrete authorization vulnerability mitigated in a staged, reversible, default-OFF source patch. **Full functional structure/alliance/sovereignty implementation and live two-client acceptance are NOT complete.**
