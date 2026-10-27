# Loop metrics â€” append-only. One block per commit. Never edit an old block.

## 2026-10-27T03:32Z - queue item 1: server-side structure factory - 52b28db1
done: integration/coopStructureFactory.cjs added (plan/deploy/verify + explicit refusals); registered in scripts/overlay-spec.cjs names; deploys through native structureState.createStructure -> writeTable("structures").
tests: node --test tests/coop-structure-factory.test.mjs -> 12/0
overlay: OVERLAY_OK
live: not run at commit time (deploy probe ran after 52b28db1 and is recorded in the next block)
metrics: tests_total=12 modules_added=1 modules_changed=1 live_events=0
next: queue item 2 (structures as war objectives)

## 2026-10-27T03:38Z - queue item 1 live acceptance + admin bridge - 2276157c
done: deployed 2 real Astrahus structures through the in-process admin action deploy_structure (faction 500014, corp 1000129, typeID 35832).
tests: node --test tests/coop-admin-bridge-structure.test.mjs -> 4/0 (plus coop-structure-factory 12/0)
overlay: OVERLAY_OK
live: docker exec -w /app/server/src evejs-server-1 node /tmp/p2.cjs -> SYSTEM 30000144 count=1 [{"id":1030000000000,"typeID":35832,"name":"Perimeter Anchor Keep","ownerCorpID":1000129,"state":110,"x":132940071200,"faction":500014}]
live: admin results -> {"id":"structure-1",...,"ok":true,"status":"DEPLOYED","structureID":1030000000000,"verified":"PRESENT"} and {"id":"structure-2",...,"structureID":1030000000001,"systemID":30000145,"verified":"PRESENT"}
metrics: tests_total=16 modules_added=0 modules_changed=1 live_events=2
next: queue item 2 (campaign objective = real structure id, stop emitting structureID 0)

## 2026-10-27T03:44Z - queue item 2 (code part) - 71551c99
done: coopWarClientView.campaignSnapshots derives structureID from campaign.objectiveEvidence ("structure:<id>", latest valid); flag EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS=35832 enabled; two real Astrahus structures already live (1030000000000 in 30000144, 1030000000001 in 30000145).
tests: node --test tests/coop-war-client-view.test.mjs -> 5/0
overlay: OVERLAY_OK
live: not yet - the objective can only bind inside an ASSAULT campaign, and no front exists yet (war state: opening skipped NO_FRONT). Live binding proof moves to the front item.
metrics: tests_total=21 modules_added=0 modules_changed=1 live_events=0
next: create the first real front (Jita is a 3-3 tie between 500010 and 500011) by adding real NPCs of one faction, then prove war opened -> campaign -> objective bound.

## 2026-10-27T03:47Z - queue item 5 (first real front) - 3fc8e73c
done: admin action spawn_native_npc (real SDE profile + native spawnBatchInSystem) and runtime linkSpawnedIdentity (unlinked roster pilot only). One Angel Cartel hull (corp 1000138, faction 500011) linked to coop-pilot-041 in Jita broke the 3-3 tie.
tests: node --test tests/coop-admin-bridge-structure.test.mjs -> 5/0
overlay: OVERLAY_OK
live: coop-events living-native-war-opened -> {"status":"OPENED","warIDs":["war:500011-500014"],"campaignIDs":["war:500011-500014:campaign:30000144","war:500011-500014:campaign:30000145"]}
metrics: tests_total=26 modules_added=0 modules_changed=2 live_events=1
next: mobilization/assault could not start; diagnose the exact blocker

## 2026-10-27T03:55Z - blocker diagnosis (mobilization) - 457b0ef0
done: coopWarMobilizer.tick({dryRun:true}) reports the first failed check per candidate and never writes; runtime diagnoseMobilization(); admin action war_diagnose; linkSpawnedIdentity accepts a role from a fixed set.
tests: node --test tests/coop-war-mobilization.test.mjs -> 8/0 ; node --test tests/coop-admin-bridge-structure.test.mjs -> 5/0
overlay: OVERLAY_OK
live: admin result war_diagnose -> {"status":"DRY_RUN","mobilized":[],"rejected":[{"entityID":980000000113,"pilotID":"coop-pilot-013","side":"ATTACKER","reason":"NOT_READY:WAR_NO_NATIVE_LOADED_WEAPON"},...{"side":"DEFENDER","reason":"WRONG_FACTION"}],"activeCampaignCount":2}
metrics: tests_total=39 modules_added=0 modules_changed=3 live_events=1
next: the defender faction ORE (500014) has no armed profile, so this front can never muster; a fightable front needs an armed faction to own a border system

## 2026-10-27T00:10Z - queue item 3: commander-sized battle groups - 78fb32ce
done: coopFactionWarMerit.commandCapFor + sideCommandCap (recruit 1, squad-lead 5, admiral 25); mobiliser takes commandCap and caps each campaign side at min(maxPerSide, cap); runtime wires it to real merit records (none yet, so a recruit's 1).
tests: node --test tests/coop-war-mobilization.test.mjs -> 10/0 ; merit+assault -> 6/0
overlay: OVERLAY_OK
live: docker build + recreate OK; admin war_diagnose after deploy -> {"status":"DRY_RUN","mobilized":[],"activeCampaignCount":2} (same world blocker, cap not the cause)
metrics: tests_total=55 modules_added=0 modules_changed=3 live_events=0
next: the real muster blocker is the native fitting, not the cap

## 2026-10-27T00:12Z - blocker 2: NPC native fitting - eeacae5f
done: read-only admin action inspect_npc (native record + fitted modules + cargo).
tests: node --test tests/coop-admin-bridge-structure.test.mjs -> 6/0
overlay: OVERLAY_OK
live: admin result inspect_npc 980000000113 -> {"ok":true,"entityID":980000000113,"native":{"systemID":30000142,"corporationID":1000138,"ownerID":1000138,"transient":false},"modules":[],"moduleCount":0,"cargo":[],"cargoCount":0}
metrics: tests_total=61 modules_added=0 modules_changed=1 live_events=1
next: no NPC in this world carries a native fitted weapon or charge, so WAR_NO_NATIVE_LOADED_WEAPON can never pass; next diagnostic is spawn-time hardware fitting (npcHardwareCatalog family + loadout), not a war-layer change

## 2026-10-27T00:20Z - queue item 4: front chat reports - 3ff71b13
done: warFrontChat() in the runtime sends coopWarClientView.frontReport to live sessions in the affected systems on war opened / assault begun / objective captured, once per event key, never repeated.
tests: node --test tests/coop-war-front-report.test.mjs -> 3/0 ; client-view+admin 11/0
overlay: OVERLAY_OK
live: deployed (docker build + recreate). No live transition occurred while a client was connected, so no chat line was observed - not claimed.
metrics: tests_total=64 modules_added=0 modules_changed=1 live_events=0
next: regression sweep of every touched module

## 2026-10-27T00:35Z - queue item 10: regression sweep - f3997b30
done: full local suite twice (baseline worktree 49140caa vs HEAD) and a per-file diff of the failing test names; the only new failure was an LF-anchored source guard broken by a shell rewrite that had converted two modules to CRLF. Restored LF (content byte-identical apart from EOL).
tests: node --test "tests/*.test.mjs" -> baseline 5680/5131 pass/459 fail/90 skip ; HEAD 5712/5163 pass/459 fail/90 skip
overlay: OVERLAY_OK
live: not run (pure test sweep)
metrics: tests_total=5712 pass=5163 fail=459 skipped=90 new_tests=32 new_failures=0 modules_changed=2
next: assault still blocked below the war layer - see the NPC fitting finding

## 2026-10-27T00:45Z - queue item 9: two-client checklist - 21349a8a
done: docs/TWO_CLIENT_CHECKLIST.md - verified server preconditions, the exact fitting limitation that blocks an assault in this build, human step order and per-step evidence, explicit list of what must not be claimed without the client.
tests: not run (documentation only)
overlay: OVERLAY_OK (unchanged)
live: not run (documentation only)
metrics: tests_total=not run modules_added=0 modules_changed=0 live_events=0
next: fix NPC authored loadout so BEGIN_ASSAULT can fire (state.md NEXT ACTION), then owner backlog item 1 (sovereignty projection)

## 2026-10-27T01:05Z - NPC fitting root cause (diagnosis only, no code change) - next commit
done: proved why no patrol can pass the muster gate: every pirate subcapital profile points at retail_empty_npc_entity_loadout (modules 0, charges 0); only capitals, CONCORD and Triglavian profiles carry a real validating weapon+charge. coopWarMusterReadiness untouched.
tests: not run (read-only diagnosis)
overlay: OVERLAY_OK (unchanged)
live: probe in container -> PROFILE angel_raider loadoutID retail_empty_npc_entity_loadout modules 0 charges 0 ; PROFILE concord_police_cruiser modules 2 charges 1 ; DEF capital_angel_dreadnought modules=1 charges=1 valid {"ok":true,"family":"angelcartel"}
metrics: tests_total=not run modules_added=0 modules_changed=0 live_events=0
next: L1 seam - optional loadoutID override in buildNpcDefinition/spawnBatchInSystem as a pinned patch + MANIFEST, then one coop war-patrol loadout (real turret + compatible charge); live proof = inspect_npc moduleCount>0 then war_diagnose DRY_RUN_MOBILIZABLE on both sides then living-native-war-assault

## 2026-10-27T00:41Z — NPC fitting: L1 loadout override + real assault muster — a7f4c379
done: patches/upstream/0007-npc-loadout-override.patch threads an optional options.loadoutID from spawnBatchInSystem -> resolveNpcSpawnPlan -> buildNpcDefinition (retail unchanged when absent, missing row fails loudly, cache keyed by profile+loadout); integration/coopWarPatrolLoadout.cjs picks the profile's own `<profileID>_loadout` row only when it carries a real turret + native-compatible charge; coopAdminBridge arms a role:"patrol" spawn or refuses it and can spawn a durable hull; coopFactionWarAssault.campaignReadiness scans every PREPARING campaign so an un-winnable border cannot hide a winnable one.
tests: node --test tests/coop-war-patrol-loadout.test.mjs tests/coop-npc-loadout-override-patch.test.mjs tests/coop-admin-bridge-war-patrol.test.mjs tests/coop-faction-war-assault.test.mjs tests/coop-admin-bridge-structure.test.mjs tests/coop-war-muster-readiness.test.mjs -> 33/0 ; node --test "tests/coop-faction-war-*.test.mjs" "tests/coop-war-*.test.mjs" -> 259 pass / 11 fail (the same 11 fail at pre-change HEAD 792a9e46: order-arbiter, journal archive, unix socket)
overlay: OVERLAY_OK (coop-deploy reset=53 patches=series=7)
live: docker exec evejs-server-1 -> inspect_npc 980000016644 -> "modules":[3 x typeID 13773 flagID 27/28/29],"moduleCount":3,"cargo":[3 x typeID 20767 one per module],"transient":false ; inspect_npc 980000016639 -> "moduleCount":5 typeID 13884 + 5 charges 20057 ; war_diagnose -> both armed hulls still rejected while transient ("NOT_READY:WAR_NO_NATIVE_LOADED_WEAPON") ; after durable spawns: "living-native-war-opened","status":"OPENED","warIDs":["war:500011-500020"],"campaignIDs":["war:500011-500020:campaign:30001363"] ; "living-native-war-mobilization" 980000016644 ATTACKER (30000142/500011) + 980000016639 DEFENDER (30001363/500020) ; "living-native-war-assault","status":"ASSAULT_BEGUN","campaignID":"war:500011-500020:campaign:30001363","attackerShips":[980000016644],"defenderShips":[980000016639],"evidence":"REAL_NATIVE_MUSTER_ON_BOTH_SIDES"
metrics: tests_total=270 pass=259 fail=11 (all pre-existing) new_tests=17 modules_added=1 modules_changed=2 live_events=4
next: the assault campaign war:500011-500020:campaign:30001363 is live; next real steps are the battle/objective leg (attack orders, structure objective binding, capture) and the client-visible check of the new campaign on the map (BLOCKED_CLIENT_CHECK without the EVE client)

## 2026-10-27T01:20Z - assault battle leg: the director can see its own war state - 195d4ec9
done: integration/coopNativeRowPath.cjs is the single read-only conversion from an atomic-rows key to its JSON cache path; coopWarCombatAuthority.snapshots, coopWarFleetRegistry.claim, coopWarTransferLedger.terminalCandidates and the runtime gate-staging readRow use it. New read-only admin action war_combat_diagnose (runtime diagnoseCombat) reports scene/native/controller/hp/pair verdict.
tests: node --test tests/coop-native-row-path.test.mjs tests/coop-war-combat-diagnose.test.mjs -> 12/0 ; coop-war-* + coop-faction-war-* + coop-admin-bridge-* -> 274 pass / 11 fail (same 11 at pre-change HEAD)
overlay: OVERLAY_OK
live: war_combat_diagnose -> pair 980000016639/980000016644 {"sameSystem":false,"distanceMeters":3134785105830,"verdict":"BLOCKED","reason":"NATIVE_STORE_IDENTITY_MISMATCH"} (was WAR_SNAPSHOT_UNAVAILABLE); gameStore.read("corporationRuntime","/coop-faction-war<0x1f>state-v1") -> ENTRY_NOT_FOUND while tx.get() -> version 1, 2 wars
metrics: tests_total=285 pass=274 fail=11 modules_added=1 modules_changed=5 live_events=1
next: the assault attacker was physically in the campaign source system, so no co-located pair existed

## 2026-10-27T01:24Z - assault battle leg: only a co-located hull fills a battle slot - b5a8cd01
done: coopWarMobilizer counts a campaign side (and the commander's commanded pilots) only among hulls physically in that side system, so an assault attacker left in the source system no longer holds the rank-capped slot.
tests: node --test tests/coop-war-mobilization.test.mjs -> 11/0 (new case: a stranded source-system hull never occupies an assault battle slot)
overlay: OVERLAY_OK
live: one real durable armed Angel patrol spawned in the target system (parity_angel_autocannon_frigate, 3x13773 + 3x20767, faction 500011/corp 1000138, entityID 980000016987, link coop-pilot-061) -> war_combat_diagnose {"sameSystem":true,"distanceMeters":4908,"inRange":true,"verdict":"AUTHORIZED","warID":"war:500011-500020"} ; living-native-war-attack-orders NATIVE_ATTACK_ORDER_ACCEPTED for both hulls
metrics: tests_total=11 pass=11 fail=0 modules_added=0 modules_changed=1 live_events=2
next: orders were accepted but no HP was lost - the ammo path refused every turret cycle

## 2026-10-27T02:05Z - assault battle leg: a real warship fires a real shot - 287898d1
done: five stacked ammo-path defects fixed (flagID demanded on native charge cargo rows; missing journal root; npcEntities/npcModules in the bank transaction vs transient rows; two features sharing one npcCargo contract; PREPARED journals never recovered) plus a bounded native-ammo-bank-recovery phase and named refusal reasons.
tests: node --test tests/coop-npc-*.test.mjs -> 1090 pass / 98 fail, baseline with the same tree stashed 1071 pass / 116 fail, no test that passed at baseline fails now (Compare-Object empty on the => side)
overlay: OVERLAY_OK
live: before -> "npc.weapons.initial-cycle ... errorMsg=NO_AMMO" then NATIVE_AMMO_BANK_SHIP_QUARANTINED, victim HP {"shield":225,...} ; after -> journal 980000016639.json phase COMMITTED, war_combat_diagnose victim 980000016987 hp {"shield":200.13459482520693,"armor":200,"structure":215} = 24.87 measured HP loss from a real turret hit
metrics: tests_total=1200 pass=1090 fail=98 new_tests=18 modules_added=0 modules_changed=6 live_events=3
next: a kill is still out of reach because one bank cycle spends every fitted charge (quantity 1 per module), so each hull fires exactly one volley; authoring a war-patrol loadout with quantityPerModule > 1 is the next real lever for the wreck + loot legs

## 2026-10-27T02:59Z - step 1: authored multi-charge war-patrol loadout - 2567db15
done: integration/coopWarPatrolLoadoutRow.cjs authors a real static npcLoadouts row plus a real ammo depth (modules/charge typeIDs copied unchanged, item registry + weapon family + native charge compatibility required, refusals for every missing fact); coopWarPatrolLoadout reports chargeDepth, prefers the authored row and refuses NO_MULTI_CHARGE_ROW when depth is required; admin bridge requires depth for role patrol and refuses AUTHORED_ROW_FLAG_OFF; one opt-in npcData resolver hook in overlay-spec.
tests: node --test tests/coop-war-patrol-loadout-row.test.mjs tests/coop-war-patrol-loadout.test.mjs -> 20/0 ; coop-war-* + coop-faction-war-* -> 273 pass / 11 fail (same 11 pre-existing)
overlay: OVERLAY_OK
live: spawn_native_npc parity_serpentis_blaster_cruiser role patrol durable -> {"loadout":{"status":"RESOLVED","reason":"AUTHORED_MULTI_CHARGE_ROW","loadoutID":"coop_war_patrol_ammo60_parity_serpentis_blaster_cruiser_loadout","chargeTypeID":20057,"chargeDepth":60}} ; inspect_npc 980000017150 -> "moduleCount":5, cargo 5 x typeID 20057 "quantity":60
metrics: tests_total=20 modules_added=1 modules_changed=3 live_events=2
next: a deep stack alone cannot kill while a dry hull holds the side slot

## 2026-10-27T03:00Z - step 2: dry hull releases its slot, deep stack fires many cycles - 16cda1ed
done: integration/coopWarBattleLineRelief.cjs releases war custody (registry RELEASE + native proof) for a hull the mobiliser's own readiness calls WAR_NO_NATIVE_LOADED_WEAPON, never for any other refusal; mobiliser ASSIGN event ID now identifies the real assignment attempt so a released hull can be mobilized again.
tests: node --test tests/coop-war-battle-line-relief.test.mjs tests/coop-war-mobilization.test.mjs -> 19/0
overlay: OVERLAY_OK
live: living-native-war-battle-line-relief {"status":"RELEASED","reason":"NO_COMPATIBLE_CHARGE_LEFT"} -> fleet re-claimed 980000017150 (deep ammo) ; living-native-war-attack-orders NATIVE_ATTACK_ORDER_ACCEPTED 980000017150 -> 980000017316 and back ; living-native-npc-ammo-debit cargoID 980200006198 "before":41,"after":36,"unitsDebited":5 (more than one bank cycle on the same hull)
metrics: tests_total=19 modules_added=1 modules_changed=2 live_events=3
next: sustained fire must actually kill

## 2026-10-27T03:01Z - step 3: the full kill loop, six legs proven live - 00db71a9
done: kill 1 (wreck 980300000005) proved sustained fire -> HP to zero -> real wreck + stored loot -> casualty ledger -> strict native attacker; kill 2 (wreck 980300000006) added durable merit (coopWarMeritLedger) + promotion, fed into the live command cap.
tests: node --test tests/coop-war-merit-ledger.test.mjs -> 6/0 ; coop-war-* + coop-faction-war-* + coop-admin-bridge-* -> 298 pass / 11 fail (same 11 pre-existing)
overlay: OVERLAY_OK
live: victim HP measured 225 -> 131.27522104432944 -> 26.666062461711466 shield then destroyed (war_combat_diagnose) ; living-native-wreck-evidence PHYSICAL_NATIVE_WRECK_VERIFIED wreckID 980300000006 "storedItemCount":7,"storedQuantity":279,"lootStatus":"ITEMS_STORED" ; living-native-war-casualty "status":"RECORDED" wreckID 980300000006 pilotID coop-pilot-056 ; living-native-destruction-attacker NATIVE_DESTRUCTION_ATTACKER_PROVIDED attackerEntityID 980000017150 attackerPilotID coop-pilot-050 ; living-native-war-merit {"status":"PROMOTED","pilotID":"coop-pilot-050","kind":"warship-kill","merit":25,"from":"recruit","to":"pilot","command":2,"wreckID":980300000006,"evidence":"UPSTREAM_ATTACKER_ENTITY_PLUS_PHYSICAL_NATIVE_WRECK"}
metrics: tests_total=6 modules_added=2 modules_changed=4 live_events=5
next: treasury credit is BLOCKED_TREASURY_UNFUNDED - see state.md

## 2026-10-27T03:02Z - step 3b: a destroyed hull frees its slot - 34471320
done: the registry's confirmDestroyed witness is wired to the native wreck this process really confirmed (and seeded from the durable casualty ledger after a restart), and the relief releases such a slot; a missing scene is still never a destruction witness.
tests: node --test tests/coop-war-battle-line-relief.test.mjs -> 8/0
overlay: OVERLAY_OK
live: after deploy, fleet registry no longer holds the destroyed 980000017316 and a fresh armed frigate 980000017478 took the attacker slot, was killed and paid merit (see step 3)
metrics: tests_total=8 modules_added=0 modules_changed=2 live_events=1
next: BLOCKED_TREASURY_UNFUNDED (no real ISK source exists), then backlog: sovereignty projection

## 2026-10-27T03:33Z - item 1: a war chest funded only by real earned ISK - 43c8d7ea
done: coopWarChestFunding levies the faction's own pilots' real earned balance into its native NPC corp wallet (2-phase journal PREPARED->debit->credit->COMMITTED, recover() finishes forward only); coopWarTreasury gained PAYOUT (HELD escrow -> one named pilot, no wallet mutation); coopFactionWarOpening reserves the bounty BEFORE START_CAMPAIGN; coopWarKillMerit pays kill bounty + own-casualty benefit; coopWarBounty resolves the paying faction from the real native ship+corporation; RESERVE now accepts either war party; wallet checks accept the real keyed stock row; coopNativeNpcMarket owns exactly-once adjustEarned; read-only war_funding_diagnose.
tests: node --test tests/coop-war-chest-funding.test.mjs tests/coop-war-bounty.test.mjs tests/coop-war-treasury.test.mjs -> 31/0 ; coop-war-* + coop-faction-war-* -> 308 pass / 11 fail (same 11 pre-existing)
overlay: OVERLAY_OK (reset modules 361 -> 363)
live: war_funding_diagnose -> 500011 NO_REAL_FACTION_INCOME, 500014 FUNDED corporationID 1000129 takeCents 2500000 from coop-pilot-001 ; "living-native-war-bounty-reserved" {"status":"RESERVED","factionID":500014,"corporationID":1000129,"amountCents":2500000,"chestJournalID":"chest:bounty:war:500011-500014:campaign:30000143:500014","walletAfterCents":2500000,"sources":["coop-pilot-001"],"escrowJournalID":8000000000000000} ; "living-native-war-opened" {"status":"OPENED","campaignIDs":["war:500011-500014:campaign:30000143"],"funding":[{"status":"RESERVED","paper":false,"escrow":true,...}]} ; chest journal COMMITTED sources[coop-pilot-001 beforeCents 17210000 takeCents 2500000] ; earned ledger coop-pilot-001 172100 -> 147100 ; corp 1000129 journal 7500000000000000 +25000 then 8000000000000000 -25000, treasury reservation status HELD
metrics: tests_total=339 pass=328 fail=11 modules_added=3 modules_changed=6 live_events=3
next: the payout leg needs a real casualty/merit event for the funded faction; ORE is the only faction with real income and fields no weapon, Angel/Serpentis can fight and have none - BLOCKED_TREASURY_NO_ARMED_FUNDED_FACTION

## 2026-10-27T03:44Z - item 2: sovereignty projection + rank title (title only) - 2671b321
done: coopWarSovereigntyProjection reports real military control and refuses to present it as native sovereignty unless a real TCU/IHub AND a real native claim exist (nothing written); coopWarRankTitle maps a real merit rank to the pilot's visible title with an explicit empty unlock list, durable once per promotion; both wired live (read-only projection phase, title on PROMOTED).
tests: node --test tests/coop-war-sovereignty-projection.test.mjs tests/coop-war-rank-title.test.mjs -> 14/0
overlay: OVERLAY_OK
live: "living-native-war-sovereignty-projection" {"status":"PROJECTED_VIEW","counts":{"NATIVE_SOV_CLAIM":0,"MILITARY_CONTROL_ONLY_NOT_SDE_SOVEREIGNTY":5}} reason NO_NATIVE_SOV_STRUCTURE for 30000142/43/44/45/30001363 ; phase cycle phaseCount 36 includes native-faction-war-sovereignty-projection
metrics: tests_total=14 pass=14 fail=0 modules_added=2 modules_changed=2 live_events=1
next: shipcaster front logistics (needs a real shipcaster structure + a real fleet transfer leg; not started, no fabricated logistics) ; then regression sweep

## 2026-10-27T03:50Z - item 3: regression sweep of every touched module - no code change
done: re-ran the war, treasury, merit, opening, admin-bridge and NPC-market suites against HEAD after both commits; no new failure introduced (the 11 war/arbiter/socket failures are identical at the pre-change baseline 95f36fc2 measured by git stash).
tests: node --test tests/coop-faction-war-*.test.mjs tests/coop-war-*.test.mjs tests/coop-admin-bridge-*.test.mjs -> 332 pass / 11 fail (baseline 303 pass / 15 fail, +29 passing incl. the 4 new PAYOUT cases) ; node --test tests/coop-npc-*.test.mjs -> 1090 pass / 98 fail (identical to the recorded baseline at 287898d1)
overlay: OVERLAY_OK
live: not run (no runtime change in this item)
metrics: tests_total=1422 pass=1422-109=1313 fail=109 baseline_fail=109 new_fail=0
next: NEEDS_OWNER:BLOCKED_TREASURY_NO_ARMED_FUNDED_FACTION for the live bounty payout; NEEDS_OWNER for shipcaster logistics (no real shipcaster structure exists)

## 2026-10-27T03:52Z - correction to the 03:50Z metrics line
metrics: war/admin suite tests_total=343 pass=332 fail=11 ; npc-market suite tests_total=1188 pass=1090 fail=98 ; combined tests_total=1531 pass=1422 fail=109 ; every one of the 109 failures is present at the pre-change baseline

## 2026-10-27T04:05Z - item 1: the hull that earned the wreck may sell its loot (code) - add54831
done: integration/coopNpcLootSellRoles.cjs gates loot liquidation by role (EVEJS_COOP_NPC_LOOT_SELL_ROLES, default pirate) so a war `patrol` hull can sell what it really recovered; the runtime uses it instead of a hard-coded role==="pirate"; live profile turned on loot commerce/wreck transfer/wreck recovery and added the real loot typeIDs to the seeded-market sell allowlist.
tests: node --test tests/coop-npc-loot-sell-roles.test.mjs -> 6/0 ; node scripts/coop-flags.cjs --check -> FLAGS_OK declared=381
overlay: OVERLAY_OK (364 modules)
live: no loot sale yet - measured blockers, verbatim: seeded buy rows in region 10000016 (the only system with real armed war combat, 30001363) = 0 for 1228/34/211/20767/14272/11351 (probe-region); region 10000002 = 132, region 10001004 = 18 ; Angel 500011 / Serpentis 500020 pilots carry no sellable cargo (probe-cargo: no rows) ; war_funding_diagnose -> 500011 NO_REAL_FACTION_INCOME, 500020 NO_REAL_FACTION_INCOME, 500014 FUNDED
metrics: tests_total=6 pass=6 fail=0 modules_added=1 modules_changed=3 live_events=0
next: an armed faction must really kill inside a seeded-market system (see state.md "why the loot cannot be sold")

## 2026-10-27T04:06Z - P0 fix found while doing item 1: stale durable link halted the whole bridge - ff071de9
done: restoreNamedShips separated a real record conflict from a STALE LINK (record+controller agree, only the link's systemID is old); the stale case is reconciled only under EVEJS_COOP_DURABLE_RELOCATE_RESTORE=1 and only through registry.relocate() after the same native ship is physical in the record's system.
tests: node --test tests/coop-native-durable-restart.test.mjs -> 17/0 ; coop-flags --check -> FLAGS_OK declared=382
overlay: OVERLAY_OK
live: before: living-native-durable-recovery {"status":"NEEDS_OPERATOR_REPAIR","errors":[{"pilotID":"coop-pilot-046","entityID":980000016645,"reason":"NATIVE_RECORD_IDENTITY_CONFLICT"}]} and bridge was never created (every bridge-driven phase inert) ; after: {"status":"OK","recovered":0,"alreadyPhysical":67,"legacyTransient":3,"confirmedLosses":3,"relocated":0,"errors":[]}
metrics: tests_total=17 pass=17 fail=0 modules_added=0 modules_changed=2 live_events=2
next: item 2 (payout) blocked by the same income root cause - see state.md

## 2026-10-27T04:56Z - FW-013: a real pirate can raid again (3 silent blockers) - 9ff67b86
done: coopMaterializeLimit clamps EVEJS_COOP_MATERIALIZE_LIMIT into the bridge contract (1..10) and reports it, so a config value can no longer make createBridge() throw and leave 'bridge' unassigned (which silently killed raids, loot delivery and market assignments); the raid director now reads the identity registry instead of the boot-only materializer map; the civilian route director no longer leases pirate hulls (one owner per record); coopNpcOrderBridge.diagnose() + living-native-raid-diagnose publish the exact first blocker.
tests: node --test tests/coop-materialize-limit.test.mjs tests/coop-npc-order-bridge-diagnose.test.mjs -> 11/0 ; tests/coop-native-raid-eligibility + coop-native-raids-gameplay + coop-virtual-world + coop-npc-materializer + coop-npc-order-arbiter + coop-alife-order-authority + coop-patrol-orders -> 35/0 and 32/0 ; tests/coop-living-session.test.mjs 6 pass/1 fail identical at the pre-change baseline (git stash)
overlay: OVERLAY_OK (reset=53 patches=series=7, new module coopMaterializeLimit in overlay-spec names)
live: living-native-bridge {"status":"READY","configuredLimit":"10","effectiveLimit":10,"clamped":false} ; living-native-raid-diagnose 30000145 pirates 3 fleet 23 ore 5 authorized 21-22 ; living-pirate-raid 30000145 [{"pirateID":980000018058,"targetID":980000016318,"targetRole":"hauler","action":"attack"}] and 30000144 on 980000016310, orderDiagnosis PERMITTED leaseOwner RAID
metrics: tests_total=78 pass=78 fail=0 modules_added=2 modules_changed=3 live_events=3
next: the raid kill -> wreck -> loot -> real seeded sale in region 10000002 (income for an armed faction), then the Maurasi front can reserve its bounty

## 2026-10-27T05:55Z - FW-013: seeded-region front proven; raid targeting made honest - 8fefe8c9
done: raid target selection now sorts by distance (a hauler is preferred only within 50 km of the nearest authorized hull) and never chases a hull in an active warp, which the native resolver rejects; coopAdminBridge gained the read-only npc_pair_diagnose (positions, distance, controller order, hostility verdict, war verdict).
tests: node --test tests/coop-native-raids-gameplay.test.mjs -> 9/0 ; tests/coop-admin-bridge*.test.mjs -> 10/0
overlay: OVERLAY_OK
live: war state 30000140 militaryControllerFactionID 500020 (real border with Jita 30000142/500011 inside region 10000002) ; living-native-war-opening-blocked SUPPLY_UNFUNDED:500011:NO_REAL_FACTION_INCOME|500020:NO_REAL_FACTION_INCOME ; npc_pair_diagnose 980000018994->980000016318 engagementAllowed true manualType attack allowWeapons true distanceMeters 15122.24 ; living-native-weapon-event 30000144 missile-launch 980000000153->980000000444 (real NPC-vs-NPC fire elsewhere) ; 0 wrecks, 0 loot sales in region 10000002
metrics: tests_total=19 pass=19 fail=0 modules_added=0 modules_changed=2 live_events=5
next: NEEDS_OWNER:BLOCKED_ARMED_FACTION_INCOME - the stock mining fleet sits at AU-scale positions and keeps warping, so a raid cannot convert into a kill inside Jita/New Caldari (see state.md)

## 2026-10-27T07:20Z - FW-014 item 1: the mining fleet movement root causes (probe 75f9f54f, trips 88a3ee63, deposit a5f3fd53, belt return b93bae0d)
done: read-only mining_fleet_diagnose (admin bridge action) publishes per-ship mode/pendingWarp/sessionless ingress clock and its own destination distance, distance to the nearest real SDE belt and to the trip station, the arrival surface gap, the dwell clock, the controller manual order, the arbiter lease owner and the fleet's own trip-journal record. Three real defects found and fixed: (1) a PREPARED manifest with no departure ack could neither be resumed nor expired, so the fleet sat in "loaded" 5.4 h; it is now closed as a durable ABANDONED record after a 2 min grace, a route with a real ack is still only expired; (2) the deposit loop threw "baselineKey is not defined" out of EVERY native mining tick (logged every second), so nothing was ever deposited; (3) a miner out of range was only told to FOLLOW its rock at subwarp, so after a retreat it could never return to the belt. New: coopMiningBeltReturn (real native warp to a landing point beside the rock), coopMiningTripRetreatGuard (a hauler flying an acknowledged trip is not dragged home), trip re-warp of a stalled hull, and no warp is attempted for a hull the native runtime refuses as too close.
tests: node --test tests/coop-mining-fleet-diagnose.test.mjs tests/coop-mining-belt-return.test.mjs tests/coop-mining-trip-retreat-guard.test.mjs tests/coop-alife12-station-trip-journal.test.mjs -> 49/0 ; tests/coop-alife12-station-trip-recovery.test.mjs -> 8 pass / 2 fail (both identical at the pre-change baseline, verified with git stash)
overlay: OVERLAY_OK (reset=53 patches=series=7, 3 new modules: coopMiningFleetDiagnose, coopMiningBeltReturn, coopMiningTripRetreatGuard)
live: mining_fleet_diagnose 30000144 -> fleet 960004609 state=loaded originAnchor distanceMeters 448793612100, journal latestManifestKey 30000144-960004609-1793061051055 ageMs 20187185 overdue true departureAck false expired false, miner nearestBelt 448793621638 m ; living-mining-blocker TARGET_OUT_OF_RANGE distanceMeters 448793611732 engagementMeters 11500 ; living-npc-station-route status ROUTE_ABANDONED_STALE_PREPARED then a fresh manifest departureAck true ; living-npc-station-trip-rewarp gapMeters 190173736005 accepted true ; living-mining-retreat-skip reason ACTIVE_STATION_TRIP_OWNS_THIS_HULL ; WARN Mining tick failed: baselineKey is not defined -> gone after a5f3fd53, the tick now publishes WAREHOUSE_ARRIVAL_NOT_VERIFIED
metrics: tests_total=59 pass=57 fail=2 new_fail=0 modules_added=3 modules_changed=6 live_events=6
next: item 1 is NOT closed - the fleet has not re-entered "mining" yet: the delivery leg now reaches its own arrival gate and answers WAREHOUSE_ARRIVAL_NOT_VERIFIED for the last haulers, so the belt-return warp has fired 0 times. Next exact step: explain WAREHOUSE_ARRIVAL_NOT_VERIFIED on the 30000144 trip (verifyArrival: point/stableAt/dwelled) with the same read-only diagnose, then confirm living-mining-belt-warp and a real mining cycle at the belt before item 2 (pirate kill).
## 2026-10-27T07:45Z - item 1 (part a): the deposit gate explains itself; ore owner vs station corp; trip owns its hulls - 3d3eedf1
done: explainArrival names the exact arrival term (gap/mode/dwell) and the warehouse refusal carries it as detail; the dwell is measured on ONE clock (the native tick clock now passed as nowMs) because the tick ran ~2 s ahead of Date.now() and a hauler sitting on the station reported DWELL_PENDING forever; a warehouse receipt names the ORE OWNER while the manifest names the STATION corporation (both files compared them, so every real deposit failed as MANIFEST_WAREHOUSE_RECEIPT_CONFLICT) - owner now comes from the manifest row or the physical stack; transferCargo never loads ore into a hauler an active manifest already declared.
tests: node --test tests/coop-arrival-gate-explain.test.mjs -> 5/0 ; tests/coop-haul-owner-vs-station.test.mjs -> 6/0 ; tests/coop-haul-cargo-trip-owns-hull.test.mjs -> 3/0 ; tests/coop-alife12-station-trip-journal.test.mjs -> 34/0 ; manifest/arrival/admin-bridge/transfer suites -> 194 pass / 23 fail vs baseline 178/23 (git stash), new_fail=0
overlay: OVERLAY_OK (reset=53 patches=series=7)
live: "living-npc-warehouse-blocked" fleetID 960004609 cargoID 980200001433 reason ARRIVAL_NOT_VERIFIED detail {"ok":false,"term":"DWELL_PENDING","gapMeters":0,"maxSurfaceGapMeters":2500,"mode":"GOTO","warping":false,"arrivedAtMs":1793086116032,"activeArrivedAt":1793086116032,"dwellMs":2000,"dwelled":false} at 2026-10-27T07:28:33.991Z (event epoch 1793086113991 = the tick clock was 2 041 ms ahead of the wall clock)
metrics: tests_total=242 pass=219 fail=23 new_fail=0 modules_added=0 modules_changed=6 live_events=2
next: item 1 (part b) - sample the fleet WHILE it is in "mining" and require activeModuleEffects > 0 plus a settled cycle (living-mining-cycle-settled with nextCargo rising) for at least one miner; the new trip-owns-hull guard is what lets the pending manifest close so the fleet returns to mining.

## 2026-10-27T07:56Z - item 1: the superseded-manifest deadlock (root cause) - a57aa3ea
done: recover() in the arrival wrapper replaced the journal's ROUTE_SUPERSEDED with the prefixed reason string, so start() never matched it and answered the same pause on every tick (fleet 960004609 sat in "loaded" 20 min with 3 cargo rows and its haulers on the station); the wrapper now carries journalStatus/journalReason/trip and start() closes a superseded or expired route with the journal's own expire() before planning a fresh manifest. New read-only admin action trip_diagnose asks the LIVE director what the trip machinery answers right now (recover() never warps, writes or creates a route).
tests: node --test tests/coop-alife12-station-trip-recovery.test.mjs -> 7 pass / 2 fail (baseline 6/2, +1 new case) ; tests/coop-alife12-station-trip-journal.test.mjs -> 34/0 ; tests/coop-native-station-arrival.test.mjs + tests/coop-arrival-gate-explain.test.mjs -> 5/0 plus the same 4 recorded fixture failures
overlay: OVERLAY_OK (reset=53 patches=series=7)
live: trip_diagnose 30000144/960004609 -> {"hasActiveTrip":true,"recover":{"status":"ROUTE_ALREADY_ACTIVE"},"manifest":{"status":"READY","record":{"key":"30000144-960004609-1793087656994","stationID":60000358,"corporationID":1000004,"cargo":[{"cargoID":980200010206,"haulerID":980000016257,"typeID":17464,"quantity":1926,"fromMinerID":980000016144,"ownerID":1000129}]}}} (a fresh manifest from what the hulls really carry, instead of the deadlock)
metrics: tests_total=50 pass=46 fail=4 new_fail=0 modules_added=0 modules_changed=2 live_events=1
next: item 1 part b - the fleet now has a real trip with a declared manifest; wait for DELIVERED (living-native-haul-delivered) so state returns to "mining", then sample mining_fleet_diagnose WHILE state=mining and require activeModuleEffects>0 plus a settled cycle with nextCargo rising.

## 2026-10-27T08:12Z - item 1 CLOSED: a real mining fleet at the belt with live module effects and settled cycles - (commit with this block)
done: after the three delivery fixes the 30000144 fleet returns to "mining" and stays there; the fleet diagnose also reports the stock aggro state (resumeInMs, resumeOverdue, lastAggressedAtMs, responseWing) because an aggressed fleet with resumeAtMs 0 could never resume (the stock auto-resume delay defaulted to 0); the live profile now sets EVEJS_MINING_NPC_FLEET_AUTO_RESUME_DELAY_MS=120000 (a real stock knob, no code change).
tests: node --test tests/coop-mining-fleet-diagnose.test.mjs -> 6/0 ; the whole delivery set -> 194 pass / 23 fail vs baseline 178/23 (new_fail=0)
overlay: OVERLAY_OK (reset=53 patches=series=7)
live: mining_fleet_diagnose 30000144 -> {"fleet":960004609,"state":"mining","act":13,"belt":13,"active":["980000016027:2","980000016144:2","980000016145:2"]} (13 of 13 miners carry 2 live module effects each, all 13 within 200 km of a real belt) ; "living-mining-cycle-settled" shipID 980000016470 moduleID 980100051175 oreTypeID 17470 quantity 1874 beforeRock 228126 afterRock 226252 cargoID 980200010837 nextCargo 3748 replayed false ; "living-native-haul-delivered" fleetID 960004609 status DELIVERED at 07:54:57Z and 07:56:58Z ; the deposit refusal is explained: detail term DWELL_PENDING gapMeters 0 with arrivedAtMs 2041 ms ahead of the event clock
metrics: tests_total=200 pass=177 fail=23 new_fail=0 modules_added=0 modules_changed=7 live_events=6
next: item 2 - let the real Serpentis cruiser 980000018058 (300 real charges, live attack order on miner 980000015943) kill a real miner in New Caldari 30000145: real fire, real wreck, real stored loot, casualty ledger, merit. The 30000145 fleet must first leave "aggressed" (auto-resume 120 s after the last aggression, and only when its response wing is gone).

## 2026-10-27T08:16Z - item 2 measured blocker (no fabrication, no mint) - (docs commit with this block)
done: item 2 (a real pirate kills a real miner) is blocked by raid geometry, measured exactly, not by a missing code path; the two-client checklist was refreshed with the new server-side facts (working mining fleet, delivery leg, stock auto-resume, funding state).
tests: not run (docs + probe only)
overlay: OVERLAY_OK (unchanged)
live: npc_pair_diagnose 980000018058 -> 980000016311 {"distanceMeters":373994639646.8543,"attacker":{"mode":"GOTO"},"target":{"mode":"ORBIT"},"engagementAllowed":true,"controller":{"manualType":"attack","allowWeapons":true}} ; mining_fleet_diagnose 30000145 {"state":"aggressed","resumeInMs":92113,"responseWing":0,"lastAggressedAtMs":1793088751229,"miners":13,"atBelt":0} ; war_funding_diagnose 500011 REFUSED NO_REAL_FACTION_INCOME, 500020 REFUSED NO_REAL_FACTION_INCOME, 500014 FUNDED ; living-native-war-opening-blocked SUPPLY_UNFUNDED:500011:NO_REAL_FACTION_INCOME|500020:NO_REAL_FACTION_INCOME fronts 0
metrics: tests_total=0 pass=0 fail=0 modules_added=0 modules_changed=0 live_events=4
next: item 2 exact next step - make coopNativeRaids refuse or release an approach the native controller cannot execute (target at 2.5 AU, the issued "warp" lands in GOTO) and publish the reason; the fleet then leaves "aggressed", coopMiningBeltReturn flies the 13 miners back to the belt, and the next raid at the belt converts into real fire -> wreck -> stored loot -> New Caldari seeded sale -> Serpentis income -> war chest -> war:500011-500020 opens with SUPPLY_UNFUNDED resolved -> escrow PAYOUT to the named pilot. Shipcaster logistics stays NEEDS_OWNER (no shipcaster beacon type exists for 500011/500014/500020).

## 2026-10-27T08:35Z - item 2 step 1: the raid releases its own order (7e07e000)
done: the order bridge answered PERMITTED for 980000018058 (leaseOwner RAID), so the stale order was NOT a bridge gate - it was the native controller's own subwarp pursuit (mode GOTO) winning over the issued warp. One owner per record now holds in the raid: release before a new approach (RAID_ORDER_RELEASED_FOR_APPROACH), release an approach that never became a real warp after 20 s (RAID_APPROACH_UNFLYABLE), release an attack that never acquired a native lock after 90 s (RAID_ATTACK_NO_LOCK). A rival order is never released. npc_pair_diagnose now reports the order-bridge verdict and both hulls' native health layers.
tests: node --test tests/coop-native-raids-gameplay.test.mjs -> 14/0 ; tests/coop-admin-bridge*.test.mjs -> 10/0
overlay: OVERLAY_OK (368 modules)
live: living-native-raid-order-released RAID_APPROACH_UNFLYABLE pirateID 980000018058 released true distanceMeters 373994655618 reason APPROACH_NOT_WARPING ; RAID_APPROACH_UNFLYABLE pirateID 980000018994 released false errorMsg COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE (a CIVILIAN lease owns that hull, refusal published verbatim)
metrics: tests_total=24 pass=24 fail=0 modules_added=0 modules_changed=3 live_events=2
next: an attack lease still lasted 8 minutes on prey that had warped 2.5 AU away

## 2026-10-27T09:05Z - item 2 step 2: an unreachable attack becomes a real warp approach (64d166c5)
done: an attack lease is re-checked every 60 s; when our own locked prey is beyond the same 250 km boundary the approach uses, the order is released and the approach is re-issued as a real warp in the same tick; a refused release publishes RAID_ATTACK_UNREACHABLE and re-tasks nothing. No distance constant changed, the bridge is not bypassed.
tests: node --test tests/coop-native-raids-gameplay.test.mjs -> 17/0 ; raids+admin-bridge+materializer+belt-return -> 45/0
overlay: OVERLAY_OK
live: RAID_ORDER_RELEASED_FOR_APPROACH 980000000602 distanceMeters 373994659694 then living-pirate-raid attack 10162 m (980000000601) and 8882 m (980000018058) - the pirates reach the prey instead of flying home ; npc_pair_diagnose 980000016472 health 146.45 -> 225.00 shield over 5 min (real missile hits, then full regeneration) ; 0 wrecks in 30000145
metrics: tests_total=45 pass=45 fail=0 modules_added=0 modules_changed=2 live_events=4
next: NEEDS_OWNER:BLOCKED_RETREAT_INVALIDATES_EVERY_ORDER - the stock retreat teleports the whole fleet 2.5 AU on the first aggression, the native loop then clears the attacker's manualOrder (currentTargetID 0 within seconds), and shield regeneration outpaces the delivered DPS; a kill needs real warp disruption on the raider or a retreat that a close-range live attack order can prevent (see state.md)

## 2026-10-27T09:50Z - item 1: a real warp point on the raider, and a scramble that reads back (3c46dbb3)
done: L1 0008 fixes the stock scramble verdict (the passive hull baseline -2 was returned instead of the live effect sum, so a fitted Warp Disruptor on a Venture still read as unscrambled); L2 coopNpcWarpPoint verifies a real group-52 module through the registry/dogma/native auto-fit, fits it as a real native module record and activates it with the same activateGenericModule call the stock hostile loop makes; the raid no longer releases an attack order on a prey that really reads back as scrambled, and every attack action carries the point outcome (refusal included, with hostileModules/lockCount/preyScrambleStatus).
tests: node --test tests/coop-npc-warp-point.test.mjs -> 10/0 ; warp-point+raids+loadout-override+admin-bridge-war-patrol -> 41/0
overlay: OVERLAY_OK (reset=53 patches=series=8)
live: inspect_npc 980000000602 -> {"modules":[{"moduleID":980100060463,"categoryID":7,"typeID":3244,"flagID":19,"online":true}]} (a real Warp Disruptor II in a real mid slot); living-native-warp-point-refused 980000018058 -> 980000016472 at 9357 m reason TARGET_NOT_LOCKED hostileModules 2 preyScrambleStatus -2 (the native runtime's own verdict, published verbatim); the same pair really fires: living-native-weapon-event missile-launch 09:37:07Z
metrics: tests_total=41 pass=41 fail=0 modules_added=1 modules_changed=2 live_events=9
next: item 2 - wait for the first ENGAGED (prey really scrambled at 1-3 km), then sustained fire to a real wreck, stored loot, casualty ledger and merit.

## 2026-10-27T10:12Z - item 1 CLOSED (real point engages, prey really scrambled) - 2fba2807
done: L1 0008 (live scramble verdict) + L1 0006 extension (an NPC hull is now really checked before it warps) + OPS fix (the L1 series silently did not apply to Code/ before) + L2 coopNpcWarpPoint (real group-52 module, real native module record, real activateGenericModule) + raid keeps a pinned order + the retreat publishes its own scramble verdict.
tests: node --test tests/coop-mining-retreat-held.test.mjs tests/coop-npc-warp-point.test.mjs tests/coop-native-raids-gameplay.test.mjs -> 34/0
overlay: OVERLAY_OK (reset=53 patches=series=8)
live: living-native-warp-point-engaged status ENGAGED alreadyScrambled true for 980000018058, 980000000601 and 980000000602 on the same miner 980000016052 at 10:01:16Z (the first time a real warp disruptor made a real hull read as scrambled); inspect_npc 980000000602 -> moduleID 980100060463 typeID 3244 flagID 19 online true; before the fix the same hull read preyScrambleStatus -2 while the point was active.
metrics: tests_total=34 pass=34 fail=0 modules_added=1 modules_changed=3 live_events=6
next: item 2 - keep the attacker FIRING on a held prey. Evidence at 10:06: 980000000601 sits 1393 m from 980000016052 with a full shield (6890/6890) and no launch since 09:53:20Z, while 980000018058 (5 blasters, 300 real charges) holds an attack order 2.5 AU away. The prey is held, the DPS is the missing piece.

## 2026-10-27T10:51Z - item 2 step 3 (WIP committed): the raider flies to its own gun range - 1d6a3833 + 91f68dde
done: coopNpcGunRange reads the range from the stock combat resolver's own snapshot (npcEquipment getNpcWeaponModules + buildNpcWeaponModuleSnapshot: maxRange for a turret, the missile's own approxRange for a launcher) and the raid issues the attack with that number as the hull's engagement distance through the stock behaviour override npcService.setBehaviorOverrides({orbitDistanceMeters}) - the same call miningNpcOperations uses. A standalone manual orbit is NOT used: it is not an attack intent, so the native hostility invariant treated the prey as friendly (measured live earlier: mode STOP, currentTargetID 0). npc_pair_diagnose now reports the attacker's own gun range plus returningHome/leashRangeMeters/homeDistanceMeters. Separate commit: the refinery journal file name is escaped on win32 (NTFS rejects ':' in coop-refine:v1:<itemID>:<quantity>), key unchanged.
tests: node --test tests/coop-npc-gun-range.test.mjs tests/coop-native-raids-gameplay.test.mjs -> 30 pass / 0 fail (6 gun range, 24 raids incl. 2 new)
overlay: OVERLAY_OK (reset=53 patches=series=8, moduleCurrent 372, stale 0, missing 0) ; docker build evejs-local + compose recreate server OK
live: earlier deployed variant, verbatim: living-pirate-raid 30000145 action orbit-to-range pirateID 980000018058 gunRange {"status":"RESOLVED","meters":1050,"source":"maxRange","family":"hybridTurret","typeID":13884,"falloffMeters":3000,"weaponCount":5} at distanceMeters 2251.76 ; sustained fire on a held prey: NOT PROVEN yet
metrics: tests_total=30 pass=30 fail=0 modules_added=1 modules_changed=4 live_events=0
next: sample npc_pair_diagnose 980000018058 -> its held prey after this deploy and require real living-native-weapon-event lines plus falling shield/armor; if the hull still parks outside its own gun range, read the new returningHome/leash/homeDistance fields instead of guessing.

## 2026-10-27T11:47Z - item 2 step 4: the measurement says why the DPS never happens (d0f5d8de, e20f6801, 1e431ed0, c6965dbd)
done: raid_diagnose (read-only) exposes every linked pirate of a system, why it is excluded (loot delivery / ammo supply), its native controller state (mode, currentTargetID, manual order, returningHome, leash, home distance, orbit override), the range its own fitted weapon really has and its nearest real prey. A refused native warp is now published (warp-to-hauler-refused + errorMsg) instead of leaving a silent lease. While the raid holds a lease it widens the hull's own stock leash to exactly the approach it ordered and restores the profile value on release.
tests: node --test tests/coop-native-raids-gameplay.test.mjs tests/coop-npc-gun-range.test.mjs tests/coop-admin-bridge-raid-diagnose.test.mjs -> 35 pass / 0 fail (25 raids, 6 gun range, 4 diagnose)
overlay: OVERLAY_OK (reset=53 patches=series=8) ; docker build evejs-local + recreate OK
live: raid_diagnose 30000145 -> {"status":"OK","linkedShips":21,"roleCounts":{"pirate":4,...},"fleetShips":23,"excluded":{"lootDelivery":[],"ammoSupply":[]},"leases":[],"pirateDetail":[{"entityID":980000018058,"mode":"STOP","homeDistanceMeters":0,"gunRangeMeters":1050,"gunRangeStatus":"RESOLVED","nearest":[{"id":980000016318,"role":"hauler","distanceMeters":4446.1}]},...]} ; npc_pair_diagnose 980000018058 -> 980000016318 {"distanceMeters":373994637299.5,"controller":{"returningHome":true,"leashRangeMeters":90000,"manualType":"","currentTargetID":0}} ; last living-native-weapon-event 10:20:06Z (601, missile, chargeTypeID 213); zero events for the 300-charge cruiser
metrics: tests_total=35 pass=35 fail=0 modules_added=0 modules_changed=4 live_events=0
next: with the leash scoped to the ordered approach, sample raid_diagnose + npc_pair_diagnose until 980000018058 really holds an attack order inside its own 1050 m gun range on a pinned prey, then require living-native-weapon-event from it and falling shield/armor.

## 2026-10-27T11:54Z - item 2: the FIRST real raid kill in the seeded region (real wreck + stored loot) - 25e879fe, f5d8454a
done: an attack order on prey beyond the 250 km approach boundary now releases and re-approaches on the re-check itself (a 60 s attack lease could never reach the 90 s no-lock window, so a hull orbited at 2.5 AU holding an order it could never fly); the orphan relocateRaidHomeAnchors call site a concurrent commit had captured without its definition is gone, so the native-raids phase stops failing and the leash (c6965dbd) is the single movement mechanism.
tests: node --test tests/coop-native-raids-gameplay.test.mjs tests/coop-npc-gun-range.test.mjs -> 26 pass / 0 fail (plus 6 gun range, 35 with the diagnose suite)
overlay: OVERLAY_OK (moduleCurrent 372, stale 0, missing 0) ; docker build evejs-local + compose recreate server OK
live: "living-native-stock-fleet-wreck-evidence" status PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED victimEntityID 980000016472 victimRole miner wreckID 980300000008 storedItemCount 3 storedQuantity 93450 lootStatus ITEMS_STORED at 11:52:33Z ; "living-native-warp-point-engaged" ENGAGED alreadyScrambled true pirateID 980000000601 and 980000000602 -> 980000016472 at 11:52:12Z ; "living-native-weapon-event" missile-launch 980000000601 -> 980000016472 at 11:52:33Z ; "living-native-raid-leash" APPLIED entityID 980000018058 leashRangeMeters 373994723022 profileLeashRangeMeters 90000 orderDistanceMeters 373994623021 reason RAID_LEASE_OWNS_MOVEMENT
metrics: tests_total=26 pass=26 fail=0 modules_added=0 modules_changed=2 live_events=5
next: item 3 - recover wreck 980300000008 (3 stacks / 93 450 units in 30000145) through the proven loot path and sell it to the real seeded buyer at New Caldari 60000688 (482 @ 571 211 ISK), then fund the faction chest from that real fill so SUPPLY_UNFUNDED resolves and the escrow payout can be proven.
## 2026-10-27T11:57Z - item 2 step 6: SUSTAINED FIRE AND MEASURED HP LOSS ON A HELD PREY (ccd6046c)
done: the leash is now measured from the hull's own home (home->hull + hull->prey + 100 km) and restored on release; with it the raider keeps its attack order, locks its prey, orbits at its own gun range and its real turret stays active.
tests: node --test tests/coop-native-raids-gameplay.test.mjs tests/coop-npc-gun-range.test.mjs tests/coop-admin-bridge-raid-diagnose.test.mjs -> 36 pass / 0 fail
overlay: OVERLAY_OK ; docker build evejs-local + recreate OK
live: npc_pair_diagnose 980000018058 -> 980000016299 at 11:55:14.766Z: attacker mode FOLLOW, locks {locked:[980000016299]}, activeModules [9800000180583296, 980100060464, 9800000180582378, 980100056948], distance 3622.26 m, returningHome false, manualType attack, target shield 3118.35 -> at 11:55:44.647Z attacker mode ORBIT, locks {locked:[980000016299]}, activeModules [9800000180583296, 9800000180582378, 980100056948], distance 2030.85 m, target shield 1773.12 (1345.23 HP of measured shield loss in 30 s, real turret typeID 13884 with 20057 charges); living-native-weapon-event from 980000000601 -> 980000016293 at 11:54:01/09/26Z
metrics: tests_total=36 pass=36 fail=0 modules_added=0 modules_changed=1 live_events=3
next: hold this engagement to zero HP and capture the real wreck + stored loot + living-native-war-casualty + merit, then the seeded sale of the loot (482 @ 571211 ISK at New Caldari 60000688).

## 2026-10-27T12:01Z - item 2 step 7: TWO REAL KILLS WITH STORED LOOT (no code change)
done: with the home-measured leash the raiders hold their prey and kill it: two physical native wrecks with stored loot and upstream attacker attribution.
tests: not run (no code change)
overlay: OVERLAY_OK (unchanged)
live: {"at":"2026-10-27T11:52:33.981Z","event":"living-native-stock-fleet-wreck-evidence","status":"PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED","victimEntityID":980000016472,"victimRole":"miner","wreckID":980300000008,"storedItemCount":3,"storedQuantity":93450,"lootStatus":"ITEMS_STORED"} + {"at":"2026-10-27T11:52:33.983Z","event":"living-native-destruction-attacker","status":"NATIVE_DESTRUCTION_ATTACKER_PROVIDED","victimEntityID":980000016472,"wreckID":980300000008,"attackerEntityID":980000000601,"attackerPilotID":"coop-pilot-060"} ; second kill {"at":"2026-10-27T12:00:10.486Z","wreckID":980300000009,"victimEntityID":980000019472,"storedQuantity":3150,"attackerEntityID":980000000602,"attackerPilotID":"coop-pilot-080"} ; measured DPS on 980000016299: shield 3118.35 -> 1773.12 in 30 s with turret 980100056948 active
metrics: tests_total=0 pass=0 fail=0 modules_added=0 modules_changed=0 live_events=4
next: the loot leg - the pirate must recover the wreck cargo (EVEJS_COOP_NPC_WRECK_RECOVERY/LOOT_COMMERCE are on) and sell it into a real seeded bid at New Caldari 60000688; watch living-native-loot-* then living-npc-station-sold with real ISK.

## 2026-10-27T12:14Z - item 2b: the deep-ammo hull fires, the loot leg is blocked by a non-durable wreck entity - 10d3c4ba
done: a pirate holding a live wreck claim is excluded from the raid so the recovery owns the hull; a recovery that orders nothing publishes its exact refusal (living-npc-postraid-wreck-recovery-blocked) instead of returning silently.
tests: node --test tests/coop-native-raids-gameplay.test.mjs tests/coop-admin-bridge-raid-diagnose.test.mjs -> 30 pass / 0 fail
overlay: OVERLAY_OK ; docker build evejs-local + compose recreate server OK
live: "living-native-weapon-event" kind module-activation attackerEntityID 980000018058 (5 real turrets, 300 charges, own gun range 1050 m) victimEntityID 980000016311 moduleID 980100056949 at 12:11:03Z ; "living-npc-postraid-wreck-recovery-blocked" wreckID 980300000009 hunterID 980000000602 blocked false hunterMode GOTO wreckPresent false distanceMeters null pickupDistance 2500 claims 2
metrics: tests_total=30 pass=30 fail=0 modules_added=0 modules_changed=1 live_events=3
next: kill and loot INSIDE one boot - watch for the next living-native-stock-fleet-wreck-evidence in 30000145 with no recreate in between, require living-npc-postraid-wreck-recovery then wreck custody into the pirate hold, then the New Caldari seeded fill (482 @ 571 211 ISK at 60000688), then chest funding -> war_funding_diagnose FUNDED -> living-native-war-bounty PAID.
## 2026-10-27T12:14Z - item 2 step 8: REAL LOOT SALE INTO A SEEDED BID (armed faction now earns)
done: the recovered wreck cargo is carried to a real station by the real hull and sold into a real seeded order; no ISK is minted.
tests: not run (no code change this step)
overlay: OVERLAY_OK (unchanged, deployed image c5b0683)
live: {"at":"2026-10-27T12:07:25.914Z","event":"living-native-loot-market-settled","status":"TRADE_SETTLED","side":"sell","pilotID":"coop-pilot-080","entityID":980000000602,"stationID":60014935,"typeID":17471,"quantity":3150,"price":8.61,"balance":27121.5,"marketOrderID":"4257762183096583231","marketOrderSource":"EVEJS_SEED","cargoID":980200026308,"lootSource":{"sourceWreckItemID":980400000026,"sourceWreckID":980300000009},"nativeCargoVerified":true,"marketRPCAcknowledged":true,"marketRPC":"FillOrder","marketCurrency":"NPC_LEDGER_ONLY_NOT_EVEJS_PLAYER_WALLET","sourceOfFunds":"SEED_MARKET_FILLED_ORDER"} ; before it living-npc-loot-station NATIVE_WARP_TO_STATION 60014935 then PHYSICALLY_AT_NATIVE_STATION ; war_funding_diagnose now lists coop-pilot-080 balance 27121.5
metrics: tests_total=0 pass=0 fail=0 modules_added=0 modules_changed=0 live_events=3
next: the war opening still refuses with SUPPLY_UNFUNDED:500011:NO_REAL_FACTION_INCOME|500014:WAR_TREASURY_JOURNAL_COLLISION and fronts 0 / activeCampaignCount 0 - the funded pilot is Serpentis 500020, so the next step is a real front involving 500020 (Maurasi 30000140 presence) and clearing the stale 500014 escrow journal, not funding 500011.

## 2026-10-27T12:26Z - kill loop repeatable; loot leg needs one uninterrupted boot - d1a30222
done: a wreck claim only owns the pirate while its physical wreck is still in the scene, so a restart-dropped claim no longer stalls the raid; four real wrecks with stored loot were produced by real native fire, and the 5-blaster hull now activates its own modules at its own 1050 m range.
tests: node --test tests/coop-native-raids-gameplay.test.mjs tests/coop-admin-bridge-raid-diagnose.test.mjs -> 30 pass / 0 fail
overlay: OVERLAY_OK ; docker build evejs-local + recreate server OK
live: living-native-stock-fleet-wreck-evidence wreckID 980300000010 victimEntityID 980000016311 storedItemCount 2 storedQuantity 91980 at 12:23:07Z ; living-native-weapon-event module-activation 980000018058 -> 980000016311 moduleID 980100056949 ; living-npc-postraid-wreck-recovery-blocked wreckPresent false claims 3 after the next restart
metrics: tests_total=30 pass=30 fail=0 modules_added=0 modules_changed=1 live_events=3
next: on an uninterrupted boot catch the next wreck evidence and require postraid-wreck-recovery -> wreck custody -> loot station delivery to New Caldari 60000688 -> real seeded fill (482 @ 571 211 ISK) -> chest funding -> war_funding_diagnose FUNDED -> living-native-war-bounty PAID.
## 2026-10-27T12:36Z - item 2 step 9: the war leg's real blocker is one unfunded attacker, measured (12d47fd4, 77693df8, d580a5f1)
done: war_state (read-only) now reports territories/wars/campaigns plus the per-system presence the territories are derived from (linked pilots, resolved factions, and the exact skip reason).
tests: node --test tests/coop-admin-bridge-raid-diagnose.test.mjs -> 4 pass / 0 fail
overlay: OVERLAY_OK (apply INSTALLED, problems []) ; image 3fc0677 built and recreated
live: war_state -> {"status":"OK","counts":{"territories":2,"wars":1,"campaigns":0},"presence":{"systems":[{"systemID":30000140,"linked":1,"resolved":1,"factions":{"500020":1}},{"systemID":30000142,"linked":15,"resolved":15,"factions":{"500010":3,"500011":8,"500012":2,"500020":2}},{"systemID":30000144,"linked":31,"resolved":31,"factions":{"500012":3,"500014":24,"500019":3,"500020":1}},{"systemID":30000145,"linked":21,"resolved":21,"factions":{"500010":1,"500011":2,"500012":2,"500014":11,"500020":5}},...],"skipped":[]} ; opening still refuses SUPPLY_UNFUNDED:500011:NO_REAL_FACTION_INCOME|500014:WAR_TREASURY_JOURNAL_COLLISION
metrics: tests_total=4 pass=4 fail=0 modules_added=0 modules_changed=3 live_events=1
next: the Jita(500011)->Maurasi(500020) front needs the ATTACKER 500011 funded too; 500020 already holds 27121.5 ISK from the real loot fill. 601 (Angel, corp 1000138) has no cargo because its wreck 980300000008 is no longer in the scene (wreckPresent false), so the honest route is a NEW kill in this boot -> wreck -> recovery -> seeded sale by an Angel pilot -> 500011 funded -> war 500011-500020 opens with both sides funded -> escrow PAYOUT on a real casualty.

## 2026-10-27T13:15Z - item 1 (boot-churn robustness): a claim restores its own wreck or closes honestly - c8a69b63
done: a restart drops the physical native wreck entity while the durable native wreck row (and its stored loot) survives, so every claim pointed at a wreck that could never be looted. coopNpcWreckClaimReconcile either re-spawns the SAME native wreck entity from its own durable row through the stock spawnNativeWreck path, or closes the claim durably with the measured reason (WRECK_ROW_ABSENT / WRECK_DECAYED / WRECK_HAS_NO_STORED_ITEMS / WRECK_ROW_MISMATCH / RESTORE_REFUSED_<native>) plus the measured lost stacks; coopNpcWreckClaims.close() adds an idempotent closed section that survives a restart. The runtime gained the native-wreck-claim-reconcile phase (45s boot grace, scene must exist) and a claim-driven 5s fast loop (EVEJS_COOP_NPC_WRECK_RECOVERY_MS) that runs recovery+custody only while a live claim really has its physical wreck.
tests: node --test tests/coop-npc-wreck-claim-reconcile.test.mjs tests/coop-npc-native-wreck-recovery.test.mjs -> 22 pass / 0 fail
overlay: OVERLAY_OK (patched 59, moduleCurrent 374) ; docker build + compose recreate OK
live: {"event":"living-npc-wreck-claim-restored","status":"RESTORED","wreckID":980300000008,"reason":"NATIVE_WRECK_ENTITY_RESTORED_FROM_DURABLE_ROW","loot":{"stacks":3,"quantity":93450,"typeIDs":[1228,17463,17471]},"pilotID":"coop-pilot-060","hunterID":980000000601,"nativeSource":"STOCK_SPAWN_NATIVE_WRECK"} and {"event":"living-npc-wreck-claim-closed","status":"NOTHING_TO_RECOVER","wreckID":980300000009,"reason":"WRECK_HAS_NO_STORED_ITEMS","closeStatus":"CLAIM_CLOSED","iskGranted":false,"cargoMoved":false}
metrics: tests_total=22 pass=22 fail=0 modules_added=1 modules_changed=2 live_events=2
next: the hull must really fly to the restored wreck and move its cargo (capacity + combat order were the next measured blockers).

## 2026-10-27T13:35Z - item 1b: a hold smaller than the wreck stack moves what fits - 3f290ab4
done: the Angel killer 980000000601 (Arch Angel Centurion, capacity 120 m3) held a live claim on a wreck whose stacks are 4 032 + 2 142 + 5 229 m3, so every custody attempt answered NATIVE_CARGO_FULL and the loot could never leave. A stack that does not fit now moves floor(free/volume) units and the remainder stays in the same wreck as a real native wreck item (allocated id recorded in the write-ahead journal and verified on settle); a hold that cannot fit one unit still answers NATIVE_CARGO_FULL. syncDirectory() skips the POSIX directory fsync on Windows, where the OS refuses to open a directory: the writer lock used to fail there and 19 custody tests could never run on this machine. The custody statuses that returned silently now publish living-npc-wreck-custody-skip (mode, distance, quantity, type) once per claim+status per 5 minutes.
tests: node --test tests/coop-npc-wreck-custody.test.mjs tests/coop-npc-loot-commerce.test.mjs tests/coop-npc-wreck-claim-reconcile.test.mjs tests/coop-npc-native-wreck-recovery.test.mjs -> 54 pass / 0 fail
overlay: OVERLAY_OK ; docker build + compose recreate OK
live: inspect_npc 980000000601 -> moduleCount 1 (warp disruptor), cargoCount 0 ; wreck 980300000008 stacks measured type 1228 x26880 (4032 m3), 17463 x14280 (2142 m3), 17471 x52290 (5229 m3) vs hull capacity 120 m3 -> NATIVE_CARGO_FULL was the exact blocker
metrics: tests_total=54 pass=54 fail=0 modules_added=0 modules_changed=2 live_events=0
next: the killer must also stop holding its native attack order while its wreck is 2.5 AU away.

## 2026-10-27T13:55Z - item 1c: the raid releases its own order when a claim owns the hull - 316539b4
done: excluding the killer from new raid candidates was not enough: the director still held its lease and the native attack order, so the recovery director refused with NATIVE_COMBAT_ORDER_ACTIVE. releaseExcluded() releases exactly the leases this director issued (never a rival owner - the order bridge decides) and re-releases a hull the stock loop re-targets, at most every 15 s, publishing living-native-raid-release with the real outcome.
tests: node --test tests/coop-native-raids-gameplay.test.mjs -> 28 pass / 0 fail
overlay: deployed into the running container (the shared checkout was drifted by another session at that moment)
live: {"event":"living-native-raid-release","systemID":30000145,"pirateID":980000000601,"reason":"WRECK_CLAIM_OWNS_HULL","leaseTargetID":980000016293,"released":true,"status":"RAID_ORDER_RELEASED_FOR_LOOT"}
metrics: tests_total=28 pass=28 fail=0 modules_added=0 modules_changed=2 live_events=1
next: recovery must issue the real warp to the restored wreck and custody must settle a partial stack.

## 2026-10-27T14:05Z - OPS: the deploy itself was broken by a committed hook without an installed module - 3f9b6d8c
done: HEAD carried npcBehaviorLoop -> ../coopMilitiaWarPlayer but coopMilitiaWarPlayer was not in the overlay install list, so every deploy refused with HOOK_REQUIRE_NOT_INSTALLED, the checkout could not be patched and the running server lost the co-op startup hook (no living world at all). One name in scripts/overlay-spec.cjs restores HOOK_REQUIRES_OK and coop-deploy reset=53 series=8 OVERLAY_OK.
tests: node scripts/coop-hook-requires.cjs --checkout <Code> -> HOOK_REQUIRES_OK targets=1289 installed=375 stock=663
overlay: OVERLAY_OK (reset=53 patches=series=8) ; docker build + compose recreate OK
live: the living world is back (living-native-durable-slot 13:04:08Z) and the new claim phases ran in the same boot
metrics: tests_total=0 pass=0 fail=0 modules_added=1 modules_changed=0 live_events=1
next: catch the restore -> warp -> custody -> station -> seeded sale chain inside one boot.

## 2026-10-27T13:15Z - FW-024: militia enlistment + player war participation (67b98649, 8bea602a, 88065415, 1abc629a)
done: enlistment enabled for every faction whose SDE row really has a militiaCorporationID (500001,500002,500003,500004,500010,500011); the character's own faction (140000005 Sasunok1488 = Caldari State 500001) and its game-defined opponent (Gallente 500004) are resolved from data; an enlisted player is a legal war target for the opposing NPC fleet only, his own faction never fires on him, and his kills pay real war merit.
tests: node --test tests/coop-militia-war-player.test.mjs tests/coop-militia-war-data.test.mjs tests/coop-war-battle-director.test.mjs tests/coop-faction-war-opening.test.mjs tests/coop-faction-war-agent.test.mjs tests/coop-npc-destruction-attacker.test.mjs tests/coop-war-merit-ledger.test.mjs tests/coop-war-rank-title.test.mjs tests/coop-war-militia-agent-frontline.test.mjs -> 91 pass / 0 fail
overlay: OVERLAY_OK (apply INSTALLED coopMilitiaWarData.js, 59 patched, problems []); docker build evejs-local + compose recreate server OK
live: militia_enlist 140000102/3012018 -> {"ok":true,"agentSays":"[Militia] Enlistment recorded for Caldari State. No items or ISK granted.","enlistment":{"characterID":140000102,"factionID":500001,"status":"ACTIVE","rank":0,"enlistedAt":1793106715078,"cooldownUntil":0},"sessionProof":"SERVER_SIDE_IN_PROCESS_SESSION_NOT_A_CLIENT_LOGIN"} ; militia_state 140000102 -> situation MILITIA_AVAILABLE faction 500001 militiaCorporationID 1000180 warzone 2 enemyFactionIDs [500004] fronts [] ; war_state -> territories 2 wars 1 campaigns 0
metrics: tests_total=91 pass=91 fail=0 modules_added=2 modules_changed=6 live_events=2
next: NEEDS_OWNER:BLOCKED_NO_ARMED_NAVY_LOADOUT - a Caldari/Gallente front needs armed navy patrols, and 0/146 Caldari (500001) and 0/132 Gallente (500004) profiles have any loadout row (all resolve to retail_empty_npc_entity_loadout), while the only authorable base rows refuse with NO_COMPATIBLE_CHARGE (CONCORD 16128) or BASE_LOADOUT_ROW_MISSING (trig). The pirate war 500011-500020 keeps running untouched.

## 2026-10-27T13:32Z - ITEM 1 CLOSED live: kill -> loot -> real seeded sale (c8a69b63, 3f290ab4, 316539b4, 507934af, 217ec980, 85e19cd9)
done: the four blockers between a real wreck and a real sale are gone: a claim restores its own native wreck from its durable row (or closes honestly), a hold smaller than the stack moves what fits and leaves a real remainder item, the loot phase clears the killer stale combat order in the same tick, and a full hold delivers before taking more.
tests: node --test tests/coop-npc-wreck-custody.test.mjs tests/coop-npc-loot-commerce.test.mjs tests/coop-npc-wreck-claim-reconcile.test.mjs tests/coop-npc-native-wreck-recovery.test.mjs tests/coop-native-raids-gameplay.test.mjs -> 82 pass / 0 fail
overlay: OVERLAY_OK (reset=53 patches=series=8) ; docker build + compose recreate OK
live: NATIVE_WRECK_CARGO_SETTLED 1200 units typeID 17471 wreckID 980300000010 remainder 75660 -> PHYSICALLY_AT_NATIVE_STATION 60014935 -> TRADE_SETTLED balance 10332 marketOrderSource EVEJS_SEED marketRPC FillOrder sourceOfFunds SEED_MARKET_FILLED_ORDER
metrics: tests_total=82 pass=82 fail=0 modules_added=1 modules_changed=5 live_events=4
next: the corp treasury sweep moved an Angel pilot 10332 ISK into corporation 1000129, so war_funding_diagnose reads NO_REAL_FACTION_INCOME; make the sweep respect the pilot own corporation, then fund 500011 and prove the escrow payout.