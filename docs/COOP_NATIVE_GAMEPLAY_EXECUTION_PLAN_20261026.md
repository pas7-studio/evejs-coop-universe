# EveJS Co-op: Native Gameplay Completion Program (2026-10-26)

**Scope:** close original EveJS gameplay gaps for two real players without cloning native services. **Baseline:** `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`, client 24.01 build 3396210. **Baseline for this plan:** co-op `main@e62c12590d90a799f5e67227c8875569b41734f5` (PR #158 merged; inspect latest main before integrating anything). **Status:** planning plus first read-only catalog/gate implementation, NOT a runtime feature release or verified EVE multiplayer session.

## Rules and architecture

1. **Single authoritative EveJS world:** original `GameStore`, `itemStore`, live `fleetRuntime`, `sessionRegistry`, `spaceRuntime`, `marketProxyService`/Rust and native wallet/mission/industry services own gameplay. A-Life is a policy/decision layer; it cannot independently create stock, wallets, character sessions or reward records.
2. **One installer:** use `scripts/patch-evejs-coop.cjs` (copy registration `names`, native `specs`, reversible `transform`) and `Deploy-Coop-RuntimeProbe.ps1` as the existing operator path. A feature appearing in `integration/` but absent from `names` is not deployed by the standard path. A `specs` registration is not proof that the correct method is hooked: dedicated pinned-source roundtrip tests are required. No second patch mechanism.
3. **One A-Life tick:** existing 30-second native economy/NPC director schedules orders, mining, salvage, patrols. Do not spawn competing background schedulers. Actions require a real native ship, source inventory, local station, funded corporation and durable receipt.
4. **Ownership boundary:** client requests carry intent, NEVER trust client-provided cargo provenance, rewards, positions, ownership or mission contributions. Resolve authority from exact authenticated session/ship, native fleet, materialized NPC and persisted native identities.
5. **Durability:** use original durable GameStore+SQLite transactions when both source/destination are in one store. For Rust market vs GameStore and other external stores, use immutable per-operation journal + idempotent claim/ack/reconciliation. An ambiguous external ACK means `UNKNOWN/NEEDS_OPERATOR_REPAIR`, not blind retries. Preserve the user's `evejs-data` volume. Financial and inventory guards remain default OFF until disposable-world acceptance.
6. **User-facing integration:** re-use native agent dialogue, journal, contractProxy, fleet, bookmarks, mail, fitting, market and corporation UIs. Don't create a slash-command-only duplicate game system. If the pinned client protocol cannot show a result, mark that client gate BLOCKED and repair only the necessary native RPC contract.
7. **No remote CI or automatic deployment.** Manual local Node source tests and pinned installer dry-run precede disposable SQLite/Rust crash tests; server-native World proof precedes one client and finally two-client real UI proofs. All changes are reviewable PRs; this initial PR does not change flags or the live world.

## Implementation wiring: cause -> owner -> outcome

```text
native session/character + current ship
   -> native fleet membership / warp / ballpark
   -> authenticated player + NPC physical interactions
                 |                  |
        kill/wreck/loot        asteroid/miner/hauler
                 |                  |
      native itemStore    native npcCargo -> native corporate itemStore
                 |                  |
                 +------> refinery / blueprint native industry
                                     |
                              original manufactured item
                                     |
                         native Rust order + native escrow
                                     |
                        verified item custody + wallet receipt
                                     |
                   native standings / jobs / supply/demand signals
                                     |
                         existing A-Life 30-second director
                       (decides next NPC action, no new inventory)
```

**Economic identity joins**: `sourceCargoID`/`itemID`/`ownerID`/`locationID`/`typeID`/`quantity`/`operationID`. **Contract identity joins**: original `agentID`, source event, `missionInstanceID` or exact native contract ID, `fleetID`, separate accepted character IDs, native corporate escrow ID, paid terminal receipt. **Travel identity joins**: `shipID` + actual scene/system + native gate/wormhole entity ID + authoritative destination state. **Faction identity joins**: native faction/corp membership + capture site ID + per-character contributions + victory-point transaction + occupation state. Do not bridge systems by titles, rounded timestamps or visually similar entities.

## Stage A: two players and physical world — foundation (P0)

**A1 Session and fleet authority.** Reuse `sessionRegistry`, `clientSession`, `fleetRuntime`, `space/transitions`, `coopSessionPresence`, `coopNativeFleetParty`. Fail closed if one character has two active scene sessions or if a fleet member is not a distinct physical ship. Relog must transfer active scene admission only after native old session eviction. Do not create a parallel party membership table.

**A2 Fleet warp, combat and loot.** Reuse `beyonceService`/movement, `coopFleetWarpSafety`, `coopFleetWarpArrival`, native `npcBehaviorLoop`, killmail tracker, `nativeNpcWreckService`, `coopNativeLootPickupEvidence`. Require actual follower warp landing and full damage/wreck/item source-debit witness. Verify one player disconnect/reconnect, stolen loot, partial wreck split and real client overview visibility. Native `crimewatchService` handles suspect outcomes; no synthetic fleet loot rights.

**A3 Player trade.** Reconcile `coopNativeTradeAtomic` and `coopNativeTradeCustody` with native `tradeMgrService`/`itemStore`/wallet. Source item/ship may never simultaneously be in trade staging and owner hangar. Distinct container IDs after restart, active-trade escrow and terminal settlement all require durable original item IDs. Failure injection at stage, accept, wallet debit and final ownership mutation; ambiguous states block rather than mint.

**A release gate**: two authentic clients on one server, same fleet, same grid and NPC kill, exact physical loot, docked item + inactive ship trade, relog and native ship persistence; no client slash commands. Evidence: `GAMEPLAY_TESTING.md` and native item/wallet before/after snapshots. Upstream `World` Perimeter (30000144), not Jita for asteroid tests.

## Stage B: closed resource economy (P0)

**B1 Durable original NPC ore chain.** Continue existing ALIFE-07/08/09/10/11/12 and issue #148 (startup-wide pending cargo audit). One original asteroid depletion -> NPC miner cargo -> original hauler cargo -> physically witnessed station arrival -> original `itemStore` corporate warehouse stock. No timer-only teleport and no virtual depot as saleable inventory. Startup reconciles unresolved receipts for every restored miner/hauler before new mining; unprovable records quarantine.

**B2 Reprocessing + industry.** Reuse `reprocessingService`, `industryRuntimeState`, `blueprintManagerService`, `coopNpcManufacturing*`, `coopNpcRefinery*` and prepared `coopPlayerIndustryGuard/Fence`. Plan native hooks only after exact pinned `--dry-run` and ownership review; move one real source stack into refinery once, produce original minerals, install real job with material + ISK tax debits, deliver one original manufactured stack. Player/corp job division and BPO rights are native. `coopIndustryPacing` may shorten time but must not bypass any native debit/skill/prerequisite.

**B3 Native market and NPC consumption.** Reuse Rust orderbook + `marketProxyService`, native `marketEscrow`, `coopNpcCorporateSettlement`, `coopNpcBuyerCoordinator`, `coopAlifeSalvageMarket`. Close ordinary player-player fill/cancel/refund cross-store gaps documented in `COOP_CHAT29_NATIVE_MARKET_CANCELLATION_20261025.md`; especially sell-side escrow return and buy-side funds proof. Reject seed/virtual stock as an independent NPC seller. Only verified trades advance A-Life demand and corporation cash. No auto-recovery of an unknown external Rust ACK.

**B release gate**: mine finite ore -> durable original cargo -> refinery -> original blueprint manufacture -> player-owned real market order -> funded purchase -> exact buyer item and seller ISK after restart, including controlled failures at every custody boundary. Separate source/target/escrow accounting, no duplication. Use disposable GameStore/Rust SQLite copies, never protected game volume.

## Stage C: in-game professions / earning (P0/P1)

**C1 Native paid job discoverability.** Reuse `coopWorldOpportunityBoard`, `coopNpcJobBoard`, `coopNativeJobAgent`, stock `agentMgrService`, EVEmail. A-Life authentic shortage/route/site becomes ONE event and ONE offered job keyed by original source event; never a second economy. Agent Accept requires own authenticated session, actual supported SDE agent, native fleet enrolment and corporate quote. Human users do not type `/jobs` or `/events` to accept; chat can remain diagnostic fallback. Finish issue #112 client UI test first, then #113 native journal/location tracking.

**C2 Escort and miner guard.** Preserve merged PR #158's peaceful escrow/terminal receipt; don't reimplement payout. Verify post-crash delivery/resume and exactly-once wallet receipts. Derive reward from actual corporate escrow and demonstrated physical route/attendance; pirates are optional risk, not mandatory fabricated kills. Miner shift payout proportional to real protected work/coverage (issue #105), no timer-only idle income. Fully separate paid player jobs from native stock agent missions and their personal rewards.

**C3 Courier, rescue, salvage, patrol.** Reuse native `contractProxy/COURIER`, source-backed manifests, Stage J original wreck custody/atomic transfer, native NPC corp buy/sell. Each job type has an explicit event type and exactly one authoritative settlement state machine. LOST/STOLEN/DELIVERED status must come from physical GameStore evidence and become an A-Life economic signal. Add contract progression/standing only after settled payouts and real incident receipts.

**C release gate**: client Agent -> Accept A and B -> physically follow original job -> native journal progress + wallet/ISK and optional LP once; no AFK credits; reconnect, cancellation, expired offer, unknown reward response handled. One successful peaceful escort and one failed/rescued contract on disposable world.

## Stage D: remaining native professions and co-op loops (P1)

**D1 Discovery.** Reuse `scanMgrService`, `probeScanRuntime`, `coopNativeScanProof`, native access-group bookmarks, `beyonceService`. One 100% server-verified signature -> native share permissions -> B's physical warp -> original site/hacking/loot. Never turn user-supplied coordinates into a free perfect scan. Keep existing native bookmark delay unless genuine permission + native fleet support a reviewed exception.

**D2 Wormholes.** Reuse `wormholeRuntimeState`, `wormholeMgrService`, `coopWormholeJumpFence`. Its source-available guard is not centrally installed. Add single reversible hook, commit mass/polarization state before the original ship transition, block impossible second jump after collapse, preserve exact ship over reconnect. Two independent players cannot share one mass debit.

**D3 Player corporation and PI.** Reuse native `corpRegistryRuntime`, `corporationRuntimeState`, `corpWalletState`, `invBrokerService`, `coopPlayerCorporationAccess`; add access guard to the one installer after pinned tests. Corp hangar divisions and wallet authority are never inferred from fleet roles. Integrate prepared `coopPiIntegrityGuard` into native `planetMgrService` only once launch/ItemStore/corporate customs and offline simulation crash fences are tested. PI commodities join the SAME native industrial chain, not a new virtual supply source.

**D4 Drones, fighters, clones and skills.** Reuse original native `droneRuntime`/`fighterRuntime`, `coopDroneFighterAuthority` (verify source method hooks), `jumpCloneService`, implant/dogma, `skillQueueRuntime` and prepared clone/skill guards. No independent drone owner table or direct SP injection. Existing world's configured training multiplier is authoritative; rate changes require all-player migration and durable old-rate settlement, not silent 100x/48x switch.

**D release gate**: co-op scanner/hacker/wormhole trip; two users with independent permitted corp assets and PI outputs; independent drones and clone/skill progress survive relog. Validate each vertical independently, never one impossible mega test.

## Stage E: actual faction war (P1/P2)

**E1 Native enlistment safety.** Stage existing `coopFwEnlistmentGate` through central installer; real native faction IDs, standings, corporation permissions, retirement cooldown; no opt-in guard before two-client UI and persisted native membership check.

**E2 Build missing capture authority, not a UI fake.** Implement ONE durable `FactionCampaignDirector` adapter over stock `facWarMgr`, `fwVictoryPointMgr`, `fwWarzoneSolarsystemService`, native dungeon/site/space/ship combat and A-Life patrols. One site has real position, faction owner, timer, contest eligibility and contribution receipts. `CAPTURED` is a single unique native outcome; VP/occupation updates must commit before rewards. The current native occupation shell and `200 emptyPayload` campaign gateway are not a legitimate capture engine. Avoid inventing a 2026 Military Campaign client protocol on the pinned 2024 build.

**E3 Living geopolitical consequences.** A-Life consumes committed conquest events to change patrol routes, resupply, industry demand, NPC station security, transport risks and native faction standings. It never alters occupation without E2 capture authority. Mission/contract/LP rewards use the same wallet/standing/LP authorities from B/C. Players may join the militia, protect logistics, fight, sabotage (subject to Crimewatch), and see persistent consequences in the native UI.

**E release gate**: two clients enlist, one contested native site, physically contribute, capture/defend, one VP/occupation change, one valid reward per eligible pilot, realistic NPC response; replay/restart cannot duplicate territory or LP.

## Stage F: structures and high-end content (P2)

**F1 Native corp structures, alliances and sovereignty.** Start with `structureDeploymentService`, `structureVulnerabilityService`, original structure assets, corp/alliance roles and `coopStructureAllianceAuthority`. Reuse B's ownership+wallet+materials and E's occupation, only if actual native structure placement/fuel/reinforcement transitions exist. No shadow ownership and no structures spawned as reward. Implement deploy/fuel/upkeep/reinforcement/destruction/asset return as distinct receipt-backed state transitions.

**F2 Instanced endgame.** Audit existing native `incursionRuntime`, `abyssalMgrService`, dungeon authority before changing anything. Share a specific native instance and physical fleet presence, not similarly named quests. Enforce entry/exit, timeouts, NPC losses and source-verified reward settlement using C's participation ledger; decide client feasibility before implementing extra protocol.

**F release gate**: persisted corp-owned structure survives relog or is genuinely destroyed with correct assets; separate two-player instanced mission has real entry, encounter, exit, reward and crash behavior.

## PR execution map and cross-stream ownership

| Order | PR slice | Touches / reuses | Dependency and completion evidence |
| --- | --- | --- | --- |
| 00 | Read-only feature catalog + dependency DAG + source-registration inspector (**this PR**) | `docs/coop-native-feature-catalog.json`, `scripts/coop-feature-readiness.cjs`, local tests | No deployment, produces source gaps without claiming LIVE_PASS |
| 01 | Session/fleet/warp/loot live gate fixes | Original native sessions, fleet, `beyonce`, wreck + co-op guards | A release gate and authoritative two-client logs |
| 02 | Trade stage/restart and player market atomicity | original itemStore/wallet, trade + Rust escrow | A then B failure injection with before/after balances |
| 03 | ALIFE-13 startup receipt recovery | original NPC cargo, miner/hauler, warehouse journal | all original pending receipts resolved/blocked before mining |
| 04 | Player/NPC refinery and industry hook integration | existing `coopPlayerIndustry*`, `coopNpcManufacturing*`, original industry | B exact ore->item producer receipt |
| 05 | Native market order cancellation/fill recovery | existing NPC finance, Rust pending, `coopMarketCancelCustody` | B exact-one item/ISK post-crash proof |
| 06 | Native Agent UX and existing Escort end-to-end | PR #158, `coopNativeJobAgent`, stock EVEmail | #112 then #113, real client interaction |
| 07 | Miner guard + courier/rescue job type contracts | stock COURIER, A-Life and Stage J | C paid shifts, cancellation/refund |
| 08 | Discovery and wormhole native integration | stock scanner/bookmarks and prepared wormhole fence | D physical two-player result, scan/collapse replay |
| 09 | Corporation + PI original custody | stock corp/planet + prepared guarded modules | D corp roles, PI customs debit, crash fencing |
| 10 | Drone, clone, skill guard integration | native dogma/drone/clone/queue | D cross-player ownership and saved offline progress |
| 11 | FW enlistment guard | native faction standing + prepared guard | E real client enlisted + persisted membership |
| 12 | FW capture/VP/occupation engine | stock FW shell + original dungeon, A-Life, ledger | E real-site to native occupation and reward |
| 13 | Structures/alliance/sov plus endgame audits | stock structure/dungeon/incursion/abyss | F distinct asset and instance release gates |

**Concurrency policy:** each PR has one native service owner and one installer integrator. Re-read `main` before rebasing; never overwrite a newer central installer with a stale branch copy. Planned guards remain default OFF. No PR is merged solely because a mock passed. Reconcile overlap with existing open PRs rather than duplicating their work.

## Read-only execution commands

```powershell
# Works without EVE client or Docker; prints source registrations and missing integrations.
node scripts/coop-feature-readiness.cjs
node scripts/coop-feature-readiness.cjs --json
node scripts/coop-feature-readiness.cjs --strict
# --strict exits 2 while deliberate integration gaps remain; this is NOT a unit test failure.

# If a legally usable pinned upstream source checkout is on disk:
node scripts/coop-feature-readiness.cjs --code-path 'C:\Games\EveCoop\upstream-evejs\Code'
node scripts/patch-evejs-coop.cjs --check --code-path 'C:\Games\EveCoop\upstream-evejs\Code'
node --test tests/coop-feature-readiness.test.mjs
```

`coop-feature-readiness.cjs` intentionally reads the actual `names`, `specs`, `PIN` exports of the **single installer** rather than copying its deployment registry. The feature catalog is a traceability map, not an alternative installer or a game state store. With `--code-path`, it also checks the exact upstream Git HEAD against the catalog PIN (unknown or mismatched checkout fails `--strict`). It reports source-level wiring only: registered modules and specs may still be flag-OFF, only partly hooked, incompatible with the real client, or not deployed. It does not read wallet, character, raw account logs or protected volumes; it does not enable any feature.

## Explicit non-acceptance / next live task

The original `state/NOW.md` is a historic local-machine snapshot at another SHA, not live verification of the current head. Current source checks do not prove runtime flags, native method binding, market.sqlite recovery, Agent buttons, two ship landings, player payments or rendered world NPCs. The operator's next live gameplay gate remains `DiagnoseWorld` and `World -WorldSystemID 30000144` on the exact installed revision, then one and two authorized clients. Keep the running protected world unchanged until a disposable-world acceptance is approved.