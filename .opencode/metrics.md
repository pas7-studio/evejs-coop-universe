# Loop metrics — append-only. One block per commit. Never edit an old block.

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
