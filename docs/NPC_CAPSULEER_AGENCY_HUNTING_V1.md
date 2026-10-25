# COOP-024 — Autonomous NPC capsuleers: opportunity hunting and everyday agency

**Status:** DESIGN / NOT IMPLEMENTED. Date 2026-10-25. Scope: P1 adaptive behavior, P2 faction narratives and group tactics.
**Objective:** Named NPC capsuleers live in the same EveJS universe as the two real players. They seek income, intelligence, safety, social ties and opportunities for piracy. A raid must be a credible consequence of imperfect observation and rational risk, NEVER a random spawn, a fake player, omniscient targeting or scripted loot.
**Source contract:** pinned `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`; overlay doctrine in `docs/DEVELOPMENT_DOCTRINE.md`. No client modifications, CI, default-on hooks, Docker restart or `evejs-data` mutation.

## 1. Verified existing building blocks and gaps

| Existing component | Reuse | Actual limitation |
|---|---|---|
| `coopVirtualWorld.cjs` | Stable `coop-pilot-NNN` identity and coarse offline presence | Route index advances by elapsed time; this is not evidence of a physical stargate jump |
| `coopVirtualEconomy.cjs` | Role & system-level planning pressure | Its `credits` and `goods` are virtual, not spendable native ISK/stock; scripted economy pirate steal is NOT a physical theft |
| `coopNativeRaids.cjs` | Native NPC pirate warp/attack and its lease | Current targets are actual native mining-fleet miner/hauler hulls with ore, not general players; prioritization is simplistic (hauler then distance) |
| `coopNpcTactics.cjs` | Native emergency retreat, rescue, reinforcement | Own in-memory tactical leases; no shared goal arbitration yet |
| `coopCivilianOrders.cjs` / `coopPatrolNavigator.cjs` | Real native warp/orbit routes | Fixed role routes; may compete with a future hunter for the same ship orders |
| `coopNpcMemory.cjs` / `coopNpcRecognition.cjs` | Verified contact history and player recognition | Relations only from verified events; no durable intel observations or autonomous goals |
| `coopNativeGateTransfer.cjs` / `coopNpcGateTravel.cjs` | Native reciprocal gate checks and bounded travel | Live same-ship cross-system travel still gated; never invent an arrival |
| `coopNativeNpcMarket.cjs` / P1 station settlement PRs | Real goods/limited existing seed-market trades when enabled | No unfunded personal NPC orders, imagined owner wallets, or free player deliveries |
| `coopNpcLife.cjs`, identity registry, native restore | Clone/recovery, persisted named hulls | Loss/replacement costs need verified native evidence, no instant respawn |

**Architectural decision:** DO NOT introduce another random raid loop. Create a single per-NPC intent planner and native order arbiter above the existing directors; start with observation-only intent logs, then gradually allow native execution. Preserve current director behavior when the new flag is OFF.

## 2. Character model and daily loop

Each pilot is an enduring individual, NOT a "pirate mob" or human account impersonation.
Example durable profile (fields are proposals, not supported schema):
```js
{
  pilotID: "coop-pilot-011",
  disposition: { greed: 0.7, courage: 0.45, caution: 0.6,
    loyalty: 0.3, curiosity: 0.8, sociability: 0.5 },
  careerSkills: { combat: 0.65, scout: 0.8, industry: 0.1, trade: 0.2 },
  factionID: "independent",
  goals: [{kind:"earn-isk", urgency:0.85},{kind:"replace-ship",urgency:0.3}],
  resources: { nativeWalletRef: null, linkedShipID: null },
  plan: {kind:"survey-route", targetSystemID:null, nextDecisionAt:null},
  social: { allies: [], rivals: [] }
}
```
- Stable identity, personality, known contacts, losses, outstanding debts, owned items, skill limitations, current ship and home/replacement location.
- Personal goals change due to **observed events**: debt, ship loss, market price observed, faction order, cargo opportunity, a remembered attacker, invitation or a successful trade. No global omniscient state.
- Player-like career is **not** a permanent combat role. A trader can scout or hire help; a pirate may repair, salvage, work a courier job or go home when low on resources. Personality biases decisions but never overrides hard physical/legal gates.
- Time budget: a low-frequency strategic decision (suggested 60–180 s) and event-triggered re-evaluation (new sighting, native attack, haul completion, lost target, completed jump). No heavy 30s full-graph scan for each NPC; no LLM in combat tick.
- Needs: ISK solvency, cargo opportunity, survival and recovery, ship modules/capacitor, fuel/ammo when natively represented, faction pressure, social promises. Unknown mechanics must be recorded as UNKNOWN, not guessed to pass a gate.
- Alternates: mine, haul, escort, buy/sell, manufacture where real stock/ISK supported, explore/scout, salvage real wrecks, repair, refit, patrol, take legitimate courier/bounty work, negotiate, rest. Every **economic claim** requires actual itemStore/market/ledger evidence. Virtual job planning can exist without inventing assets.

## 3. Information is earned, incomplete and expires

**Observation ledger** is the NPC's personal knowledge, not a copy of all server sessions.
Each sighting carries `observerPilotID, observedAt, solarSystemID, locationEvidence, shipClass` (only if actually observable), `targetID` (only if identified), `source`, `confidence`, `expiresAt`, `scope`, `witnessEventID`.
Permitted evidence:
- The native scene and active grids actually visible to the NPC's ship, with range/visibility constraints verified on pinned EveJS.
- Native ship/cargo scan **only if an actual native module or sanctioned API action with realistic range and successful result occurred**. No access to another player's private cargo/ISK/fit via server omniscience.
- A legitimate scout/faction report produced by another real NPC witness; transmission has latency, imperfect accuracy and bounded memory.
- Public/legal market and stargate/route intelligence that a normal capsuleer could know; native chat only when observed in the relevant channel.
- Actual previous encounter `coopNpcMemory` is history, not current target coordinates.

No direct reading of hidden player session locations to choose prey, no magic market prices, no exact health or module effects without valid combat/sensor evidence, no future knowledge. Decay stale sightings; remove/unlink records after despawn or destroyed/replaced ship; bound ledger size per pilot and global, redact player identifiers from public telemetry.

**Important:** current headless virtual travel is a planning approximation. It cannot be used to assert cross-system stalking or grant a remote attack. A physical hunter must travel via **verified native reciprocal gates with the same ship ID and its cargo/modules**. If unavailable, mark `TRAVEL_BLOCKED` and select a lawful local alternative.

## 4. Opportunity evaluation (bounded and explainable)

For every candidate action, first enforce hard gates:
1. Attacker = live unique named NPC `pilotID` mapped to the same real native ship; no human account/session impersonation.
2. Target = genuine existing live ship, uniquely identified, in same authoritative scene when action occurs. Refresh identity and witnessed location before issuing commands.
3. Known facts are bounded by valid, sufficiently recent observations; any critical UNKNOWN blocks an offensive command.
4. Check legitimate EveJS aggression/Crimewatch/security restrictions, corporation/fleet relations, target invulnerability/warp/undock protections and targeting API capability. If native legal eligibility cannot be confirmed: **NO PLAYER ATTACK**.
5. The NPC has real capacity to act: compatible fitting/range, sufficient effective survivability, actual ammo/capacitor when native engine models them, nonconflicting active controller state, reachable escape route.
6. Never select targets from owner admin actions, private account data, offline pilots or a despawned client; do not create PvP combat using an LLM text response.

After hard gates, compute a **risk-adjusted utility**, in normalized comparable units:
`U = E(recoverable native loot) * P(intercept) * P(win AND extract) - E(hull/fitting loss) - travel/time opportunity cost - crime/standing penalties - reinforcement threat + bounded personal motivation`.
- `P(win)` is an uncertain **estimate** based only on known opposing ships, witnessed weapon/damage/ewar effects, own verified fit/HP, NPC allies actually available, security/patrol response, range and exit routes. Never read a hidden target DPS/fit as truth.
- Explicit uncertainty: use conservative lower confidence bound, e.g. `pWinLower`; an unseen escort or unknown cargo makes the raid less attractive, not more guaranteed.
- Initial tunable posture thresholds (proposal, to be playtested): opportunist `pWinLower >= 0.75`, cautious merchant-raider `>=0.85`, reckless outlaw `>=0.60`, all AND `expectedUtility > 0`. These are NOT EVE balance claims.
- High bounty/revenge can adjust utility but cannot bypass legal/physical hard gates. Solo vs protected convoy materially shifts the decision.
- Target score includes competing nonviolent plans. If all raid utility <= the best noncombat job, the NPC **does not raid**.
- Cooldowns and hysteresis prevent flip-flopping ("see target -> retreat -> immediately charge"). Reserve a chase budget, abort deadline and one native order owner lease.

## 5. NPC pursuit state machine

```text
IDLE/WORK -> SEEK_INFORMATION -> OBSERVE -> EVALUATE
    |                                      |
    |                                 DECLINE -> WORK / TRADE / SCOUT
    v                                      |
  noncombat activities             OPPORTUNITY_VALID
                                           |
                                   STALK / CALL_ALLIES
                                           |
                                    AMBUSH_POSITION
                                           |
                                      COMMIT_CHECK
                                      /          \
                               INVALID        LEGAL+VIABLE
                                 |                |
                            DISENGAGE          INTERCEPT
                                                  |
                                         ATTACK / RANSOM*
                                                  |
                                          EXTRACT / LOOT
                                                  |
                                      SELL / REPAIR / RECOVER
```
`*RANSOM`: optional only after a genuine escrow/payment mechanic is safe. Messages alone cannot deduct ISK or make the ship invulnerable.

Rules per state:
- `SEEK_INFORMATION`: scout real gate/belt/station, observe legitimate traffic; no secret teleport. Memory keeps last-seen system and credible time window.
- `OBSERVE`: may shadow at ordinary warp distances or wait by real gate, but it must be physically present and discoverable.
- `EVALUATE`: choose hunt, escort, salvage, trade, withdraw or help someone else. Emit reason-coded recommendation, no action.
- `STALK`: only follow fresh witnessed movements, spend travel time, avoid immediate perfect warp to a hidden target; target can evade.
- `AMBUSH_POSITION`: limited dwell; no infinite spawn-camping or magical tackle. Existing ship/module capabilities are the sole mechanics.
- `COMMIT_CHECK`: atomic revalidation right before native `issueAttackOrder` or warp, including authority, legality, fleet relationships, target existence and current orders.
- `INTERCEPT / ATTACK`: native weapon, EWAR, range, HP, target lock and combat evidence only. Outcomes never set by planner. NPC may call a **real present** ally and abort if reinforcement doesn't arrive.
- `EXTRACT / LOOT`: theft requires real wreck/container access and actual inventory debit/credit. Ship can be destroyed while looting; if no native theft API, loot phase stays BLOCKED.
- `DISENGAGE`: retreat only through real warp/docking/gates with scramble and current controller/HP restrictions. Losing prey is valid.
- `RECOVER`: persistent loss/clone recovery, hull replacement funded through a real earned wallet before claiming an owned fitted replacement.
- Every state transition is journaled with `intentID`, `pilotID`, `nativeEntityID`, `targetID`, `from`, `to`, `sourceEvidenceIDs`, `lastOrderID`, time and status; restart recovers only intent. It never replays an ambiguous native attack/transfer/loot/payment.

## 6. Concurrent orders: one arbiter, one actual ship

Introduce `coopNpcOrderArbiter.cjs` with per-physical-entity lease, priority and expiry; integrate existing drivers rather than issuing a new order behind their back.

Suggested priority:
1. Native hard safety: destroyed/missing ship, disconnected controller, invalid physics, actual lock/scramble, explicit native player/legal consequences.
2. Genuine ongoing combat and emergency retreat; no career change mid-fight.
3. Existing player/NPC retaliation and verified fleet defence.
4. Committed lawful hunt operation.
5. Contract delivery / accepted native economic transaction; avoid breaking funds or custody.
6. Existing travel, patrol, civilian work, exploration.
7. Social/idle/presentation.

Existing `coopNativeRaids` owns its current stock-mining raids until migrated, NOT two competing raid directors. The future hunter can consume native raid candidates while preserving old behavior when disabled. Both `coopNpcTactics` and gate/civilian/market modules must check the same arbiter lease (not independent `activeIDs` lists that can race).

## 7. Fleet tactics, counterplay and living aftermath

NPC scouts can share only witnessed reports; hunters can form temporary **genuine compatible native fleets** after authorization, not fabricated fleet membership. Scout, tackle, damage, salvage/hauler and escort can be independently useful.
Counterplay is essential: players can move through another gate, change ships, hire escorts, hide in station, scout first, bait hunters, catch a vulnerable hauler, request NPC assistance or choose negotiation where native mechanics support it.
A hunter may be observed before combat (unusual repeated gate visits, visible scout, known hostile reputation); no unavoidable instant attack and no omniscient global alerts.
**Examples, not scripted outcomes:**
- Two players mine and haul: a scout observes one unescorted trip, shares intelligence, a raider considers the next trip; an additional escort makes it abort and resume salvage.
- A trader sees real demand and moves legitimate inventory; pirates with no credible win chance switch to escort/courier work.
- A miner NPC is attacked by pirates; nearby bounty hunter NPC chooses to help if reward/relationships/strength justify risk; player may join either side.
- A raider fails its first chase: remembers a missed cargo route but loses exact coordinates, spends resources repairing, may revisit after a credible new sighting.

Successful robbery: real stolen cargo changes custody, no duplicate station goods. Killing: actual native HP depletion/wreck/loot. Law and reputation: verified EveJS Crimewatch/standings effects only. Financial settlement: native wallet/market confirmations with durable unique receipts, never virtual credit `+=` as proof.
World chronicle and personal `coopNpcMemory` can note only verified incident states; an approach or attempted lock is not a successful raid.
NPC chat is generated from observed intent and known facts, rate-limited, with event templates first and optional LLM **only for phrasing**. LLM cannot authorize actions or invent world facts. Do not misrepresent an NPC as a real connected human player. Treat offline NPC dialogue as delayed if it cannot be delivered authentically.

## 8. Fairness, legal gameplay and server performance

- **Feature defaults OFF**: `EVEJS_COOP_NPC_CAPSULEER_AGENCY=0`; `EVEJS_COOP_NPC_PLAYER_HUNT=0` (separate).
- Release order: pure scoring -> read-only recorded intent -> native NPC vs NPC -> NPC hunting players only after a **source-verified legal aggression/Crimewatch + client fairness gate**.
- Protected interactions: fresh spawn/first undock gate, session/loading/invulnerability, repeated docking camps and target re-entry; verify native session flags. Never guess protection durations.
- Suggested anti-harassment **design tunables**, not committed balancing: max one active intentional hunter team per real human character per system, max one attempted hunt per 30 minutes per character unless player knowingly re-engages, maximum 2 new commitments per system per 5-minute window, abort chase after 5 minutes without fresh native contact; reset only on meaningful verified outcomes.
- No spontaneous player targeting in high-sec absent verified stock law/rules. In any security band, reject attacks if legality cannot be evaluated. Handle security and standings response with native services; never directly set combat flags.
- Bounded per-tick computational work: max 2 new candidate evaluations per NPC/strategic tick; max 4 active hunts per simulated region, configurable; cache only safe non-authoritative feature snapshots; total behavior planner wall-time budget to be benchmarked, not assumed. State capped, pruned by TTL; deterministic tie breaks.
- No authored price/kill/loot to create dramatic events; permanent victim losses should arise only from true gameplay. Include a conservative, explicit owner configuration to cap adversarial pressure while testing with two players.
- One player's departure or game crash must not leave a ghost target; clear native entity leases and recover durable intent to UNKNOWN requiring revalidation, never resume combat blindly.

## 9. Engineering ownership — agent-ready implementation slices

### COOP-024A — source gate / sensor & legal contracts [P0 dependency]
Owner: native-authority worker. Produce precise source:file:line mapping of NPC visible-scene observation, scan module result, target invulnerability, security/Crimewatch, fleet/standing legal aggression, native wallet/loot/escape. Publish `NPC_CAPSULEER_NATIVE_API_AUDIT.md`; ambiguity => UNSUPPORTED. Do not alter native EveJS or fake scan data.
**DoD:** contract fixtures reject invisibility, hidden cargo, impossible route, invulnerability and outlaw-vs-player illegality. No PvP action exposed without legal source proof.

### COOP-024B — durable beliefs + goal planner [P1]
Owner: autonomy worker. Add pure `coopNpcIntelLedger.cjs`, `coopNpcOpportunityPlanner.cjs`, `coopNpcPersonalGoals.cjs` for stable pilots; deterministic risk/confidence model and alternative jobs, persistent journal with versioned migrations and explicit salvage of bad state. No game mutation.
**DoD:** uncertainty, stale intel, far-away unseen target, wrong-fleet, no opportunity, and ship-loss scenarios all choose a safe action. Same input -> same plan, no omniscient fields.

### COOP-024C — shared native order arbitration [P1]
Owner: integration worker. `coopNpcOrderArbiter.cjs` plus opt-in adapter; preserve existing raid/tactics/gate/civilian/market semantics with feature OFF, ensure one active native order owner per physical NPC.
**DoD:** simultaneous raid + emergency retreat + gate + market + patrol never issue conflicting native orders; no duplicate native entities; exact versioned overlay roundtrip, no extra hook mechanism.

### COOP-024D — pursuit/ambush/abort on real native ships [P1]
Owner: gameplay/AI worker. Implement opt-in `coopNpcHuntDirector.cjs`; first NPC-on-NPC, then law-gated player targeting. Use established `npcRuntime` orders, genuine existing ships, confirmed in-scene target and valid positions, realistic travel, timeouts and native combat evidence.
**DoD:** weak unguarded convoy considered viable, same convoy with two player escorts is usually declined under same observed evidence; stronger resistance forces retreat; no target if unseen/expired or session invalid; physical ship and warp proof.

### COOP-024E — economic career & event aftermath [P1/P2]
Owner: economy/events worker. Connect alternatives to genuine native mining, cargo custody, courier contracts, markets, loot and journals where supported. Never create ISK/ore from the virtual economy when claiming a completed real trade; no stock from hypothetical piracy.
**DoD:** same physical cargo is either delivered, stolen, destroyed or still in transit; final authoritative inventory equations balance, no duplicate earnings after crash, remembered victory/defeat backed by actual event.

### COOP-024F — playtest, telemetry & narrative [P1]
Owner: QA/UX worker. Add read-only explanation report per pilot (goal, evidence age, confidence band, hard gate, selected decision, status), plus discreet player-facing tells/chat grounded in scene.
**DoD:** solo, 2 players, 3+ contacts, disconnected/reconnecting, highsec illegal, unknown target, piracy failure, actual loss and physical gate transition tested on disposable world; two-client visual evidence REQUIRED for gameplay PASS. Measure attack frequency, canceled bad hunts, noncombat hours, cargo/ISK conservation, CPU/time and player escape options.

## 10. Rollout and acceptance ladder

1. `PLANNER_READY`: deterministic tests only; trace decisions, no game mutation.
2. `WORLD_INTENT_OBSERVED`: headless/real-scene read-only evaluator, physical IDs and witness evidence.
3. `NATIVE_NPC_HUNT`: one NPC shadows/ambushes another physical NPC; real warp, attack, retreat and physical aftermath.
4. `TWO_CLIENT_COUNTERPLAY`: two authorized clients can see, avoid, bait, defend, or join with real native combat outcomes. Confirm no attacks outside legal/physical policy.
5. `ECONOMY_CONSERVED`: loss/loot/reprocessing/market/ISK receipts survive restart, no phantom stock. NPC has a credible nonviolent day even when no prey appears.
6. `RELEASE_ELIGIBLE`: local regression baseline and pinned overlay dry-run/roundtrip PASS, documented rollback, p95 tick/gameplay budget, explicit owner-approved deploy.

**Hard NOT DONE:** until steps 4–6 are witnessed, this is design/implementation work rather than evidence that living NPC players are playable. Never add GitHub Actions; never change `evejs-data` as a shortcut; no merges/deploys from this spec.
