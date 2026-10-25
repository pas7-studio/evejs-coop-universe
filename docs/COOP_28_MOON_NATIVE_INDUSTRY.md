# Chat 28 — Native moon extraction, Metenox and industrial structures

**Pinned upstream:** [`gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`](https://github.com/gameboys84/EveJS/tree/c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f/Code/server/src/services/structure). **Status:** `ISOLATED_CODE_PREPARED / CHAT01_INSTALLER_PENDING / LIVE_UNVERIFIED`. This change neither grants ore/materials nor constitutes successful playable moon mining. Source review and isolated unit checks are not real-game tests.

## Source findings and player-facing state

| Mechanic | Pinned native authority | Actual finding |
| --- | --- | --- |
| Refinery moon extraction | `structure/moonExtractionsService.js` and `structureState.tickMoonExtractions` | Authenticated controlling-structure mutation, online Standup Moon Drill requirement, seeded resource profile, calendar-like timers, start/ready/fracture/cancel/decay, SQLite/GameStore state and notifications are present. |
| Physical moon chunk and mining | `moonExtractionsService.js`, `mining/miningResourceSiteService.js`, `mining/miningRuntimeState.js` | `fractureCompleteAtMs` marks extraction complete, but the reviewed path does **not** materialize physical moon asteroids/chunks into native mineable scene state with bounded quantity/depletion. No real moon ore is granted by this method. **BLOCKED_NATIVE_CHUNKS**. |
| Metenox/auto moon extraction | `structure/structureAutoMoonFuelRuntime.js` and `autoMoonMiningService.js` | Online and hourly fuel consumes native fuel bay stacks (flag 172), including Dogma-backed fuel blocks and magmatic gas. `autoMoonMiningCycleOutput` is exposed through RPC and seeded moon profiles, but is **not** settled as material items. Native output bay (flag 186) is output-only and has native permission checks. **BLOCKED_ATOMIC_OUTPUT**. |
| Structure services / fuel | `structure/structureServiceModules.js`, `structure/structureServiceAuthority.js`, `structure/structureServiceOnlineRequirements.js`, `inventory/fuelBayInventory.js` | Native module fitting/online checks, fuel use and offline transitions exist; independent two-client acceptance not performed. |
| Reprocessing | `reprocessing/reprocessingRuntime.js`, `mining/miningIndustry.js`, `station/reprocessingService.js` | Actual native ore quotes/yields, cost/tax and itemStore consumption/grant paths exist for supported facilities. Independent player industry integration belongs to Chat 27. |
| Industry jobs | `industry/industryRuntimeState.js`, `structure/structureIndustryJobs.js` | Jobs are paused/resumed on service state changes; destruction cancels jobs. Do not bypass Chat 27's blueprint, fee, output and restart settlement. |
| Service owner/permissions | `structure/structureSettingsService.js`, `structure/structureServiceAuthority.js`, `inventory/invBrokerService.js` | Structure profile ACLs, owner-corp roles, moon material source bay restrictions exist. Unified policy changes owned by Chat 32. Some *read-only* moon extraction RPCs leaked any caller-supplied corp/structure data, covered below. |
| Destruction and resource losses | `structure/structureState.destroyStructure`, `structureDestructionLootState`, `structureAssetSafetyState` | Native destruction cancels jobs, marks services offline, handles eligible asset safety or physical wreck/loot. A fracture timer alone does not create recoverable items; no virtual recovery should be invented. |

## Prepared isolated corrections (default OFF)

1. `integration/coopMoonExtractionReadAccess.cjs` uses actual logged-in character and consistent native corporation ID; any requested corp must equal caller corp, any requested structure must exist and belong to that corp (conflicting owner aliases fail). A new extraction profile must match **actual native structureID, ownerCorpID, moonID and systemID**. No general structure access policy is changed.
2. `scripts/coop-moon-extraction-read-patch.cjs` inserts one guarded statement in each of `GetExtractionAndEventIDFromStructureID`, `GetExtractionsForCorp`, `GetMoonResourcesForStructure` and `StartNewExtraction`. `EVEJS_COOP_NATIVE_MOON_READ_ACL=1` is OFF by default, removes byte-exactly, and refuses missing/duplicate/mismatched pinned anchors.
3. `integration/coopMoonFuelOutputFence.cjs` and `scripts/coop-moon-fuel-output-patch.cjs` add an opt-in `EVEJS_COOP_NATIVE_MOON_OUTPUT_FENCE=1` safety fence *before* native Metenox online/hourly fuel debit. It refuses online startup and offlines subsequent cycles with an explicit reason until native fuel+production can be settled atomically. **This is a protective, deliberately production-blocking fence, not output support.** With flag OFF, pinned behavior is unchanged.
4. `integration/coopMoonNativeCycleAudit.cjs` checks before/after native inventory snapshots for real structure/corp, 172 fuel bay, 186 output bay, itemIDs, types, quantity changes and the SDE-backed expected cycle. Any debit with missing output is explicitly failed. A matching snapshot is only `MATCHED_NATIVE_BALANCES_NOT_ATOMIC_PROOF`, never proof of single-transaction durability or actual client UI.
5. `scripts/coop-moon-native-audit.cjs` is read-only and reports the pinned server source contracts; it cannot label moon chunks, raw ore, production or two-client play as verified. All feature flags are default OFF.

## Chat 01 central overlay integration request

Do **not** run a separate patch installer. The existing `scripts/patch-evejs-coop.cjs` is owned by Chat 01. Chat 01 should, in a coordinated change:

- Add three L2 names to its single `names` list: `coopMoonExtractionReadAccess`, `coopMoonFuelOutputFence`, `coopMoonNativeCycleAudit` (the last is optional read-only server-side diagnostic). Copy `.cjs` into `Code/server/src/space/*.js` as per repo doctrine.
- Add `specs` entries (or reuse existing entries without duplicates) for `server/src/services/structure/moonExtractionsService.js` and `server/src/services/structure/structureAutoMoonFuelRuntime.js`.
- In the **single central transform**, invoke `require('./coop-moon-extraction-read-patch.cjs').patch(text,spec.file,{remove})` or `require('./coop-moon-fuel-output-patch.cjs').patch(text,spec.file,{remove})` once for the matching native spec; verify ordering with others before deploying.
- Maintain env default OFF, hard fail on unexpected native source, and run pinned `--dry-run`, `--check`, and native overlay roundtrip. Never apply a second patcher or edit deployed upstream files by hand.

## Chat 32 permissions boundary

The corporate reader fence is intentionally narrower than owner ACL policy: a character from the native owner corporation can view its own extraction/profile. The access for `Handle_StartNewExtraction` remains governed by upstream `validateMoonExtractionMutationAccess` including controller, service, drill. Chat 32 must review whether corp-role-only vs structure-setting access is appropriate for read RPCs, and must own changes to `structureProfiles`, docking, service access, corporation roles, remote access and ACL consensus. Do not use caller-supplied corp/structure IDs as authority. Read ACL default OFF until approved.

## Chat 27 industry / settlement boundary

Metenox's onlining/hourly fuel debit and material output must be a **single idempotent authoritative native transaction**, not a fuel debit followed by `grantItemsToOwnerLocation` and a separate timer-state write. The existing `coopGameStoreAtomic` allowlist does not yet encompass both required structure/moon state and outputs, and the original Metenox path consumes stacks individually, so crash/restart can orphan fuel or duplicate output. Chat 27 should coordinate native itemStore/SQLite transaction and industry inputs with Chat 32's structure permissions; validate correct authored moon profile, permitted moon type IDs, precise cycle quantities, bay volume and structure/corp ownership, and write an atomic cycle receipt. Handle starvation, reinforcement, owner change, destruction and simultaneous two-pilot requests. An identical cycle replay must not create another item or charge another fee. The fencing flag can be switched on *as a precaution*, but no production claim is permitted until Chat 27's real inventory settlement works.

## Local checks and manual gameplay acceptance

```sh
node --test tests/coop-moon-*.test.mjs
EVEJS_COOP_CODE_PATH=<pinned-EveJS>/Code node --test tests/coop-moon-pinned.test.mjs
node scripts/coop-moon-native-audit.cjs --code-path <pinned-EveJS>/Code
# Only once the Chat 01 central installer is updated, on a disposable exact-pin tree:
node scripts/patch-evejs-coop.cjs --code-path <pinned-EveJS>/Code --dry-run
node scripts/patch-evejs-coop.cjs --code-path <pinned-EveJS>/Code --check
```

Unit checks verify source-shaped reversible hooks, access denied across corps and corrupted profile, fuel fence before debit, native item snapshot conservation and refusal to fabricate material; optional pinned tests require the local source. No Docker, real server, client, or EVE inventory operation is claimed by these isolated tests.

**Required live gate, on an operator-approved disposable world:** observe two genuinely authenticated pilots (different characterIDs and shipIDs), a valid anchored corp refinery with real Moon Drill and moon resource profile, actual visible moon asteroid/chunk after fracture, simultaneous mining laser cycles against the same finite ore source, real ore itemIDs/quantities in cargo, fuel debit and *matching* material output at Metenox, corp permissions for second pilot, native refining output and authorized industry job receipt, stable ownership after reconnect and restart, fuel starvation, pause/resume, and structure destruction with actual asset-safety/wreck outcomes. If physical chunks or an atomic output contract is absent, record `BLOCKED`, **not PASS**. Do not alter a running world, client binary, volume or game assets to force this gate.
