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

## Варіант (а): нативна індустрія як покупець руди — що знайдено (00:05Z)

Читав нативний codebase і живий store:

* `server/src/services/industry/*` існує (12 сервісів), у store є таблиці
  `industryJobs`, `industryBlueprintState`, `industryFacilityState`, `industryRuntime`.
* **Усі вони порожні**: jobs 0, blueprintState 0, facilityState 0 (industryRuntime 2 —
  лише метадані). Тобто у світі немає ні фабрики, ні креслення, ні матеріалів.
* `industryChatCommands.js` експортує `executeBlueprintCommand` і
  `executeBlueprintAutoCommand`, і всередині вже є `seedMaterialsForBlueprint` та
  `topUpWalletForBuild` — тобто нативний шлях «зробити реальний білд» у чекауті є, і він
  вміє сам посіяти матеріали й докинути гаманець.
* Але весь co-op стек індустрії **свідомо зафенсований** `supportsLiveRuntime:false`
  (bindings, executor, rust-sell, title-transfer, recovery fence...), а `planner`
  вимагає онлайн-фасиліті + `blueprintState.records`.

Висновок: (а) — це не перемикач, а bootstrap: треба створити NPC-виробника (фасиліті на
станції, креслення з нашою рудою в матеріалах, гаманець+матеріали через нативні
команди), прогнати один реальний джоб із доказами, і лише потім атестувати рантайм.

Наступний крок, який я роблю без ризику: підняти нативний білд через
`executeBlueprintAutoCommand` для NPC-корпи (нативний шлях, не вигадані записи), з
окремим журналом доказів. Якщо для цього потрібна сесія, якої в headless-світі немає —
це і буде першим точним блокером, і тоді рішення: невеликий L2-міст «NPC factory
bootstrap» або L1-пропозиція вгору.

## 2026-10-27 loop — item 3, 4, 10 done; assault blocker narrowed to NPC fitting

**Item 3 PASS** (78fb32ce): rank-driven command cap enforced per campaign side
(recruit 1 / squad-lead 5 / admiral 25), wired to real merit records (none yet,
so every side starts at 1). Tests 10/10.

**Item 4 PASS (code)** (3ff71b13): `warFrontChat` sends
`coopWarClientView.frontReport` to live sessions in the affected systems on war
opened / assault begun / objective captured, once per event key. Tests 3/3. No
live chat line was observed (no transition happened with a client connected).

**Item 10 PASS** (f3997b30): full suite HEAD 5712 tests / 5163 pass / 459 fail /
90 skip vs baseline 49140caa 5680 / 5131 / 459 / 90 — zero new failures, 32 new
passing tests. The single new failure found was an LF-anchored guard broken by a
PowerShell rewrite that had converted two modules to CRLF; restored.

**Assault blocker, narrowed twice (both read-only, exact):**
1. `war_diagnose` -> DEFENDER (ORE 500014) WRONG_FACTION (corp 1000129 has 11
   real profiles, all miners/haulers) and ATTACKER NOT_READY:WAR_NO_NATIVE_LOADED_WEAPON.
2. `inspect_npc 980000000113` -> `"modules":[],"moduleCount":0,"cargo":[],"cargoCount":0`
   even for a durable, armed-profile hull. Cause in the pinned code:
   `nativeNpcService.buildNativeModuleRecords` fits only `definition.loadout.modules`,
   and these profiles resolve to an empty authored loadout. So no NPC in this
   world carries a native fitted weapon/charge and the muster gate can never pass.

**NEXT ACTION (exact):** the assault is blocked BELOW the war layer. Investigate
why `npcData.buildNpcDefinition(<profileID>)` yields no `loadout.modules` for
`parity_angel_autocannon_frigate` / `blood_raider_prophecy` (npcProfiles/npcLoadouts
rows in the static tables vs `npcHardwareCatalog` allowed type IDs), then either
author a real loadout through the catalog or record it as a stock data gap in
`patches/upstream/`. Do not relax `coopWarMusterReadiness`.

**Also still open:** queue items 6 (NPC careers), 7 (courier economy), 8
(industry/salvage loop), 9 (two-client checklist); owner backlog items 1-3
(sovereignty projection, shipcaster logistics, player ranks).

## 2026-10-27 — NPC fitting root cause FOUND (exact), fix needs an override seam

**Root cause (verified, no guessing).** `npcData.buildNpcDefinition(profileID)`
takes the loadout straight from the profile row (`profileRow.loadoutID`), and
every pirate *subcapital* profile points at
`retail_empty_npc_entity_loadout` — a documented stock row with
`modules: [], charges: []` ("Retail NPC Entity Native Dogma": retail NPC stats
live on the type dogma record, not on fitted modules). Measured in the live
container:

```
PROFILE angel_raider                     loadoutID retail_empty_npc_entity_loadout modules 0 charges 0
PROFILE parity_angel_autocannon_frigate   loadoutID retail_empty_npc_entity_loadout modules 0 charges 0
PROFILE blood_raider_prophecy             loadoutID retail_empty_npc_entity_loadout modules 0 charges 0
PROFILE ore_mining_venture                loadoutID ore_mining_venture_dual_miner      modules 1 charges 0
PROFILE concord_police_cruiser            loadoutID concord_medium_beam_laser_cruiser_mwd modules 2 charges 1
```

So `coopWarMusterReadiness` is correct and stock is correct; the two never meet
for pirate subcaps.

**Profiles that DO carry a real, validating weapon+charge (existing data only):**
- `capital_angel_dreadnought` / `capital_serpentis_dreadnought` / ... (each pirate
  faction's capital) — 1 module + 1 charge, `validateNpcHardwareDefinition` -> ok;
- CONCORD (17 profiles, faction 500006);
- Triglavian (28 profiles, faction 500026).

Every pirate *frigate/cruiser/battleship* has zero modules. There is no
subcapital pirate loadout anywhere in the static tables.

**Two honest fixes (both keep coopWarMusterReadiness untouched):**

1. **L1 seam (recommended, real patrols).** Add an explicit loadout override to
   the spawn path (`buildNpcDefinition(profileID, {loadoutID})` or
   `spawnBatchInSystem(..., {loadoutID})`) as a pinned
   `patches/upstream/NNN-npc-loadout-override.patch` + MANIFEST entry, then author
   ONE coop war-patrol loadout (a real turret + a real compatible charge) in the
   coop layer and spawn war patrols with it. Small diff, reversible, keeps retail
   behaviour when the option is absent.
2. **Existing-data-only (no patch, semantically weak).** Use a pirate capital
   (`capital_angel_dreadnought`) as the armed hull, which already has a real
   loadout — but a dreadnought labelled `role:"patrol"` is a misleading label and
   needs a 10-ship world flip to give a fightable border (Jita's neighbours are
   all ORE-owned; ORE has 11 profiles, all miners, and no capital).

Nothing was changed this step: no patch, no flag, no gate relaxation.

**NEXT ACTION (exact):** implement option 1. Start at
`server/src/space/npc/npcData.js:459 buildNpcDefinition(profileID)` and
`nativeNpcService.js:430 buildNativeModuleRecords` (reads
`definition.loadout.modules`); thread an optional `loadoutID` through
`npcSelection.resolveNpcSpawnPlan` -> `spawnBatchInSystem`, add the patch +
`patches/upstream/MANIFEST.json` entry, then `node scripts/apply-upstream-patches.cjs
--checkout <Code> --apply`. Live proof required: `inspect_npc <patrol>` shows
`moduleCount>0` with a weapon+charge, then `war_diagnose` shows
`DRY_RUN_MOBILIZABLE` on both sides, then `living-native-war-assault` fires.

## 2026-10-27 — L1 loadout seam implemented (in progress, live proof pending)

**Done so far.** `patches/upstream/0007-npc-loadout-override.patch` (sha256
`4b9b8215ccf32e88c90ddef38a479f5796d6fbe693bfa7bf0e6d60bda1e2fc82`, MANIFEST
entry, 3 files: npcData/npcSelection/npcService — nativeNpcService is NOT touched
because 0002 owns it). `buildNpcDefinition(profileID, {loadoutID})` ->
`resolveNpcSpawnPlan` -> `resolveBatchSelection` -> `spawnBatchInSystem`; retail
path unchanged when the option is absent, a missing row fails as
NPC_DEFINITION_INCOMPLETE. Apply + reverse both verified.
`integration/coopWarPatrolLoadout.cjs` resolves the profile's own
`<profileID>_loadout` row (real turret + native-compatible charge) and never
overrides an already armed row; `coopAdminBridge.spawnNativeNpc` now refuses an
unarmed `role:"patrol"` spawn (`WAR_PATROL_LOADOUT_UNAVAILABLE:<reason>`), accepts
`loadoutID`/`warPatrol`, and reports the loadout it used.
Tests: `coop-war-patrol-loadout` 7/7, `coop-npc-loadout-override-patch` 5/5.
Deploy: `coop-deploy.cjs` -> `reset=53 patches=series=7 overlay=OVERLAY_OK`.

**Proven live data (read-only probes).** `parity_angel_autocannon_frigate` ->
`parity_angel_autocannon_frigate_loadout` = Domination 125mm Autocannon (13773,
g55) + Domination EMP S (20767, g83), `validateNpcHardwareDefinition` ok, family
angelcartel, `isNpcChargeCompatibleWithModule` true. Every `parity_*` pirate
profile has such a row; `angel_raider`/`blood_raider_prophecy` do not (refused).

**Assault blocker, corrected analysis.** War `war:500011-500014` has defender ORE
(500014) and EVERY ORE profile is a miner/hauler (11 profiles, no weapon), so the
defender side can never muster; registered territories (Jita=500011,
30000144/30000145=500014) are authoritative over live presence, so spawning
Serpentis into a registered ORE system does NOT change the owner (the previous
NEXT list assumed it would). Real fix = a front between two ARMED factions: add
Sobaseki 30001363 (real reciprocal gate 50013876<->50013875, 5 belts) to
`EVEJS_COOP_VIRTUAL_ROUTE` and put one armed Serpentis patrol there; Jita is
already 500011-owned, so a new war 500011-500020 opens on that border and both
sides can muster.

**NEXT (exact).** build + recreate -> `spawn_native_npc` (profileQuery
parity_angel_autocannon_frigate, role patrol, warPatrol true, system 30000142) and
the Serpentis twin in 30001363 -> `inspect_npc` both (moduleCount>0 + charge) ->
`war_diagnose` DRY_RUN_MOBILIZABLE both sides -> `living-native-war-assault`.

## 2026-10-27 — L1 loadout seam + REAL ASSAULT MUSTER (PASS, a7f4c379)

**Proven live (verbatim, container evejs-server-1).**
- `inspect_npc 980000016644` -> `"moduleCount":3` (3x typeID 13773 projectile
  turret, flagID 27/28/29, online) + `"cargoCount":3` (3x typeID 20767 EMP S, one
  per module), `"transient":false`.
- `inspect_npc 980000016639` -> `"moduleCount":5` (5x 13884 hybrid turret) +
  5 charges 20057, `"transient":false`.
- `living-native-war-opened` `OPENED` `warIDs:["war:500011-500020"]`
  `campaignIDs:["war:500011-500020:campaign:30001363"]`, territories now
  `30000142:500011, 30000144:500014, 30000145:500014, 30001363:500020,
  30100032:500020`, `fronts:2`, FUNDED paper treasury.
- `living-native-war-mobilization` `NATIVE_PATROL_MOBILIZED` 980000016644
  ATTACKER (30000142/500011) and 980000016639 DEFENDER (30001363/500020).
- `living-native-war-assault` `ASSAULT_BEGUN`
  `campaignID:"war:500011-500020:campaign:30001363"`
  `attackerShips:[980000016644] defenderShips:[980000016639]`
  `evidence:"REAL_NATIVE_MUSTER_ON_BOTH_SIDES"`.

**Two facts that made this possible (both real, no gate touched).**
1. The muster gate rejects **transient** charges (`c.transient===true`), so a war
   patrol must be spawned `durable:true`; `coopAdminBridge` now does that on
   request and reports `durable`.
2. `campaignReadiness` returned on the FIRST preparing campaign, so the
   un-winnable ORE border (`war:500011-500014:campaign:30000144`, defender ORE
   flies no weapon at all) hid every later border. It now scans all PREPARING
   campaigns and returns the first READY one; the per-campaign gate is unchanged.

**World setup used (owner default: real NPCs/factions only).** Route gained
`30001363` Sobaseki (real reciprocal gate 50013876<->50013875, 5 SDE belts), one
armed Serpentis patrol there (faction 500020) and armed Angel patrols in Jita
(500011) via `spawn_native_npc` + `linkSpawnedIdentity`. No synthetic state, no
fabricated kill, no ammo invented.

**Known noise, deliberately left.** The two transient pirate frigates from the
first attempt (980000016644/16645 were transient then; 980000016644 came back as
a durable restore) plus unarmed transient hulls still linked to some pilots; the
older ORE campaigns stay PREPARING forever by construction (ORE cannot arm).

**NEXT.** (a) battle/objective leg: attack orders -> structure objective binding
-> capture of 30001363; (b) client check of the new campaign on the map/FW tab =
BLOCKED_CLIENT_CHECK without the EVE client; (c) do not re-spawn patrols for the
same campaign (side cap is 1 at recruit rank).

## 2026-10-27 — assault battle leg: real fire + measured HP loss PROVEN (287898d1)

**Proven live (container evejs-server-1, read-only probes).**
- `living-native-war-attack-orders` `NATIVE_ATTACK_ORDER_ACCEPTED` for
  980000016639 -> 980000016987 and back, after the director finally saw its own
  war state.
- `war_combat_diagnose` pair: `sameSystem:true, distanceMeters:4908,
  inRange:true, verdict:AUTHORIZED, warID:war:500011-500020`.
- `living-native-weapon-event` `VERIFIED_NATIVE_WEAPON_EVENT` repeatedly from both
  hulls (module 980100051793 hybrid turret, 13773 projectile turret).
- Ammo bank journal `980000016639.json` phase **COMMITTED** (a real charge debit).
- Victim HP went from `{"shield":225,"armor":200,"structure":215}` to
  `{"shield":200.13459482520693,"armor":200,"structure":215}` — 24.87 HP of
  measured damage from a real Serpentis turret hit.

**Five stacked defects fixed (each proven by a probe before the next):**
1. `gameStore.read(TABLE,"/"+KEY)` cannot see a row written through
   `coopAtomicNativeRows` (the cache nests it at 0x1f). The battle director's
   `snapshots()` was always null -> `WAR_STATE_UNAVAILABLE` -> no order ever.
   `integration/coopNativeRowPath.cjs` is now the one conversion point (195d4ec9).
2. An assault attacker mobilized during PREPARING stayed in the source system and
   held the rank-capped side slot forever (b5a8cd01).
3. `coopNpcFireDebitProof` demanded `flagID` on native charge cargo rows, which
   the native cargo writer never stamps -> `NO_AMMO` on every cycle.
4. The ammo bank journal root did not exist -> `BANK_ATOMIC_JOURNAL_UNSAFE`.
5. The bank transaction declared npcEntities/npcModules (transient rows) and no
   contract covered them; two features now share the npcCargo set, so the caller
   names its contract; a PREPARED journal whose SQLite fence proves no commit is
   recovered as ABORTED by the new `native-ammo-bank-recovery` phase.

**Exact remaining blocker for a KILL (wreck + loot).** One bank cycle spends every
fitted charge (each charge row is quantity 1), so a hull fires exactly ONE volley
and is dry: the cruiser hit for 24.87 HP against a 640 HP frigate. The real lever
is ammo depth: author a war-patrol loadout with `chargeEntry.quantityPerModule`
> 1 (the native spawn honours it, `nativeNpcService.js:563`), spawn the patrol
with that `loadoutID`, then the same fire path kills the victim and
`coopNpcWreckCustody` / `coopNativeLootQuarantine` / `coopWarCasualtyLedger`
follow on the real wreck.

**NEXT ACTION (exact).** Add a coop-authored war-patrol loadout row with
`quantityPerModule` (e.g. 40) reachable through `coopWarPatrolLoadout`, spawn the
Sobaseki attacker with it, verify repeated `living-native-weapon-event` +
falling HP + a real wreck, then continue queue item 2 (casualty ledger -> merit ->
promotion -> treasury).

**Known noise.** The cruiser 980000016639 and frigate 980000016987 each have a
COMMITTED/ABORTED bank journal; hulls left behind in Jita (980000016644/16642)
stay registered to their campaigns. `EVEJS_LOG_LEVEL=2` was used only for the
diagnosis and has been removed from `compose.coop-probe.yaml`.

## 2026-10-27 - war kill loop: real fire -> kill -> wreck -> loot -> casualty -> merit -> promotion (2567db15, 16cda1ed, 00db71a9, 34471320)

**Proven live (container evejs-server-1, read-only admin bridge + coop-events).**
- Loadout: `spawn_native_npc parity_serpentis_blaster_cruiser role patrol durable`
  -> `"loadout":{"status":"RESOLVED","reason":"AUTHORED_MULTI_CHARGE_ROW",
  "loadoutID":"coop_war_patrol_ammo60_parity_serpentis_blaster_cruiser_loadout",
  "chargeTypeID":20057,"chargeDepth":60}` and `inspect_npc 980000017150` ->
  `"moduleCount":5`, cargo 5 x typeID 20057 `"quantity":60` (300 real charges).
- Multi-cycle bank: `living-native-npc-ammo-debit` cargoID 980200006198
  `"before":41,"after":36,"unitsDebited":5` on the same hull (not one volley).
- Measured kill: `war_combat_diagnose` victim HP 225 -> 131.27522104432944 ->
  26.666062461711466 shield, then destroyed.
- Wreck + loot: `living-native-wreck-evidence PHYSICAL_NATIVE_WRECK_VERIFIED`
  wreckID 980300000006 `"storedItemCount":7,"storedQuantity":279,
  "lootStatus":"ITEMS_STORED"`.
- Casualty: `living-native-war-casualty "status":"RECORDED"` wreckID 980300000006
  pilotID coop-pilot-056 (victim), campaign war:500011-500020:campaign:30001363.
- Strict killer: `living-native-destruction-attacker
  NATIVE_DESTRUCTION_ATTACKER_PROVIDED` attackerEntityID 980000017150
  attackerPilotID coop-pilot-050 (upstream options.attackerEntity only).
- Merit + promotion: `living-native-war-merit {"status":"PROMOTED",
  "pilotID":"coop-pilot-050","kind":"warship-kill","merit":25,"from":"recruit",
  "to":"pilot","command":2,"wreckID":980300000006,
  "evidence":"UPSTREAM_ATTACKER_ENTITY_PLUS_PHYSICAL_NATIVE_WRECK"}`, persisted in
  `coop-faction-war<0x1f>merit-v1` and read by the live command-size rule.

**Three structural defects fixed to get there.**
1. Every real loadout row carried one charge, so a hull fired one volley and was
   dry forever: `coopWarPatrolLoadoutRow` authors a real static row plus a real
   ammo depth (2567db15).
2. A dry hull held its side slot forever: `coopWarBattleLineRelief` releases war
   custody on the mobiliser's own `WAR_NO_NATIVE_LOADED_WEAPON` verdict, and the
   mobiliser's ASSIGN event ID now identifies the real attempt so a released hull
   can be mobilized again (16cda1ed).
3. A destroyed hull stayed registered, so the first kill consumed the slot: the
   registry's `confirmDestroyed` witness is wired to real native wrecks and seeded
   from the durable casualty ledger (34471320).

**BLOCKED_TREASURY_UNFUNDED (exact finding, no fabrication).** The last leg
("treasury credit") has no legal ISK source in this world:
`coopWarTreasury` has **NO_TREASURY_ROW** (no HELD escrow), a RESERVE is refused
for a campaign that already exists, and both war corporations have **no
corporationRuntime wallet row at all** (`1000135`/`1000138` MISSING, so
`NATIVE_CORPORATION_WALLET_UNVERIFIED`), while the victim hull typeID 10016 has no
`shipInsurancePrices` row. Any credit would therefore mint ISK, which is
forbidden. A real settlement needs a funded war chest first.

**NEXT ACTION (exact).** Fund a war chest from real income (NPC economy credits or
a player corporation wallet) and enable `EVEJS_COOP_WAR_TREASURY=1`, then reserve
**before** the campaign is created (`coopWarTreasury.execute RESERVE` refuses an
existing campaign) and pay the bounty from that HELD escrow on
`living-native-war-merit` PROMOTED. Do not mint ISK. After that, backlog:
sovereignty projection -> shipcaster logistics -> player rank decal (title only).

**Known noise.** Two dead wrecks (980300000005/6) with stored loot in 30001363,
the released dry hulls 980000016638/16642/16644 and 980000016639/16987 remain as
real idle NPCs, and the ORE campaigns stay PREPARING by construction.

## 2026-10-27 loop - treasury made real (funded + escrowed live), sovereignty + title projected, payout blocked exactly

**Item 1 code PASS + live funding/reserve PASS (43c8d7ea).**
`coopWarChestFunding` moves real earned ISK (the only real ISK an NPC owns, every
cent paid by a real seeded-market fill) from the faction's own pilots into its
native NPC corporation wallet, then `coopWarTreasury` RESERVE debits that wallet
into HELD escrow. The reservation is taken in `coopFactionWarOpening` BEFORE
`START_CAMPAIGN`, so the treasury's "no reservation for an existing campaign"
rule is never bypassed. PAYOUT releases HELD escrow to one named pilot with an
injected authorizer and no wallet mutation (the value left at RESERVE).
`coopWarKillMerit` pays the kill bounty and the faction's own casualty benefit;
`coopWarBounty` resolves the paying faction from the pilot's real native ship and
corporation. RESERVE now accepts either war party (a defender funds its own
defensive bounty) and the wallet checks accept the real keyed stock row shape
(the old `corp.corporationID` check was the actual cause of
`NATIVE_CORPORATION_WALLET_UNVERIFIED`: the stock row has no such field).

Live, verbatim (container evejs-server-1):
- `living-native-war-bounty-reserved` `{"status":"RESERVED","factionID":500014,
  "corporationID":1000129,"amountCents":2500000,
  "chestJournalID":"chest:bounty:war:500011-500014:campaign:30000143:500014",
  "walletAfterCents":2500000,"sources":["coop-pilot-001"],
  "escrowJournalID":8000000000000000}`
- `living-native-war-opened` `OPENED` `campaignIDs:["war:500011-500014:campaign:30000143"]`
  with `funding:[{status:RESERVED,paper:false,escrow:true,...}]`
- chest journal COMMITTED: coop-pilot-001 172 100.00 -> take 25 000.00;
  earned ledger 172 100 -> **147 100**; corp 1000129 journal `7500000000000000`
  +25 000 then `8000000000000000` -25 000; treasury row exists with the
  reservation `bounty:war:500011-500014:campaign:30000143:500014` **HELD**.

**Exact blocker for the live PAYOUT (NEEDS_OWNER:BLOCKED_TREASURY_NO_ARMED_FUNDED_FACTION).**
The only faction with real earned income is ORE 500014 (147 100 ISK left), and ORE
fields 11 profiles, all miners/haulers with no weapon, so it can never produce or
receive a kill in a campaign it funds. Angel 500011 and Serpentis 500020 can fight
(the proven kill loop) and have **zero** earned ISK: `war_funding_diagnose`
reports `NO_REAL_FACTION_INCOME` for both, so their bounty is refused instead of
minted. The payout path itself is unit-proven (6 tests) and wired; it fires on a
real casualty/merit event for the funded faction. To unblock honestly the owner
needs one of: (a) real earned income for an armed faction (a real native sale by
an Angel/Serpentis pilot), or (b) an armed ORE hull profile with a real loadout.

**Item 2 partial (2671b321).** `coopWarSovereigntyProjection` reports real
military control and refuses to call it native sovereignty unless a real TCU/IHub
AND a real native claim exist. Live: `NATIVE_SOV_CLAIM:0`,
`MILITARY_CONTROL_ONLY_NOT_SDE_SOVEREIGNTY:5`, reason
`NO_NATIVE_SOV_STRUCTURE` for every held system (the two faction Astrahus are not
sov structures). `coopWarRankTitle` maps a real merit rank to the pilot's visible
title with an explicit empty unlock list, durable once per promotion.
**Shipcaster front logistics: NEEDS_OWNER, not started** - no real shipcaster
structure exists in this world, so any "front logistics" would be invented.

**Item 3 regression (no code change).** war/treasury/merit/opening/admin suites
332 pass / 11 fail (baseline 303/15), `coop-npc-*` 1090 pass / 98 fail (identical
to the recorded baseline). No new failure.

**NEXT ACTION (exact).** Give an armed faction real income: run one real native
sale for an Angel (500011) or Serpentis (500020) pilot through
`coopNativeNpcMarket` (real seeded bid, real cargo), then re-run
`war_funding_diagnose` until its side reports `FUNDED`, let the next opening
reserve the bounty, and confirm `living-native-war-bounty` `PAID` on the next real
casualty of that faction. Do not fund it any other way.
