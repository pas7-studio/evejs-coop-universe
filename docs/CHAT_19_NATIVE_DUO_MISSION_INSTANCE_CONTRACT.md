# Chat 19 - native co-op agent mission instance provenance

**Status: CODE_READY / LIVE_UNVERIFIED.** The 2-player native client Request -> Offer -> Accept -> Objective -> Complete and payout path was NOT verified in a running server or real EVE clients. The project remains an overlay, not a standalone EveJS implementation.

## Scope and pre-existing authority

Reuses existing `coopFleetMissionJoin`, `coopFleetDungeonCredit`, `coopFleetMissionTurnin`, and pinned EveJS `agentMissionRuntime`, `missionRuntimeState` and dungeon instance manager. Existing per-recipient leader and peer fsynced payout fences are untouched. Does NOT duplicate native ISK/LP/items/standing writers or claim a cross-store ACID reward transaction. Native mission rewards are still paid by stock `doAgentAction` per character.

At source revision `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`, native `offerSpecificMission()` persists a distinct `offered` mission with an independently allocated `missionSequence`. Native Accept transitions that same record to `accepted`. The existing dungeon bridge compared content/template and physical presence, but lacked an immutable proof that the wingman's offer originated from the exact captain's accepted mission instance.

## New opt-in, OFF by default

`EVEJS_COOP_MISSION_INSTANCE_LINK=1` enables a persistent, fail-closed link receipt that connects:
- Captain `ownerID + agentID + leader missionSequence + real dungeonInstanceID + mission systemID`.
- Wingman `peerID + agentID + independently offered missionSequence` from the **native authenticated Request Mission** response.
- Exact `contentID` and `missionTemplateID` as supporting checks, never as sole authority.

The journal is JSONL at `/var/lib/evejs/coop-mission-instance-links.jsonl`, customizable by absolute `EVEJS_COOP_MISSION_INSTANCE_LINK_FILE`. Append and fsync occur after native `offerSpecificMission` returns a real offered mission; parent directory fsync is also required. The initial offer write is not atomic with the separate journal: a crash between them results in a legitimate but *unlinked* offered mission, which cannot gain *shared* objective credit until operator reconciliation. Existing solo/independent native mission rights are not modified. Duplicate immutable receipts are idempotent. A different peer, reoffered sequence, leader mission sequence or physical dungeon cannot reuse this provenance. Ledger corruption, partial write, conflicts, unreadable path and missed fsync fail closed.

`coopFleetDungeonCredit.observe` checks the durable receipt **before** invoking the existing source-authored `shareCoopDungeonObjective`. The current native two-ship physical mission-site proof remains mandatory; fleet membership or matching mission title is insufficient. It does not fabricate damage or contribution: physically present players can be credited through the existing native share mechanism, but positive damage by each pilot is a separate `coopPlayerCombatWitness` proof.

`coopFleetMissionTurnin.prepare` and `finish` check the same immutable link when the flag is enabled. Automated peer settlement additionally requires the wingman's **native persisted `coopSharedDungeon` objective receipt**, referencing the same source dungeon/agent/owner, plus independently completed accepted mission. A participant who completed their *own* separate mission without that native shared receipt can still turn it in independently using vanilla agent mechanics; the automated joint payout will not impersonate them.

## Chat 01 central installer contract

Do NOT edit owner-managed `scripts/patch-evejs-coop.cjs`, `scripts/Deploy-Coop-RuntimeProbe.ps1` or `integration/coopVirtualWorldRuntime.cjs` in Chat 19. Chat 01 should register the single new L2 module `integration/coopMissionInstanceProvenance.cjs` in the existing `names` installer list so it copies to `Code/server/src/space/coopMissionInstanceProvenance.js`, as with all other `.cjs -> .js` modules. No additional L1 source hooks or scheduling loops are necessary: the three existing deployed L2 modules call it only under `EVEJS_COOP_MISSION_INSTANCE_LINK=1`. Keep this new flag OFF until source dry-run, exact pinned overlay roundtrip, actual two-client native Request/Accept/objective/reward acceptance, restart and crash tests. Recheck other agents' PRs before deployment.

## Local tests

`node --test tests/coop-mission-instance-provenance.test.mjs tests/coop-mission-instance-provenance-wiring.test.mjs` should pass in the full repo. Additional existing tests are important: `tests/coop-fleet-mission-join.test.mjs`, `tests/coop-fleet-dungeon-objective.test.mjs`, `tests/coop-fleet-p0-cooperative-actions.test.mjs`, `tests/coop-duo-mission-leader-fence.test.mjs`, and `tests/coop-crossstream-overlay-roundtrip.test.mjs` with the exact pinned `EVEJS_COOP_CODE_PATH`. The prior payout fences and native source are not altered by this change. No CI or production server access was used.

## Unresolved acceptance blockers

1. The overlay must be registered and installed via Chat 01's existing transactional installer; the mere repository commit does not activate it.
2. A running native EveJS server and two authorized real clients are required to prove agent UI Request/Offer/Accept, legitimate mission instances, physical dungeon objectives and owner-specific actual ISK/LP/items/standing changes.
3. Cross-store native wallet/LP/inventory/mission-history payout is not fully atomic. Existing PREPARED/UNKNOWN fences prevent automatic duplicate payouts but can leave an ambiguous lawful entitlement for manual reconciliation after disconnect/process crash. Never claim both players always receive all payments autonomously or recover by blindly retrying.
4. No independent damage contribution is required by the existing dungeon native share contract. Do not assert both pilots damaged the objective without real positive damage witness events.
