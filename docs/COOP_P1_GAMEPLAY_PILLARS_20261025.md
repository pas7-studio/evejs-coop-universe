# EveJS Co-op P1 — tactical combat, shared logistics and emergent events

Date: 2026-10-25. This plan and the initial tactical improvement are isolated from the concurrent P0 and exploration development. Native authoritative EveJS remains the source of truth for ship damage, targets, cargo, ISK, reputation and jump position.

## P1-A. Co-operative combat: more than two weapons on one target

**Delivered in this branch (source/logic verified; live clients unverified):** `coopDuoRaidTactics.cjs` and the existing `coopWorldSignals.cjs` distinguish **interceptor** and **convoy escort** when:
- A stock native NPC raid already actually targeted a physically present mining ship with ore;
- Exactly two active authenticated players and two separate native ships are in the same scene;
- Both characters belong to the **same real EveJS fleet** (`fleetRuntime` membership, not a virtual party);
- Interceptor is the closer ship to the actual pirate; escort is the other pilot; stable ID tie-break;
- The player receives a chat advice message only, with no synthetic target lock, damage, control effect, warp, loot or reward.
- Solo/no fleet/destroyed ship/different system/disconnected/third active character: fall back to the original native raid alert.
- Existing per-pilot raid alert cooldown remains in place.

**Native follow-on integrations for combat/AI worker (separate ownership):**
1. **Real modules over fake bonuses.** Inventory/fitting verified; assign EWAR tackle, long-range damage, remote reps, cap logistics using stocked EveJS fitting/dogma RPCs. No custom 'heal' or 'taunt' without a genuine native effect.
2. **Target priority and threats.** NPC should choose between real player damage, repairs, disruption, exposed hauler cargo, reputation and escape. Require physical AI controller evidence, no arbitrary scripted player targeting.
3. **Role success telemetry.** Record actual duration of tackle effect, real damage prevented on hauler, effective remote HP restored, actual native kill attribution, fleet member survival; no rewards until per-character witness is reliable.
4. **Accessible co-op instructions.** The captain and escort can agree on roles in native fleet chat; optional manual role preference, persistent only if backed by genuine character/fleet state. UI must show the same data as the server.

**DoD:** pilot A tackles/controls a pirate with native modules, B keeps real hauler alive with genuine modules or interception; physical NPC responds appropriately, both see a meaningful difference versus two pure DPS ships. Test solo, two pilots, three pilots, disconnect, changes of ship/fit, PvP. Preserve risk: failure can destroy ship.

## P1-B. Shared economy and logistics: meaningful specialization

**Current native basis:** player trade, native contracts (ITEM_EXCHANGE/COURIER), corp hangar and wallet, miner/hauler cargo, station reprocessing, industry job quote/install/deliver, real market escrow. Existing virtual NPC depot is **not** automatically a real itemStore station item.

**Delivery slices / dependencies:**
1. **Co-op miner + courier.** A mines a real asteroid, B collects real native cargo by ownership-aware trade/jetcan/contract, takes it to a real station. Both cargo IDs, quantities and the station itemStore must survive relog; no imaginary resources.
2. **Process and manufacture.** Same physical ore is consumed exactly once by reprocessing; blueprint materials deducted, a real job installed/delivered into owner/corp inventory, full base cost/tax maintained.
3. **Sale and fair settlement.** One real market order sells genuinely manufactured output; support per-party split through explicit wallet transfer or native contract, not invisible reward multiplication.
4. **Autonomous NPC participation.** The current `coopNativeHaulCargo` virtual receipt must be reconciled with true native inventories; NPC purchases use funded wallets, stock and escrow and respect finite supply.
5. **Controlled crash test.** Fail between transfer/ISK payment/depot write/delivery/job completion on disposable test data. Idempotent receipts, no source deletion before verified destination custody.

**DoD:** A gets real ore, B hauls, the duo produces one real item and sells it; conserved inventory and ISK, persists across server restart and two client relogs; stolen/destroyed cargo has consequences.

## P1-C. Living events players can react to

**Current native basis:** genuine attacks on miner/hauler ships drive `coopNativeRaids` and rate-limited `coopWorldSignals`; NPC behaviors and native standings already exist. Do NOT create random scripted explosions or invented kill/quest rewards.

**Delivery slices:**
1. **Actionable signal:** identify exact real native attacked ship, approximate legitimate location (not leaked private bookmarks), confirmed `attack` vs `warp-to-hauler`, threat level, remaining response window. Avoid spoilers and exact omniscient target coordinates.
2. **Player agency:** defend, assist pirates, steal ore, escort or abstain; native Crimewatch/standings/wreck/cargo reflect the decision. No guaranteed scripted outcome.
3. **Persistence and resolution:** incident ID from real attack/fleet/ship/system evidence, one incident lifecycle with dedupe. Status observed → engaged → saved/lost/stolen based on native server outcomes, not a timer pretending somebody won.
4. **Consequences:** NPC fleet replacement, faction trust, resource prices, patrol response, logistics interruptions are grounded in durable authoritative events and actual finite stock.
5. **Fairness:** cap concurrent events, rate-limit chat, don't spam solo or offline accounts, no random PvP attack without native legal rules; real distance/travel gives chance to respond.

**DoD:** same physical convoy can be attacked while A and B travel independently; they receive accurate alerts, coordinate, intervene before destruction (or arrive too late), observe materially different native wallet/inventory/standing consequences and a coherent aftermath after reconnect.

## Scope & agent separation

- **This PR owns only** the read-only tactical role decision helper, co-op raid message differentiation, its unit tests and P1 specification; it never edits active ship combat or NPC AI controllers.
- Combat/AI worker owns real dogma modules and threats, not chat alerts.
- Economy worker owns real itemStore/contract/market conservation, not virtual gift credits.
- World-events worker owns incident state, lifecycle and durable consequences, not the combat damage pipeline.
- QA owns repeatable two native-client acceptance and crash/reconnect.
- Keep this feature behind existing real raid notifications; do not deploy or merge without review. Maintain `evejs-data` untouched.

## Testing evidence

Isolated V8 execution passed with a mock physically verified native scene: 2 named authenticated characters, real ship entities, common native fleet membership yielded interceptor/escort and sent distinct chat messages via the existing broadcaster. The committed regression `tests/coop-p1-duo-raid-tactics.test.mjs` covers inverse geometry, other-fleet, third participant, disconnected, wrong solar system, absent ship, no fake actions, anti-spam, solo fallback. **Node suite and game clients still require execution**.
