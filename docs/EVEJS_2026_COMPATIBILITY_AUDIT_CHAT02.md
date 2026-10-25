# CHAT-02 — pinned EveJS versus live EVE Online (25 October 2026)

**Status:** `SOURCE_REVIEWED / CODE_READY / LIVE_UNVERIFIED`. This is a source-backed **risk and compatibility register**, not a claim of full parity. No client executable, private live database, or two-client session was available in the audit environment.

## Exact baseline and evidence boundaries

| Subject | Evidence | What this proves |
| --- | --- | --- |
| Project base on audit start | `main` `4c315ba7382b97baa14e8d73a4e046d04d2227ce` (2026-10-25) | Identifies starting source snapshot only; other agents may publish newer commits |
| Pinned server | `gameboys84/EveJS` `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f` (`docs/UPSTREAM.md`, installer `PIN`) | The particular source tree inspected, **not** a live deployed checkout |
| Compatible client | EVE 24.01 / build **3396210**, stated by upstream setup and database creator | Does **not** mean the current Tranquility client has the same build or wire protocol |
| Static dataset point | EveJS `Code/tools/DatabaseCreator/database-creator.js`: `DEFAULT_BUILD = 3396210`; fixed `...3396210-jsonl.zip` | The server generator is tied to an older public SDE; not a modern-data bridge |
| Modern static data | CCP official JSONL/YAML SDE, build-specific archives and schema changelog | Must compare build/schema **before** any import; SDE is not a replacement for game logic or client binary compatibility |
| Modern features | CCP Cradle of War June 9, September 22 major update, and Oct 20 announcement of **future** Nov 10 Fractured Skies | Oct 25 features must not include future Nov expansion as already shipped |

Sources:
- Pinned repo and evidence: <https://github.com/pas7-studio/evejs-coop-universe/blob/main/docs/UPSTREAM.md>, <https://github.com/pas7-studio/evejs-coop-universe/blob/main/docs/EVEJS_NATIVE_MECHANICS_COOP_GAP_AUDIT_20261025.md>.
- Upstream code: <https://github.com/gameboys84/EveJS/tree/c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f/Code/server/src> and <https://github.com/gameboys84/EveJS/blob/c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f/Code/tools/DatabaseCreator/database-creator.js>.
- Official: <https://developers.eveonline.com/docs/services/static-data/>, <https://www.eveonline.com/news/view/the-cradle-of-war-expansion-is-here>, <https://www.eveonline.com/news/view/cradle-of-war-major-update-is-live>, <https://www.eveonline.com/news/view/fractured-skies-expansion-arrives-10-nov>.

### What was actually inspected

- GitHub `main` HEAD, recent commits, open PRs (none surfaced initially), `AGENTS.md`, `README.md`, `docs/DEVELOPMENT_DOCTRINE.md`, `docs/GAMEPLAY_TESTING.md`, `state/NOW.md`, `state/status.json`, `docs/UPSTREAM.md`, earlier 24-mechanic audit, upstream recursive file tree.
- Pinned upstream direct source for `serviceManager`, `baseService`, `contractMgr`, `contractProxy`, `lpService`, `lpStoreMgr`, `abyssalMgr`, `wormholeMgr`, `colonyResourcesMgr`, HTTP `compatibilityGatewayService`, gateway registry, and the SDE database creator.
- Upstream recursive tree reports **206** paths matching `Code/server/src/services/**/*Service.js` (source-file inventory only, not service registration or gameplay support).
- The saved `state/NOW.md` was generated at **project rev `4872174a`**, which is older than the current audit-start `main`; its test numbers and overlay state are **not** evidence for this HEAD.
- No local upstream checkout, Docker, proprietary client, physical inventory, full old/new extracted SDE, or real two-client access. Consequently the new checks below were tested against disposable fixtures and direct source inspection, not run against a complete local pinned tree.

## Three distinct kinds of incompatibility

1. **SERVER**: RPC exists but is stubbed, incomplete, incorrectly routed, or does not implement the authoritative rules (including safe item/ISK accounting). Fixes require native source/overlay hooks, independent ownership, negative/crash tests, and usually client QA.
2. **DATA**: SDE lacks a type, blueprint, dogma effect, system, localization or topology needed for a new feature. Compare source build to build; use known CCP JSONL schema. **Never** import a newer SDE into the pinned runtime to force parity: changed IDs/relationships are potentially unsafe.
3. **CLIENT_PROTOCOL**: the pinned client cannot render/request the newer functionality or its transport/protobuf/RPC contract differs. A server-only shim is not proof of compatibility; do not patch, redistribute or bypass proprietary clients. Test only lawfully authorized client builds.

A feature often spans **two or three** categories. `SOURCE_PRESENT` = file/method exists; `STUB` = explicit source evidence; `PARTIAL` = native implementation exists but exact 2026 behavior not verified; `LIVE_UNVERIFIED` means no successful actual gameplay evidence for this project revision.

## Native capability and compatibility matrix

| Family | Pinned source anchor / finding | Main gap class | Source-level conclusion / next acceptance |
| --- | --- | --- | --- |
| Authentication, session, reconnect | `services/login/authenticationService.js`, `services/machoNet/sessionMgrService.js`, `services/chat/sessionRegistry.js` | SERVER, CLIENT_PROTOCOL | Source present. Two independent logins, binding, reconnect and security **not checked live** in this audit. |
| Destiny, ships, warp and docking | `services/ship/beyonceService.js`, `space/movement/`, `services/station/stationService.js` | SERVER, CLIENT_PROTOCOL | Native movement present. Verify authoritative observer/owner packets and both pilots actually land/dock. |
| Fleet and shared grid | `services/fleets/fleetMgrService.js`, `fleetProxyService.js` | SERVER | Source present; native group state and fleet warp/loot rights must be observed by two clients; overlay owned by other chats. |
| Cargo, fitting, dogma, drones | `services/inventory/invBrokerService.js`, `services/ship/shipService.js`, `services/dogma/dogmaService.js`, `services/drone/entityService.js` | SERVER, DATA | Sources present. New typeID alone cannot provide new fitting slots, combat mechanics, effects or client UI. |
| Mining, ore, salvage | `services/mining/`, `space/modules/salvagerRuntime.js`, `tractorBeamRuntime.js` | SERVER, DATA | Native modules present. Ownership, depletion, resource flows and NPC round-trip persistence remain gameplay gates. |
| Reprocessing, manufacturing, research | `services/station/reprocessingService.js`, `services/industry/industryManagerService.js`, `industryRuntimeState.js` | SERVER, DATA | Native handlers exist. Real bill of materials, consumption, timers, output and 2026 recipes/dogma need verified transaction tests. |
| Wallet, market, contracts | `services/market/`, `services/account/walletState.js`, `services/_other/contractMgrService.js`, `contractProxyService.js` | SERVER, DATA | **ContractMgr Handle_CreateContract is null** while ContractProxy declares it. Do not infer all contracts are absent: real proxy has create/accept/complete code. Route and settlement must be tested. |
| LP Store | `services/corporation/lpService.js`, `services/evermarks/lpStoreMgrService.js` | SERVER, DATA | **LPSvc Handle_TakeOffer returns null**, but LPStoreMgr has `Handle_TakeOfferForCharacter` backed by balances and items. Verify which contract the pinned client calls. |
| Crimewatch, kill rights, bounties, insurance | `services/security/crimewatchService.js`, `services/bounty/`, `services/insurance/` | SERVER | Source present, source-only. Co-op kill attribution and one-time payout/insurance must be tested after replay/restart. |
| Exploration, probes, bookmarks | `services/exploration/scanMgrService.js`, `probes/probeScanRuntime.js`, `services/bookmark/bookmarkService.js` | SERVER, DATA | Real scanning/bookmarks native paths exist; current user-visible two-pilot path requires native registration, same coordinates, permissions, no synthetic scan receipts. |
| Wormholes | `services/exploration/wormholes/wormholeMgrService.js` | SERVER, DATA | `Handle_WormholeJump` and polarization logic are present; this **does not** prove paired two-client travel or mass/collapse parity. |
| Missions, epic arcs, standings | `services/agent/agentMgrService.js`, `epicArcStatusService.js`, `services/character/standingMgrService.js` | SERVER, DATA | Source present. Per-character accepted mission identity, reward consistency and 2026 arc content need validation. |
| Corporations, alliances, wars, hangars | `services/corporation/`, `services/inventory/` | SERVER | Source present, authorization and role enforcement must be audited before shared access. |
| Structures, moon extraction, skyhooks, sovereignty | `services/structure/`, `services/sovereignty/colonyResourcesMgrService.js` | SERVER, DATA | Runtime source present including skyhook summaries. The September **Ansiblex charge/capacity and alliance access rules** need exact independent protocol/dogma logic validation; cannot infer parity from a bridge service. |
| Faction Warfare, incursions / insurgencies | `services/faction/`, `services/map/insurgencySolarsystemService.js`, gateway `insurgencyGatewayService.js` | SERVER, DATA, CLIENT_PROTOCOL | Source present; September 2026 insurgency timing/reward/site changes are unverified. |
| Abyssal Deadspace | `services/activity/abyssalMgrService.js` | SERVER, DATA | **Confirmed deliberate refusal**: its entry deployment logs “Abyssal content generation is not available”; no genuine pocket runtime. |
| New 2026 Military Campaigns | `services/campaign/`, `gatewayServices/campaignGatewayService.js` | SERVER, DATA, CLIENT_PROTOCOL | Matching names exist; **cannot** claim current Cradle of War campaign scoring, rewards or UI are complete without behavior inspection. |
| June 2026 new hulls | `tools/DatabaseCreator/`, `services/dogma/`, `services/ship/` | DATA, SERVER, CLIENT_PROTOCOL | June added 4 command carriers and 4 navy destroyers. Check ship typeIDs, hull bonuses, command bursts, market, fitting and client render **for each type**. Not proven by source paths. |
| Sept 2026 rebalances | `services/dogma/`, `services/structure/` | DATA, SERVER | Ansiblex capacitor charge, ship and wormhole changes require source-level numerical parity plus matching client support. |
| Starter Space & achievements | `services/npe/`, `services/character/achievementTrackerMgrService.js` | DATA, SERVER, CLIENT_PROTOCOL | Source present; proper Exordium topology, tutorial rewards and anti-PvP restrictions need distinct tests. |
| Cosmetics/skill plans/PLEX/protobuf | `gatewayServices/compatibilityGatewayService.js` | CLIENT_PROTOCOL, SERVER | **Confirmed empty-success map** for many skin, PLEX, goal and skill-plan requests; `GetActive` skill-plan may return a zero UUID. Successful HTTP 200 is not complete gameplay. |
| Nov 10, 2026 Fractured Skies | **FUTURE as of audit date** | DATA, SERVER, CLIENT_PROTOCOL | **Do not assess as shipped in October.** Future navy attack battlecruisers, synchronizers, Conquest Engines and HUD changes require a separate post-release audit. |

### Scope of “full” gap accounting

This matrix covers major gameplay subsystems and the **known, source-verified** hard breaks. It is **not** a mathematically complete enumeration of all Tranquility RPCs, items, dogma expressions, effects, localized strings, 2026 ship stats, or proprietary UI capabilities. Such a claim would require extraction of an authorized matching client RPC schema, full old/current SDEs, observed server requests and two-client sessions. Missing evidence is a classification, **not** assumed functional failure.

## Independent compatibility fixes delivered by CHAT-02

1. `scripts/coop-compatibility-audit.cjs`: read-only source inventory + known-RPC-contract signals, **hard SHA gate** against non-pinned EveJS. Makes it impossible for this tool to silently accept a different EveJS revision. Reports source-only semantics, never a client PASS.
2. `scripts/coop-compatibility-audit.cjs` also validates an optional locally generated `manifest.json`: `build`, `sdeMeta.buildNumber`, and the build embedded in the source ZIP URL must all equal `3396210`. Mismatch/invalid metadata is `BLOCKED_COMPATIBILITY`, exit 2. `--require-manifest` refuses to pass when the manifest is absent. This does not modify data.
3. `scripts/coop-sde-compat-diff.cjs`: offline compare of **15** public JSONL SDE tables (including ships/items via `types`, dogma, blueprints, systems, gates, belts, NPC stations, factions and industrial facilities). Reports counts and bounded samples of added/removed/changed IDs; rejects duplicate/malformed IDs, invalid JSON, file symlinks and missing tables without calling them equal. No downloads or import.
4. Two Node test files verify fixtures for source signals, read-only behavior, pin mismatch, malformed manifests, SDE delta detection and incomplete data, with no new dependencies or network access.

**Run only on an isolated, disposable upstream checkout; never alter the owner's live installation.**

```powershell
node scripts/coop-compatibility-audit.cjs --code-path 'C:\Path\To\SeparatePinnedEveJS\Code' --manifest 'C:\Path\To\SeparatePinnedEveJS\Code\_local\manifest.json' --require-manifest --json
```

The manifest argument must point to the **actual** generated `manifest.json` (the location above is illustrative; the DatabaseCreator uses `path.resolve(options.outDir, '../manifest.json')`).

```powershell
node scripts/coop-sde-compat-diff.cjs --baseline-sde 'C:\ExtractedSDE\3396210' --current-sde 'C:\ExtractedSDE\Current'
node --test tests/coop-compatibility-audit.test.mjs tests/coop-sde-compat-diff.test.mjs
```

The two SDE arguments are directory paths containing extracted `*.jsonl`, not ZIP files or database folders. Output is JSON to stdout, **nothing is written**. Preserve import/source rights. The diff computes IDs and record hashes, **not** the semantic correctness of server algorithms. Do not enable newer items/dogma in live EveJS based on a nonzero count.

## Remaining engineering gates and owner routing

| Priority | Required next step | Owner / dependency | Status |
| --- | --- | --- | --- |
| P0 | Run SHA-locked source inventory on separate complete upstream checkout + inspect generated SDE manifest | CHAT-02 / operator machine | `BLOCKED_LOCAL_CHECKOUT` |
| P0 | Obtain two extracted **public** SDE snapshots, compare source/modern types/ship groups/solar systems/dogma and investigate changed schemas | CHAT-02 / input data | `BLOCKED_DATA_UNAVAILABLE` |
| P0 | Compare real client RPC traces, register aliases vs source handlers, test launch/handshake/login | CHAT-01 integration + authorized client operator | `LIVE_UNVERIFIED` |
| P0 | Verify Abyssal and empty HTTP fallback boundaries in actual UI; never replace rejects with fake successful gameplay | CHAT-01 / native subsystem owner | `LIVE_UNVERIFIED` |
| P1 | Full 2026 Military Campaign/Ansiblex/new hull behavior with source evidence and authoritative transaction tests | Assigned specialist subsystems | `BLOCKED_CROSS_OWNER` |
| P1 | Re-run diff when a post-November 10 SDE exists; new expansion is **not** current on Oct 25 | CHAT-02 future task | `NOT_YET_RELEASED` |

**CHAT-01 integration contract (only if desired):** Do **not** hook this read-only audit into runtime or deployment without a distinct owner-approved requirement. If a preflight is wanted, run `node scripts/coop-compatibility-audit.cjs --code-path <separate pin checkout>/Code --manifest <generated manifest> --require-manifest --json` *as a pre-deployment validation step*; nonzero exit blocks deployment. No new native anchor, no feature flag, and no persistent-state mutation are needed. The centralized deployment script remains owned by CHAT-01.

## Testing and what was not done

- Executed local Node 22 fixture tests for both independent CLI libraries. No real pinned checkout or live SDE was in this execution environment; a source contract smoke check was also performed by reading pinned GitHub files and testing each signal directly.
- Did **not** run upstream Node/Rust integration, overlay installer roundtrip, Docker, live client, two pilots, or gameplay acceptance. Tests on fixtures cannot substitute for any of those.
- Did **not** modify `integration/coopVirtualWorldRuntime.cjs`, `scripts/patch-evejs-coop.cjs`, deploy scripts, other chats' mechanics, CCP binaries, volumes, or `state/`.
- Remaining status: `CODE_READY / LIVE_UNVERIFIED`; no `DONE` claim.