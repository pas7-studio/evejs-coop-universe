# P1 native co-op operations: tactics, logistics, real world events

2026-10-25 · Owner: co-op P1 stream · pinned native EveJS `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`

**Implementation state:** CODE + ISOLATED SOURCE/LOGIC TESTS; NOT DEPLOYED; NOT TWO-CLIENT LIVE-PASS. Feature branch `feat/coop-p1-tactical-convoy-operations-20261025`. This integrates existing authentic EveJS multiplayer systems; no competing wallet, cargo, combat, NPC ship or quest authority.

## One executable vertical slice across the three P1 priorities

| P1 priority | Actual integration delivered | Player consequence / scope |
|---|---|---|
| Tactical co-op combat | A true native Eve fleet commander can mark a physically present pirate as fleet target **1**, and its actual mining-fleet victim as fleet target **2**, but only while an authentic native pirate order + physical ships/real cargo are present | Player A tackles/attacks the pirate with ordinary EVE weapons; B escorts the ore carrier, repairs/supports, or loots the legitimate native wreck. No scripted fighting, auto-DPS or invented encounter |
| Shared economy and logistics | Players inspect real ore in real mining NPCs; native **personal** courier contracts are read from `contractRuntimeState.filterMyCurrentContracts`, not from virtual economy. A native fleet commander marks actual acceptor ship **3** only if a valid native in-progress contract belongs to the current issuer and acceptor, both are genuinely in fleet, and the **real itemStore plastic wrap** is inside the acceptor's active ship cargo hold | Actual rewards, collateral, plastic-wrap item, ISK and package transfers are **still controlled by stock EveJS contract handlers**. No player gets a fake delivery or income by calling /coopops |
| Autonomous world events | Existing `coopNativeRaids` orders accepted by EveJS are converted to bounded in-memory raid incidents; native verified wrecks resolve `PIRATE_DESTROYED` or `CONVOY_SHIP_LOST`. `coopWorldSignals` adds a clickable-in-mental-model **/coopops status** suggestion to its already native-verified pirate alert | Players can react during a real living-universe attack. No events spontaneously created without native ships, mining fleet membership and ore |

## Commands in the existing EVE client chat

All commands require the **explicit** `EVEJS_COOP_P1_OPERATIONS=1` opt-in, set via `-EnableP1Operations` in `scripts/Deploy-Coop-RuntimeProbe.ps1`. The flag is **OFF by default**, including under `-LivingCoop`.

| Command | Actual result | Permission |
|---|---|---|
| `/coopops help` | Show available gameplay commands | Character session; help only |
| `/coopops status` | Live native raider/target, ore, distance, verified wreck outcome, current two-pilot role declarations | Two ready **distinct** authenticated characters and physical ships in a single genuine stock fleet, same solar system |
| `/coopops convoy` | Actual physical stock miner/hauler NPC IDs and their current persisted cargo quantity | Same co-op gate |
| `/coopops focus <pirateID>` | Native `fleetRuntime.setFleetTargetTag(..., "1")` against incident pirate | Authorized real native fleet commander/creator; cannot target players or arbitrary NPCs |
| `/coopops guard <minerOrHaulerID>` | Native target tag `"2"` on confirmed attacked stock mining vessel | Authorized fleet commander |
| `/coopops role <intercept\|escort\|salvage\|haul> [pirateID]` | Share a short-lived intent, bound to native fleet ID, ship ID, character and actual incident | Authenticated on-grid pilot; **does not** change stats or automatically operate modules |
| `/coopops deliveries` | Caller’s own/accepted personal courier contracts (start/destination/reward/real status) from stock authoritative contract runtime | Native per-character contract filter, additionally rechecked against issuer/acceptor owner |
| `/coopops escort <contractID>` | Native tag `"3"` on current acceptor's active ship, only when the real `typeID=3468` wrap, `flagID=5` ship cargo, real owner and exact item ID match persisted contract | Real issuer+acceptor in the same fleet; role-checked native fleet commander |
 
`/coopops` is a coordination layer for humans, **not** an RPC that changes combat damage, contents of cargo, wallet balances, escrow, standings, native wreck items, ship fitting, skills or contracts.

## Real game authority and evidence chain

1. `coopNativeRaids.tick()` verifies an actual mining-fleet member, an actual physical NPC raider ship, ore and successful `npc.issueAttackOrder` or `npc.warpToEntity`. Its returned accepted action is passed to `coopFleetOperations.recordNativeRaid()` from the existing `coopVirtualWorldRuntime.advanceNativeRaids()` path.
2. `recordNativeRaid` does another independent stock mining-fleet membership lookup and actual NPC cargo lookup. A client cannot create an incident by sending a chat command; chat only reads existing accepted incidents.
3. Two separate native fleet members with genuine sessions and real ships can inspect and tag. Stock fleet runtime itself enforces commander rights and broadcasts tag changes; an unchanged tag is a native no-op, not a failure. Unauthorized users cannot claim an existing tag as authorization.
4. `confirmedNativeNpcWreck` only calls `recordNativeWreck` **after** the already-existing verification path reported `PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED` or `PHYSICAL_NATIVE_WRECK_VERIFIED`. The helper confirms actual `nativeNpcStore.getNativeWreck(...).sourceEntityID===npcID`; an order or vanished ship alone NEVER counts as a kill.
5. Courier contracts read stock `contracts/contractRuntimeState`, whose own `filterMyCurrentContracts(session,...) ` decides visibility. The actual package must be in the correct player's **current** native physical ship at the time the escort command is issued. Package movement, station docking, delivery and reward are native EveJS transactions, not reconstructed from an NPC depot ledger.

**Constraints:** incidents, role intents and resolved messages are intentionally process-local 10-minute cache, not persistent new quests. A restart drops live tactical notices, but does not mutate native ships or courier contracts. This is preferable to pretending a stale raid is still underway. The in-memory event cache is bounded and garbage-collected.

## Files and L1 / L2 layout

- `integration/coopFleetOperations.cjs` — one L2 integration module: genuine fleet, contracts, cargo and NPC incident checks + chat operations.
- `integration/coopVirtualWorldRuntime.cjs` — inserts three feature-gated L2 calls into already authorized native raid/real wreck observations.
- `integration/coopWorldSignals.cjs` — existing native raid announcement includes a concise in-client action hint only when flag enabled.
- `scripts/coop-p1-operations-native-patch.cjs` — **one** opt-in L1 statement in pinned `server/src/services/chat/chatCommands.js` and byte-exact reversible anchor. All logic stays in L2.
- `scripts/patch-evejs-coop.cjs` — transactional manifest adds one native source spec, one L2 copied module.
- `scripts/Deploy-Coop-RuntimeProbe.ps1` — optional deployment flag, default off; does **not** authorize a deployment.
- `tests/coop-p1-tactical-convoy-operations.test.mjs` — 12 real authorizer/role/raid/wreck/source wiring tests.
- `tests/coop-p1-native-courier-escort.test.mjs` — 5 genuine contract/plastic wrap/narrow native ship ownership tests.
- `tests/coop-p1-native-raid-alerts.test.mjs` — 3 native raid notification opt-in/out and spoof denial tests. Test files are auto-discovered by the latest `Verify-Local-Coop.ps1`; do not add a parallel static test list.

## Validation already completed and next exact gates

**ISOLATED LOGIC PASS:** 12/12 tactical/raid tests, 5/5 courier/logistics tests and 3/3 event-notification tests executed with mocked stock native dependencies in a V8 JavaScript harness. The full pinned `chatCommands.js` (341,912 bytes) accepted the hook and passed: one apply modifies, second apply no-op, one remove restores **identical** original bytes, second remove no-op, final patched source valid JS. This proves source contract compatibility only.

**NOT YET PASSED:** native Node `node --test` on project checkout, complete `scripts/patch-evejs-coop.cjs --dry-run` against pinned checkout, project regression baseline, Docker image, native launcher and two genuine clients.

In separate authorized local environments:
```powershell
$env:EVEJS_COOP_CODE_PATH = 'C:\Games\EveCoop\upstream-evejs\Code'
node --test tests/coop-p1-tactical-convoy-operations.test.mjs tests/coop-p1-native-courier-escort.test.mjs tests/coop-p1-native-raid-alerts.test.mjs
node scripts/patch-evejs-coop.cjs --code-path $env:EVEJS_COOP_CODE_PATH --dry-run
node scripts/coop-test-baseline.cjs
```
Deploy **only after owner approval**, and use stock 2-player game clients. A and B create a true fleet; real pirates autonomously attack a native NPC mining fleet; on real ship grid, A tags pirate, B guards hauler, both roles visible in status. Under real separate personal courier contract, B physically loads the real plastic wrap into their current cargo hold, A marks the physical ship, B reaches actual destination and completes via native contract UI. Assert real wallet changes / courier wrap and stock inventory state **before/after**; verify no double credit after re-login and controlled crash in a disposable test database. Lose pirate or hauler only by real damage and native wreck; status reports verified resulting wreck, no fake payout.

### Residual risk / next development

- P0 blocker persists: stock `contractRuntimeState` escrow, wallet and itemStore movements are not globally crash-atomic. Our new command deliberately **does not** take ownership of those transactions. No claim of crash-safe courier rewards.
- Two pilots still do not automatically share one NPC kill bounty or mission payout, and no P1 co-op combat damage bonuses have been fabricated. Native EVE fitting, tackle, remote repair, drones, warp and fleet commands already provide tangible distinct roles; balance and acceptance tests are required for tuned tactical enemy behaviors.
- NPC mining ore delivered to `coopNativeDepot` still is not a player-owned real `itemStore` stack. Virtual economy supply must not be sold as real warehousing. A future native deposit/escrow owner and evidence ledger is its own P0 economics workstream.
- Only verified native NPC raids are linked to incident operations. Native wormhole, faction and exploration incidents belong to other nonoverlapping streams; do not duplicate PR #15 exploration.
- Any user-facing world event still requires a real accessible native scene, a live accepted pirate order and real stock mining-fleet cargo. Text notifications alone do not count as a new content system.
- No changes to running Docker, `main`, `evejs-data`, CI or on-host containers during this feature branch implementation.
