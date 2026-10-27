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
