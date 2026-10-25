# Chat 26 - native Planetary Industry authority and conservation hardening

Status: **CODE_READY / LIVE_UNVERIFIED, requires Chat 01 native integration**. Feature `EVEJS_COOP_PI_INTEGRITY=1` is **OFF by default**. Repo source-of-truth: `integration/coopPiIntegrityGuard.cjs`; copy to pinned EveJS `Code/server/src/space/coopPiIntegrityGuard.js` through the **existing** transactional overlay. Do not add another patcher or touch player saves. No upstream code vendored.

Pinned native EveJS: `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. This change does not claim that PI now runs in the actual game or that the two accounts have paid native rewards.

## Existing native functionality (do not duplicate)

- `planetRuntimeStore.js`: per-planet/per-character colonies, independent pin networks, CPU/power/link checks, ECU resources/depletion, schematic processor inputs/outputs, storage routing, simulation and persistent launch records.
- `planetMgrService.js`: native planet UI / network mutation, debit of construction/launch taxes and command-center inventory, launch containers.
- `invBrokerService.js::Handle_ImportExportWithPlanet`: real inventory items at the customs-office location, authoritative colony spaceport import/export and PI taxes. Imported cargo remains owned by the character; it does not appear directly at a station.
- `planetOrbitalState.js`: physical orbital item state, InterBus/default customs offices, public and corporate tax state.
- Actual transport from customs office to station/industry requires ordinary native ship cargo/item transfers, station services and industry ownership; no teleport or virtual depot is implemented here.

## Source-confirmed P0 risks

1. **Free command center:** `UserUpdateNetwork` commits colony + wallet charge *before* `consumePlacedCommandCenterItems`. The latter finds the source item by the **new command pinID**, checks that the actual item is still in the player's ship, and silently `continue`s if no match/failed debit. With a client temporary pin ID, an accepted colony may never consume a physical center.
2. **Nonatomic import/export:** `invBrokerService::Handle_ImportExportWithPlanet` calls `applySpaceportImportExport` first, then separately debits native customs inventory, creates exported items, and charges a native wallet. Its catch refunds only recorded wallet debits. PI colony contents and inventory transfers are **not** atomically rolled back on failure.
3. **Orphan launch:** `launchCommodities` writes PI commodity removal plus launch receipt *before* `createPhysicalLaunchContainer`; the latter may return null or fail to attach, but `Handle_UserLaunchCommodities` still reports success. An accepted launch without a physical container is not a usable native item.
4. **Customs mismatch:** the inventory broker resolves a character's colony using the spaceport pin but does not verify that the selected customs-office item belongs to the **same actual planet/system**. It can thereby change cargo location without real transport.
5. **Unrestricted GM/settings:** `Handle_GMAddCommodity`, `Handle_GMCleanupExpiredLaunches` and `planetOrbitalRegistryBrokerService::Handle_UpdateSettings` have no per-session access gate in their own methods. The latter can change tax/config for a foreign corporate/customs office.
6. **Simulation cap:** `runColonySimulation` processes up to `MAX_SIMULATION_EVENTS=20000` then advances `currentSimTime` to target, potentially discarding work during very long offline windows. A full native fix needs bounded resumable catch-up, not fabricated products.

These are native source observations. They are not evidence of actual exploitation or of a completed two-client game session.

## Isolated L2 behavior delivered

`createPiIntegrityGuard` accepts native adapters; it **never** creates items/ISK/LP, changes colony storage, or makes hidden background calls. Under the opt-in gate:

- `assertCommandCenterEdit` requires exact authenticated owner and a physically owned, installed cargo command center item, with command pinID equal to actual `itemID` (the only case the current native consumer can debit). Malformed/temporary command pin IDs fail closed, as do wrong ship, flag and owner. Processor/route edits preserve vanilla behavior. This is a temporary restriction; a native atomic command-center debit is still needed for client temporary IDs.
- `assertOfficeTransfer` checks the authenticated owner, native spaceport pin, correct real customs-office identity/category/planet/system, and operational/anchored state. Both independent colonists may use the same legitimate office for **their own** colonies. It does **not** settle inventory or pay taxes.
- `assertOfficeSettings` accepts a strictly personal owner; a corporate office must have a separate trustworthy native corporate-role proof injected by Chat 01. Bare corp/fleet membership cannot authorize settings; this first version denies corporate settings without that adapter.
- `assertLaunchReady` blocks another launch for that character+planet while a recent (<7 days) persisted PI launch lacks a physical container receipt. `assertLaunchPhysicalized` checks exact owner, native ItemStore container, **physical Ballpark entity**, cargo types and stack quantities after the native launch. On ambiguity it throws and requires operator reconciliation; it does **not** refund goods.
- `beforeGmMutation` denies direct GM item mint and launch cleanup while integrity mode is enabled. Out-of-band legitimate operator maintenance must remain disabled during gameplay or use separately audited native authorization.

Every L2 native wrapper is a no-op when `EVEJS_COOP_PI_INTEGRITY` is not exactly `1`. Native sources must not be patched by Chat 26. The launch physical-check occurs after a native write and therefore cannot be called atomic; it protects evidence and stops further blind progression, not goods already lost.

## Chat 01 exact integration contract (central owner only)

Register `coopPiIntegrityGuard` in the existing `names` L2 overlay installer. Add at most **one statement per insertion**, unique anchors below, via the existing reversible `scripts/patch-evejs-coop.cjs` spec. Confirm LF/CRLF round-trip, dry-run, and `tests/coop-crossstream-overlay-roundtrip.test.mjs` before deployment.

**`server/src/services/planet/planetMgrService.js`**

- Before the unique `    const constructionDebit = debitPIWallet({` inside `Handle_UserUpdateNetwork`, after preview passes:
  `    require("../../space/coopPiIntegrityGuard").beforeNetwork({session,planetID,ownerID,serializedChanges});`
- Before `    const preview = planetRuntimeStore.previewLaunchCommodities(launchOptions);` inside `Handle_UserLaunchCommodities`:
  `    require("../../space/coopPiIntegrityGuard").beforeLaunch({session,planetID});`
- After unique `    createPhysicalLaunchContainer(result.launch, session);`:
  `    require("../../space/coopPiIntegrityGuard").afterLaunch({session,launch:result.launch});`
- Immediately inside the method bodies `Handle_GMAddCommodity` and `Handle_GMCleanupExpiredLaunches`:
  `    require("../../space/coopPiIntegrityGuard").beforeGmMutation();`

**`server/src/services/inventory/invBrokerService.js`**

- Immediately before the unique `    const importInfo = this._buildPIImportCommoditiesFromItems(`, after the prior native `if (!colony)` guard:
  `    require("../../space/coopPiIntegrityGuard").beforeCustoms({session,characterID,customsOfficeID,spaceportPinID,colony});`

**`server/src/services/planet/planetOrbitalRegistryBrokerService.js`**

- Immediately before unique `    const result = planetOrbitalState.updateOrbitalSettings(orbitalID, {`:
  `    require("../../space/coopPiIntegrityGuard").beforeOfficeSettings({session:arguments[1],orbitalID});`
  `Handle_UpdateSettings(args)` currently does not declare `session`; the controller must confirm its standard service dispatcher passes session as the second argument, or insert the hook with an equivalent verified session binding. If not, settings fail closed under the flag.

These anchors were each uniquely observed in pinned source at the audited SHA; these **insertion hooks have not been installed** in the project central installer. Do not replace existing L1 hooks or force-merge another owner's installer changes.

## Tests / evidence and remaining acceptance

Executed with Node.js `node --test tests/coop-pi-integrity-guard.test.mjs`: **26 PASS, 0 FAIL**. Source anchor audit performed against pinned EveJS directly through GitHub for all seven planned locations; repository source contract tests have **7 SKIP** when `EVEJS_COOP_CODE_PATH` is absent. Isolated fixtures are not proof of a live PI economy.

Must still test in disposable native world with **two independent real clients**: independently place actual command-center items; configure extractors + routes + processors; capture exact native raw resource contents before/after cycle; verify processor input debit and schematic output quantity; export from a real command center to a Ballpark container with source itemID and cargo receipts; use both owners' legitimate planet customs offices, confirm real import/export item/ISK/tax deltas; physically haul to a real station; use actual manufacturing job materials; reconnect after each stage and force-crash before/after command-center debit, PI launch, customs transfer, and native wallet debit; verify no duplicate or missing items. Diagnose stale deployment and real telemetry first. Record item IDs, owner, inventory locations, colonies and both character wallets. No fake site, item, cargo or test event may satisfy this.

**Hard blockers to full acceptance:** (a) cross-store atomic PI+ItemStore+wallet settlement; (b) crash-safe launch container creation; (c) true corporate customs role authorization; (d) resumable native offline simulation over the 20k event cap; (e) actual live two-client UI and restart verification. Do not enable flag on persistent production data or claim complete PI from this safety layer alone.
