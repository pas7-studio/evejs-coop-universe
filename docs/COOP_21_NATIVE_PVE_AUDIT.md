# Chat 21 — pinned EveJS PvE support and objective safety

Pinned source: gameboys84/EveJS c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f.
Status: CODE_PREPARED / PINNED_SOURCE_REVIEWED / CENTRAL_INSTALLER_INTEGRATION_PENDING / LIVE_CLIENT_UNVERIFIED.

## What was actually checked

Nine exact server files were inspected from the pinned upstream by the GitHub source connector: 9/9 source-presence contracts matched. The native anomaly completion patch anchor is unique in the pinned source. Source-to-patch-to-unpatch roundtrip reproduced the byte-identical original in source review. Local Node unit tests: 13 PASS, 0 FAIL, 2 SKIP (local Code checkout unavailable). None of these is server-native or two-client gameplay proof.

Source is not a licensed, working EVE client. Client RPC support in the server does not prove that the client can render/interact with the activity. No real player reward, dual-client completion, restart or NPC physical spawn was witnessed in this chat.

## Native support matrix

| PvE activity | Native server and RPC evidence | Finding |
| --- | --- | --- |
| Combat anomalies | dungeonUniverseRuntime combat_anomaly slots and rotation; dungeonInstanceCacheMgr.GetCombatAnomalyInstances; dungeonUniverseSiteService encounter waves, objective progression and completion | Native path exists, client and rewards unverified |
| Combat complexes and signatures | signatureRuntime.listSystemSignatureSites, authored dungeonAuthority template lookup, dungeon site materialization and NPC spawn plans | Conditional on authentic template and spawn; no invented variants |
| Dungeons / multi-room | dungeonRuntime native instances/gates/objectives; dungeonTrackingRuntime client entry and OnDungeonCompleted | Completion notices can go to both physically present players; they do not grant duplicate personal mission, ISK, LP or items |
| Escalation chains | dungeonExplorationMgr.GetMyEscalatingPathDetails | buildEscalatingPathDetails returns an EMPTY ROWSET: no real stage/chain reward flow demonstrated |
| Incursions | incursionRuntime.listActiveIncursions and replaceActiveIncursions, incursionPayloads reporting | In-memory state/report surface only: no completed Incursion battle/ISK/LP lifecycle established |
| Abyssal Deadspace | abyssalMgrService RPC endpoints | AbyssalEntranceDeployment explicitly rejects because content generation is unavailable; do not fabricate pockets/filament rewards |
| Homefront Operations | dungeonInstanceCacheMgr.GetHomefrontSiteInstances archetype 70 bucket | Discovery bucket only, not authored site completion/reward proof |
| Triglavian and other special combat sites | cache buckets and common dungeon runtime | Only genuine authored and eligible native sites can be considered; live unverified |

Actual completion/reward restrictions: the existing dungeonUniverseSiteService may create authored loot-profile containers, and native game item custody must separately prove source debit and destination grant. A site completion notification is not proof of loot payout. Physical two-player presence is not sufficient to grant personal mission credits; existing Chat 19 logic must verify accepted instance and eligibility. Respawn is owned by dungeonUniverseRuntime/dungeonSiteSpawnPolicy; this change introduces no alternate scheduler or spawn IDs.

## Identified pinned native anomaly completion bug

Within dungeonUniverseSiteService.js, isEncounterCompletionSatisfied correctly handles completeObjectiveOnEncounterClear=false and explicit destroyed-objective modes. Yet maybeCompleteClearedEncounterSite separately closes an ACTIVE combat anomaly when every encounter has completed regardless of those explicit flags. This may expire a live objective site prematurely.

Isolated correction:
- integration/coopNativePveObjectiveGuard.cjs permits normal clear-based combat anomalies but refuses a completed lifecycle if a required native objectiveSatisfiedAtMs is absent. Only server-native instance metadata counts; string/invalid timestamps fail closed.
- scripts/coop-pve-native-objective-patch.cjs installs ONE statement before the native completion plans check. Idempotent, LF/CRLF-agnostic, unknown-source fail-closed, byte-exact reversible. Flag EVEJS_COOP_NATIVE_PVE_OBJECTIVE_GUARD=1 defaults OFF.
- scripts/coop-pve-native-support-audit.cjs is a read-only pinned source audit, not a gameplay claim. Run node scripts/coop-pve-native-support-audit.cjs --code-path <EveJS/Code>.
- tests/coop-pve-native-objective.test.mjs and tests/coop-pve-native-support-audit.test.mjs cover rules, regression, OFF/ON, false-positive prevention and rollback. tests/coop-pve-native-pinned.test.mjs exercises actual pinned Code only when EVEJS_COOP_CODE_PATH is available.

### Integration handoff to Chat 01 (central installer owner)

The shared scripts/patch-evejs-coop.cjs was NOT touched by this chat. To deploy the prepared fix, add coopNativePveObjectiveGuard to its existing names list; deploy its module to Code/server/src/space/coopNativePveObjectiveGuard.js. The existing spec for server/src/services/dungeon/dungeonUniverseSiteService.js must call require("./coop-pve-native-objective-patch.cjs").patch(text,spec.file,{remove}) exactly ONCE through the existing central transform, coordinated with Chat 19's dungeon mission transform. Reject incompatible anchor layouts, do not stack a new patcher. The flag remains OFF until owner-approved gameplay acceptance. Perform dry-run, central --check and full crossstream overlay roundtrip on a separate pinned tree before enabling. These files ALONE do not modify the deployed game.

## Required manual acceptance gates

1. Preserve running EveJS/Code changes and evejs-data volume. Verify actual pinned version, state freshness, server overlay and valid native dungeonAuthority templates. Do not restart/rebuild as an audit substitute.
2. With two distinct authorized clients, use real scanning and native anomaly/site ID reports to find a shared authentic combat anomaly. Record unique native instanceID, siteID, template, system and player ship IDs without publishing private raw logs.
3. Observe actual NPC spawns and waves, blocking enemies destroyed, final objective satisfied or deliberately left intact. With flag ON, an anomaly configured completeObjectiveOnEncounterClear:false must remain active when all waves are cleared but its separate objective remains; after actual native satisfaction, it must complete only once.
4. Run an authored complex/dungeon with real rooms, gates and NPC attacks; check objective chains and real item custody. Each pilot's reward must be justified independently; no duplicates after reconnect or restart.
5. Confirm completion notification, universe rotation/respawn timings and native persistence. A renewed site must have authoritative identity and must not revive already-looted reward containers.
6. For escalation, Incursion, Abyssal and Homefront categories, record actual unsupported/empty behavior, rather than creating fake lookalikes. Promote a category only with authentic site generation, NPC objective completion and real rewards.

No native client files, CI workflows, fake arenas, Incursion emulators, Abyss rewards, extra economy state or external network listeners were introduced.
