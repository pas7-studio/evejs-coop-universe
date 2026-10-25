# EveJS LivingCoop — shared economy, capsuleer progression and faction play (V1)
Status: **implementation specification / NOT deployed**. Branch: `feat/npc-personal-memory-20261024`, draft PR #2.
Upstream pinned: `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

## Player goal

Two separately authenticated capsuleers form ONE **native EveJS fleet**, can actually warp, fight, loot, trade spare ships/items, mine, refine, manufacture, sell, buy, advance factions and finish cooperative missions. Every activity changes the SAME authoritative persisted world. The game must be satisfying in sessions of 60–120 minutes and allow meaningful ship/skill progression over days rather than vanilla-EVE-scale months. **Keep player ownership, economic costs and losses real.**

Nothing in this document authorizes remote deployment, `main` merge, server restart, file reset, market-data rebuild, CI trigger or modification of the existing `evejs-data` volume. Do not run unapproved native-client binaries. Treat the 2-client proof as BLOCKED until an authorized compatible EVE client can be tested.

## Reuse real single-player EveJS systems — DO NOT create competing mock subsystems

- **Fleet:** `services/fleets/fleetRuntime.js`, `fleetObjectHandlerService.js`: native create/invite/accept/roles/leave/reconnect/broadcast and native `beyonceService` Warp Fleet. Use real membership/permissions on all cooperative operations. A rendezvous message is NOT a fleet.
- **Items/ships:** `services/trade/tradeMgrService.js`, `inventory/itemStore`, `typeListAuthority`: both docked to same station, both accept manifest; only owned tradable items and **inactive** hulls. Current upstream transfer performs wallet first and item transfers separately, so multi-asset crash-safe atomic settlement is NOT yet solved. Never invent direct inventory transfers or duplicate hulls.
- **Industry and crafting:** `industry/industryRuntimeState.js` quotes/installs/delivers real manufacturing and research jobs, authentic blueprint instances, skill/facility/tax constraints, actual material consumption. `station/reprocessingService.js` does legitimate ore-to-mineral processing.
- **Market:** `market/marketProxyService.js` + Rust market daemon with real orders/stock/delivery/escrow and market transaction journal; `integration/coopNpcMarket*` experimental seed-only NPC trading has not earned live acceptance. Separate personal NPC-owned orders require true owner-wallet and escrow support.
- **Skills and premium:** `skills/training/skillQueueRuntime.js` + `skillTrainingMath.js`, `skillCloneRestrictions.js`, `subscription/subscriptionMgrService.js`, `newEdenStore/storeState.js`. Native `config.skillTrainingSpeed`, Alpha training at half Omega rate, 5m SP Alpha cap, account license resolution and `grantOmegaDaysToAccount` already exist. Use one authoritative account-license rule for client, queue, caps and skill usage; never grant skills by changing visual clone state alone.
- **Quests and factions:** `agent/agentMissionRuntime.js`, `agentMgrService.js`, `dungeon/dungeonRuntime.js`, mission journal/tracker and native `standingRuntime`. Real owner-specific reward/standing/history writes are authoritative. Existing `coopFleetMissionTurnin` is an early completed-objective-only path; group combat objective sharing is still an **in-progress gated implementation**, NOT verified end-to-end.
- **Living NPCs:** actual EveJS mining fleets, ore cargo, hauling, pirate engagement, native damage/wreck and durable identities. `coopVirtualWorldRuntime` already connects a *virtual* delivered-ore sink to virtual economic supply; this sink IS NOT a native market/industry inventory.

## P0-0: completed real two-player gameplay gate (do FIRST)

A and B independently log in, invite/accept one native fleet, warp as fleet, fight one existing real NPC, suffer/inflict native HP loss, obtain one physical wreck, remove a real item exactly once, transfer a spare ship and an item in the same station and reconnect with the same physical hull/inventory. All steps must be verified in **both real EVE clients**; server accepted orders alone NEVER pass. Preserve current game state.

DoD: fleet membership + permissions in BOTH client UIs, non-command member opt-out, genuine follower landing, native gift recipient ownership after relog, item split and stale manifest negative cases, same mission journal/award semantics; no duplicates after forced disconnect.

## P0-1: durable shared mission lifecycle (not just same quest title)

Use native **fleet membership AND specific accepted mission instance AND participant roster + real contribution**. Shared mission group is anchored to a single mission objective/instance, not simply two coincidentally equal `contentID` values; *per-character* journals/standing/rewards remain owned by EveJS.

- A initiates mission and invites B via native fleet before shared objective activation; B explicitly accepts participation and can see the objective/journal marker. Use native dungeon site/instance as authoritative source. Roster is snapshotted at activation, with explicit join/leave/reconnect policy.
- Credits come from authentic encounter kill/HP damage, escorted native hauler arrival, item deposit, mining output or objective interaction, not a timer, command or mere proximity. Verify ship/session on the real site; preserve a contribution log (event ID, fleet ID, native instance, character ID, objective, time, participant proof). Deduplicate across reconnect/restart.
- On native objective completion, mark each eligible participant's own accepted journal progress idempotently. For a joint courier/delivery, consume the required items ONCE from the actual deliverer or recorded pooled cargo; do not debit both players. A passenger AFK at a station does not qualify. If B disconnects mid-op, retain validated contribution and do not delete B's mission.
- The native `doAgentAction` for each verified eligible participant performs each own completion reward/standing once. Persist a per-instance/per-character completion journal with PENDING, AWARDED, UNKNOWN/REPAIR statuses. A crash between external reward and journal commit **must NOT automatically retry blind**, else double ISK/LP/items. Prefer idempotent native reward transaction IDs before enabling automatic shared payout.
- Separate convoy defense, pirate pursuit, salvage, courier, mining delivery, basic manufacturing procurement and faction patrol contracts. First V1 focuses on *dungeon combat + one convoy escort*, not every mission template or storyline.

DoD: one shared mission appears for A and B; each sees progress; only actual eligible participants receive credit; each own reward exactly once; disconnect, wrong fleet, wrong instance, duplicate events and re-accept do not clone rewards; native mission completion alone does not imply both client UIs have updated.

## P0-2: make ore into actual usable goods

No hidden resource creation. The live ore chain must be:
```
EveJS asteroid (finite rock) -> real miner cargo -> real hauler cargo
  -> durable native depot inventory (transfer with debit receipt)
  -> station reprocessing job -> real minerals
  -> native blueprint manufacturing job -> real ship/module/ammunition
  -> real owner hangar -> docked direct trade / real market order
```
The current virtual depot **must not** be treated as native stored cargo. Build a new real inventory-backed depot/industrial owner with exact source-item debit, persistent delivery ID, cargo ownership and failure recovery; integrate virtual supply only from verified deliveries. An item may participate in only one of: native inventory, reserved industry materials, escrow, cargo in transit, salvage; no parallel phantom balances.

First recipes: T1 frigate, ammo, simple modules, T1 industrial hauler; work backward from available pinned EveJS blueprint definitions. Player and NPC industry use the **same** blueprint material/yield/cost/time authority; NPC owner funding and warehouse compatibility must be implemented before autonomous manufacturing, otherwise only real human jobs launch.

DoD: one observed NPC-mined ore stack appears once in depot, refines, produces a real item and sells in a legitimate market; force failures between each transfer and check no double-spend or missing goods.

## P0-3: market that players can actually use

Bootstrap limited stock **seed** buy/sell liquidity in Perimeter and nearby player-accessible stations (no zero-supply dead end). Set a transparent bid/ask spread, finite inventory, import/export budget, actual taxes, inventory/ISK delivery and order matching. Price response to delivery, consumption, ship losses and region demand must be gradual and capped; avoid profitable infinite buy/sell cycles against seed orders. Do NOT assert fully independent NPC market makers while that owner-wallet/escrow feature is OFF.

Build daily per-type supply/demand audit with currency/sink ledger: `initial stock + mined + crafted + imported - consumed - sold - destroyed = final stock` (with explicit documented sources/sinks). No arbitrary item minting to pay rewards.

DoD: A sells ore or minerals, B buys exactly what market filled, stock changes once, wallet and escrow correct, two-client display consistent, restart keeps orders. Native NPC seeded-market trading remains behind opt-in until durable replay passes.

## P0-4: reasonable capsuleer development (initial recommended balance, tune with playtests)

**One source of truth** for account clone grade across `subscriptionMgrService`, `skillTrainingMath`, `skillCloneRestrictions`, skill queue, ship/module skills and game-client UI. Audit `config.omegaLicenseEnabled` and persisted account Omega expiry together; do not show Omega while training as Alpha.

Recommended **closed two-player server default:** both accounts receive the same 30-day in-game Omega license through native `grantOmegaDaysToAccount` (no real-world payments) and a **global skillTrainingSpeed of 6** (relative to vanilla Omega speed). Alpha remains 0.5 of equivalent Omega at that global speed and retains restrictions; provide a transparent in-game ISK/time-based path to Omega for additional players if needed. Expose duration and effective SP/min in client and diagnostics, persist training across offline time/restarts; do NOT grant raw SP by blindly changing client attributes. Cap any one-time catch-up boost and make training-rate changes safely rebase active queues.

Tentative **play-session goals** (not promises — verify against rank/attribute/SP calculator): immediately can fly a starter T1 frigate, a chosen duo role becomes practical in 1 evening, new destroyer/fitting in 1–2 evenings, basic cruiser/industry specialization over 2–4 evenings, battlecruiser in roughly 3–5 days, first battleship path in roughly 1–2 weeks. Higher-end capitals remain long-term achievements. Test progression for *new* accounts and average 60–120 min sessions; tune from real skill queue outputs.

For production separately adjust JOB TIME **without** changing material costs: proposed `industry duration x0.35` for small T1 modules/ammo/ships via a centrally configured multiplier with bounded minimum duration. Blueprint research/ME/TE and economic supply still matter. If player mining grind is excessive, adjust actual player mining yield cautiously (e.g. x1.25), not by inventing NPC ore at depot. Keep loss consequences, ship insurance, repair and purchase costs material.

**Premium policy:** Omega is an earned/renewable *gameplay progression mode*, not a payment product. Both friends should get equal access; optional cosmetic/status 'supporter' must not grant exclusive combat power. Do not invent fake premium metadata unrelated to the stock client. Begin with actual native Omega status and license expiry UI.

DoD: after restart both accounts have identical agreed training conditions; UI shows real Omega; 60–120 min sessions produce useful skill and manufacture progression; skill caps/queue/offline/relog match server authority; Alpha/Omega boundaries and expiration have regression tests.

## P1: AI jobs / industrial factions / long-form stories

- **Autonomous mining:** goal-driven native miner/hauler fleet roster tied to real belts, actual rock depletion, risk, load threshold, safe return, respawn cooldown and protection standings. Emergency distress and pirate raids use existing real NPCs. No ghost ore.
- **Autonomous manufacturing:** actual NPC-owned funded blueprint jobs consuming depot minerals, producing finite fitted replacement ships/modules and field resupply. Must implement native NPC inventory account, wallet, tax and settlement first. A destroyed factory convoy reduces actual production.
- **Trade and logistics:** bots pick real routes from regional stock/demand and move native cargo in physical ships; piracy/escort change stock and prices. Real NPC order listing only after owner/escrow is fully modeled.
- **Factions and reputation:** native standings gates affecting stations, broker fees, access, patrol hostility and available faction agent chains. Reputation must track actual attributable actions with durable per-event IDs; punitive acts/escort rescues matter even if no quest active.
- **Repeatable quests:** role-tailored patrol, salvage, industrial supply, mining, research, bounty and escort with generated targets drawn from actual world state, not guaranteed arena NPCs; authored faction story arcs plus emergent events.
- **Player choice:** you can mine/build/sell, escort a logistics convoy, hunt pirates, complete faction operations, or raid enemies; all use the same money, inventory, standings and NPC world.

## Ordered delivery for agents (keep in the SAME draft PR until user authorizes otherwise)

| ID | Priority | Deliverable | Key acceptance |
|---|---|---|---|
| COOP-P0-01 | P0 | native fleet invite/accept/follow + two authenticated clients | real UI, opt-out, warp and reconnect |
| COOP-P0-02 | P0 | docked item/inactive ship exchange | real ownership/manifest, no dupes, no active hull |
| COOP-P0-03 | P0 | shared mission objective + per-player journal/reward idempotency | two eligible rewards once, excluded AFK participant |
| COOP-P0-04 | P0 | real depot and ore/industry transaction chain | one ore -> one mineral/ship chain, crash safety |
| COOP-P0-05 | P0 | seeded live economy and starter liquidity | actual orders, ISK, inventory, finite stock |
| COOP-P0-06 | P0 | cooperative skill/clone pacing + Omega parity | true 6x native queue; identical client/server clone state |
| COOP-P1-01 | P1 | NPC autonomous blueprint jobs and funded inventory | no free NPC material, actual real production |
| COOP-P1-02 | P1 | physical NPC trade routes, risk/reward | native cargo moves, ship loss changes stock |
| COOP-P1-03 | P1 | authored and emergent faction quests | real contribution, standings and consequences |
| COOP-P1-04 | P1 | combat/industry balance for repeatable 2-hour play | telemetry + real two-client playtest |

Do not close any P0 only because Node tests pass. Run authorized server, industry, market and **two real clients**, retain exact commit/image evidence, and attach proof to PR. Mark each integration BLOCKED vs VERIFIED precisely. No reset of existing persistent world.
