# State — co-op loop (mining → haul → station → sale)

Updated: 2026-10-26 ~23:10Z · HEAD `4e32bbca` (pushed)

## Proven live (twice, different runs)

`living-npc-station-sold` `SOLD` with real ISK — **33 150** (21:30) and **36 250** (22:37),
`NPC_LEDGER_ONLY_NOT_EVEJS_PLAYER_WALLET`. Same runs: `living-mining-cycle-settled`
(COMMITTED) → `living-hauler-loaded` (14 466 / 14 277 m³) → fleet `loaded` →
`living-npc-station-route` → sale. Mining and loading continue afterwards
(28 settled cycles + 4 new loads after the last restart).

## Fixed here (all pushed, tested where unit-testable)

1. `HAULER_NOT_NAMED` — the role filter read the world file, which has no roles.
2. Sale left no provable trace → durable per-row fill receipt; the trip journal accepts it.
3. Rows are **partly** sold (5 000 of 54 999) → the receipt records the units the hull
   lost (accumulates), and the journal accepts a remainder = declared − sold.
4. A closed route is skipped BEFORE accounting (that ordering bug made the first expiry
   a no-op).
5. `verify()` required an exact warehouse receipt + hangar item, so a market fill could
   never close a row → a fill is now proven by its own quantity and type; a deposit still
   needs the exact stack.
6. Overdue/superseded trips are closed durably (own fsynced record, ack untouched) and
   re-planned from the hull.
7. Deploy/installer: reset from HEAD (not the shared index), L1-owned file is not drift,
   19 modules a merge had dropped are back in the installer list, and the new
   require-resolution guard found and fixed two live broken requires.

## Remaining blocker (exact)

After a sale, the next trip can still stop with
`ALIFE12_SOURCE_MISSING_WITHOUT_WAREHOUSE_PROOF`: a declared row is gone and the
accumulated fill receipt names the *last* station, while the manifest names the trip's
station — so the row cannot be proven for this manifest. Fix direction: make the fill
receipt carry a per-station breakdown (`fills: [{stationID, quantity, at}]`) and let the
journal prove a row against the fills of the manifest's own station, summing them.

## Operator actions taken (explicit, logged)

Two historic trips whose ore was sold before receipts existed were closed with the
journal's own `expire` via an explicit script
(`node /tmp/expire-trip.cjs <system-fleet-startedAt> HISTORIC_SALE_WITHOUT_RECEIPT --confirm`,
emitting `living-native-trip-expired-by-operator`). No receipt was invented, no cargo was
touched; both manifests remain on disk.

## Environment

`EVEJS_COOP_VIRTUAL_POPULATION=48`, `EVEJS_COOP_FLEET_COMPOSITION=1`,
`EVEJS_COOP_MINING_FILL_CAP=1`, `EVEJS_COOP_CARGO_VOLUME_FALLBACK=1`.
The world carries extra hulls from early failed attempts (13 miners / 10 haulers per
slot) — real, consistent, non-destructive. A clean acceptance prefers a fresh world.

## Commands

```
node scripts/coop-deploy.cjs --checkout C:\Games\EveCoop\upstream-evejs\Code   # reset=49 OVERLAY_OK
cd C:\Games\EveCoop\upstream-evejs\Code
docker build -t evejs-local . && docker compose -f compose.yaml -f compose.coop-probe.yaml up -d
bash scripts/coop-loop-gate.sh --code-path C:\Games\EveCoop\upstream-evejs\Code
```

## 2026-10-27 late: faction war wired to the real world

Commits (local, not pushed): 1cf02347 merit, 26945358 territory-from-presence,
c29cbcd7 campaigns, 58d8afd4 treasury, fd4bac85 bootstrap, 9b0d6f2a opening +
assault + runtime phases, 7f78b9fc war-state SQLite fix, 11a9d2ec self-defence.

Chain: real presence (identity links + corporation->faction) -> territories
(majority, tie = contested) -> fronts (real reciprocal gates) -> war + campaign
per open border (one war per faction pair) -> mobiliser reserves existing native
patrols -> BEGIN_ASSAULT only with a real muster on both sides.

**Root cause found:** the war phases read the record via gameStore.read(table,
"/"+KEY) (JSON cache) while coopFactionWarStore writes through
coopAtomicNativeRows with the raw KEY. A written state was invisible to the next
tick, so the empty state was recreated on every restart. warStateStore() now owns
read/write for opening/assault/mobilization/demobilization/objectives, and
ensureWarState() bootstraps once before any war phase.

**Live state after deploy:** `empty war state created (version 1)` exactly once,
then `opening skipped: NO_FRONT`, `mobilization skipped: NO_MOBILIZED_SHIP:OBSERVED`,
`assault skipped: NO_PREPARING_CAMPAIGN`. The state row now persists in SQLite
(version 1, wars 0, campaigns 0, territories 0).

**Why no front exists yet (real data, read-only probe):** 58 linked pilots ->
30000144=500014 (13), 30000145=500014 (9), 30100032=500020 (4), Jita 30000142 is a
3-3 tie between 500010 and 500011, so it is contested and owns nothing. The two
systems owned by 500014 share one owner and 30100032 is not adjacent, so there is
no border between two different owners. The opener refuses instead of inventing a
front. Next real action: a second faction must really outnumber the current
holder in a system adjacent to another faction's system (one extra patrol/pirate
of 500010 or 500011 in Jita is enough), then the war opens by itself.

Self-defence: coopNpcAggressionLedger (fed only by the killmail-tracker receipt
proven in coopPlayerCombatWitness) lets coopPveRetaliationGuard accept a verified
witness when the native controller has no lastAggressorID. The live compose
profile now sets EVEJS_COOP_PVE_NPC_RETALIATION=1 (it was absent, so
self-defence was gated off).

Tests: 96/96 across war + tactics + retaliation + ledger.

## Per-station fills (done, 22c90295)

Sale receipts now carry `fills:[{stationID,quantity,at}]` (accumulating, atomic
tmp+fsync+rename, identity checked against the prior row). The trip journal and
`verify()` sum ONLY the fills of the manifest's own station made after its departure, so
a row sold in two visits can be proven for each visit separately; receipts written
before the breakdown keep the documented single-station fallback. 28 journal tests pass,
including "a fill at another station never proves this route" and "a fill from before
the departure belongs to another manifest".

## Why the current world cannot finish a second trip

Its history predates receipts: rows were sold in several fills with only the first fill
recorded (the writer used create-only), so those rows are now gone while their receipts
cover only part of them. That is unprovable by construction and must not be papered over.
Live proof of the loop itself already exists (two SOLD events with real ISK).

## Decision needed before the next acceptance run

The probe world is blocked by that historic evidence gap. Two honest options:

1. **Clean world, same machine** (recommended): a second compose project with its own
   volume and remapped ports, run the loop from zero and capture the full cycle. Nothing
   of the current world is touched.
2. **Reset the probe world**: stop the project and drop `evejs-data` so the same project
   starts clean. Destructive; needs an explicit owner decision.

Neither is done automatically: the repo forbids wiping a volume to force a PASS, and a
second project needs ports 26000-26003/40110/443/5222 that the current one holds.

## 2026-10-27 handoff: CCP subsystem inventory (verified by file/handler count)

structure 46 files/77 handlers = real (deploy, control, destruction+loot, moon mining)
campaign 3/20 = real (the FSM that feeds insurgency) | shipcaster 5/6 = real
sovereignty 24/1 = logic only, no client surface | agency 1/2 = thin
incursion 2/0, superweapons 2/0, loyalty 1/0 = STUBS, do not build on them

Next step (not started): structureDeploymentService exposes ONLY client RPCs
(Handle_Anchor/Unanchor/CancelUnanchor/RenameStructure) - there is no server-side
deploy API. Two paths: (a) call the underlying structureState writer directly and
verify the structure appears in worldData.getStructuresForSystem + the scene;
(b) drive the stock Anchor action. Then set EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS
to the real typeIDs and use the structure as the campaign objective (structureID is
already a field in the client campaign snapshot; the projector currently emits 0).

## 2026-10-27 loop — item 1 DONE (structure factory), item 2 in progress

**Item 1 PASS (commit 52b28db1).** `integration/coopStructureFactory.cjs`:
`plan()` -> PLANNED record or REFUSED (UNKNOWN_TYPE_ID, INVALID_POSITION,
INVALID_FACTION for any non-number, OWNER_CORPORATION_REQUIRED,
CORPORATION_FACTION_MISMATCH, UNKNOWN_CORPORATION_FACTION, NAME_REQUIRED,
SYSTEM_ID_REQUIRED); `deploy()` writes through the native writer
`structureState.createStructure` -> `persistStructures` ->
`writeTable("structures")` (which applies `normalizeStructureDescription`,
invalidates the cache and notifies scene listeners) with `{emitLive:true}`;
`verify()` reads back through `listStructuresForSystem`, the same reader behind
`worldData.getStructuresForSystem`. Evidence: `node --test
tests/coop-structure-factory.test.mjs` 12/12, `--apply` INSTALLED
coopStructureFactory.js, `--check` OVERLAY_OK, docker build + recreate OK.

Assumption (owner default): objectives are created in SHIELD_VULNERABLE (110)
with a quantum core so they are real, attackable targets; the co-op faction is
stored in `devFlags.coop` because `normalizeStructureRecord` has no faction
field.

**Admin bridge (uncommitted->next commit):** `coopAdminBridge` gained the
whitelisted action `deploy_structure` (no characterID: a structure belongs to a
corporation) which calls the factory and reads the row back; `deps` are the real
native services. Tests `tests/coop-admin-bridge-structure.test.mjs` 4/4.

**Deliberately dirty (not mine):** `integration/coopNativeHaulManifest.cjs`,
`integration/coopNativeStationTripJournal.cjs` (another session's ore-owner vs
station-corp fill fix), `scripts/coop-supervise.ps1`, `state/digests/*`, `NUL`.
Never commit them.

**NEXT (item 2):** 1) add `EVEJS_COOP_ADMIN_BRIDGE: '1'` and
`EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS` to `compose.coop-probe.yaml`
(re-check the file right before each recreate). 2) `coopWarClientView.cjs:68`
hardcodes `structureID: 0` - replace it with the campaign's real objective
structure id (carried in the war state campaign record; see
`coopFactionWarCampaigns.cjs` `planCampaign` and `coopFactionWarAssault.cjs`).
3) Deploy 1-2 real structures in Perimeter 30000144 / New Caldari via
`deploy_structure`, then prove `warState` campaign carries the id and the
client snapshot emits it.

## Стиснення часу для тестів (реальні native-кнопки, без фейкового стану)

Профіль у `compose.coop-probe.yaml` (перевірено в контейнері через `env`):

| ключ | було | тест |
|---|---|---|
| `EVEJS_MINING_NPC_HAULER_REPEAT_DELAY_MS` | 600000 (10 хв) | **45000** |
| `EVEJS_MINING_NPC_WARP_INGRESS_DURATION_MS` | 2500 | **1500** |
| `EVEJS_MINING_NPC_FLEET_THINK_INTERVAL_MS` | 1000 | **500** |
| `EVEJS_MINING_NPC_HAUL_THRESHOLD_RATIO` | 0.2 | **0.1** |
| `EVEJS_COOP_NPC_MARKET_COOLDOWN_MS` | 60000 | **5000** |

Це саме ті ручки, якими керує продукт; код не змінюється, ніякого «підкрученого
годинника» і ніяких синтетичних подій. Продакшн-світ лишає стокові 30 хв.

## Результат трьох живих продажів

`SOLD` **33 150** + **36 250** + **43 950 = 113 350 ISK** (NPC-леджер).

## Чому зараз не продає

`living-npc-station-sale-skipped` → `NO_SEEDED_COUNTERPARTY`: у нативного сіяного
ринку закінчились ордери на ці типи руди в цих станціях (ми викупили їх кілька разів).
Це реальна межа ринку, не дефект циклу. Щоб продавати далі, треба нове сіяння
маркету (окремий потік) або інші системи/типи.

## 2026-10-27 loop — items 1/2/5 status, real blocker proven

**Item 1 PASS** (52b28db1, live 2276157c): factory + 2 real Astrahus structures
deployed (1030000000000 Perimeter, 1030000000001 New Caldari, faction 500014 /
corp 1000129), verified through worldData.getStructuresForSystem.

**Item 2 code PASS** (71551c99): campaignSnapshots emits the bound
`structure:<id>` objective instead of 0; flag
EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS=35832 is live. The objective can
only bind inside an ASSAULT campaign, which is blocked (below).

**Item 5 partial** (3fc8e73c): the first real front OPENED —
`living-native-war-opened OPENED war:500011-500014` with campaigns for 30000144
and 30000145, after one real Angel Cartel hull linked to coop-pilot-041 broke
Jita's 3-3 tie.

**Exact blocker for BEGIN_ASSAULT** (457b0ef0, read-only war_diagnose):
- war pair is Angel Cartel (500011) vs ORE (500014);
- DEFENDER side (30000144, ORE): every patrol candidate is WRONG_FACTION —
  corp 1000129 has 11 real profiles, all miners/haulers, so ORE can never
  field an armed patrol;
- ATTACKER side (Jita): the only 500011 patrol (980000000113) fails
  `NOT_READY:WAR_NO_NATIVE_LOADED_WEAPON`.
Conclusion: this faction pair cannot muster. A progressing assault needs an
armed faction to own the defending border system.

**NEXT (decided, owner defaults allow it):** make the border fightable without
weakening any gate:
1. spawn ~10 real Serpentis (500020, corp 1000135) armed patrols in New Caldari
   30000145 (currently ORE 9) so an ARMED faction owns it;
2. spawn 2 real armed Angel patrols in Jita with role patrol (linkSpawnedIdentity
   role="patrol") so the attacker side is ready;
3. a campaign whose target is no longer held by its war's defender faction is
   void by construction — add an explicit core transition (EXPIRE_CAMPAIGN with
   a reason) and let the opening phase void such campaigns before planning,
   otherwise TARGET_ALREADY_CONTESTED blocks the new front forever;
4. verify: war opens 500011-500020, mobilization assigns real patrols on BOTH
   sides, then BEGIN_ASSAULT fires and the objective director binds the Astrahus.

Dirty files deliberately left alone: `scripts/coop-supervise.ps1` (supervisor),
`state/digests/*` (generated), `NUL` (stray).

## Buyers for the ore — what actually exists (checked 23:57Z)

`living-economy-destination` on the live world reports **`HOLD_NO_BUYER`** with
`revenue 0, filled 0, unfilled 183 747` for every candidate station, for ore types
17463/17464/17470/1230. The native seed market simply has no buy orders for those ores
in these systems, so the sale path (`coopNativeNpcMarket`, which only fills EXISTING
native orders) correctly reports `NO_SEEDED_COUNTERPARTY`.

Three buyer layers exist in the repo, and only the first one pays today:

1. **Seed-market book** (`coopNativeNpcMarket`) — real native orders, finite; this is
   what produced the three live sales (113 350 ISK).
2. **Demand model** (`coop-economy.json` `systems.demand`, `living-economy-ore`,
   `EVEJS_COOP_ECONOMY_DESTINATION=1`) — computes where ore is wanted; right now it
   honestly says there is no buyer.
3. **Industrial consumers / manufacturers** (`coopAlifeNativeManufacturingRuntime`,
   `coopNpcIndustryNativeBindings`, `coopNpcManufacturingPlanner`, `coopNpcRefinery`) —
   present but **deliberately OFF**: the native bindings declare
   `supportsLiveRuntime:false`, so the runtime refuses with
   `ALIFE_MANUFACTURING_SOURCE_UNVERIFIED` until the native industry path is verified
   live. That is the missing "manufacturer buys ore for its own needs" leg.

Placing NPC buy orders without backing is forbidden by the repo rules, so the only
honest ways forward are: verify+enable the native industry consumer, or seed genuinely
backed ore demand (market daemon), or sell in regions where real orders exist.
