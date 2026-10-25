# P0 — Native two-pilot mission offer alignment (opt-in)

**Feature:** when a second, authenticated fleet member personally presses **Request Mission** in the stock EveJS agent dialogue, offer that pilot the **same allowlisted client mission** that the two-player fleet creator has already accepted. The second pilot must then independently press the stock **Accept** button. No rewards, objectives, wallet, LP, standings, GM flags, NPCs or fabricated site instances are granted by this feature.

**Pin:** EveJS `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. Native source is untouched by Git; one reversible and default-OFF L1 statement runs through the existing transactional `scripts/patch-evejs-coop.cjs` installer. New module `integration/coopFleetMissionJoin.cjs`; native patch helper `scripts/coop-fleet-mission-join-patch.cjs`.

## Problem in actual pinned native source

`agentMissionRuntime.offerMission` picks the next client mission by each character's **own** `missionSelectionCursorByAgentID`. Even two characters in the same fleet speaking to the same agent can receive different missions. Existing `coopFleetDungeonCredit` and `coopFleetMissionTurnin` correctly refuse mismatched mission content/template, so simply entering a fleet cannot make the co-op mission cycle work.

## Safe ordinary player flow

1. Two separately authenticated users join a real native fleet of **exactly two**. The creator stays a member and accepts an **ordinary, non-important, non-career, non-storyline dungeon mission** through stock agent actions.
2. Both users dock at that **agent's actual station**. The module checks a single current connected native session per character and uses EveJS's `getDockedLocationID`, so station vs. structure identity is authoritative.
3. When the second user personally presses **Request Mission** for the **same agent**, the default-OFF hook may invoke `coopFleetMissionJoin.offer`. Its authority is limited to proposing an offer, never granting mission completion.
4. It requires exact native fleet membership, accepted leader dungeon with real `dungeonInstanceID`, unchanged agent/content/template, native standing availability, no peer cooldown, no peer existing offered/accepted mission, and an allowlisted underlying client mission. It invokes the existing **native `offerSpecificMission(peerID,...)`**, which creates a separate, normal **offered** mission with its own sequence.
5. The original `offerMission` path continues and returns the newly offered record via stock agent dialogue. The second player sees the offer and must click **Accept** themselves. If the feature is OFF or a gate is not met, the original vanilla personal mission offer behavior remains authoritative.
6. Both pilots must then actually reach the real mission site. The existing native co-op dungeon module may credit the wingman's objective only when both real ships are at the completed leader site, and the existing turn-in refuses payment until both **native accepted mission** objectives are complete.
7. Completion and real ISK/LP/items/standing updates remain native per-character actions. This feature does **not** make the two-reward settlement globally atomic. Experimental `EVEJS_COOP_FLEET_MISSION_TURNIN` remains independently OFF by default.

**Opt-in:** `-LivingCoop -EnableMissionJoin` sets `EVEJS_COOP_MISSION_JOIN=1` only when explicitly requested at a separately approved deployment. Standard `-LivingCoop`, existing market catalog, NPC chatter, native trade/custody and friend-PC access continue unchanged.

## Important limitations

- This is **native offer alignment**, not a replacement for a fleet mission-management UI with invitations, approvals and shared mission selection. The creator's pre-existing mission is the source; the fleet's current commander may differ from the original creator, in which case this first iteration falls back to vanilla offers.
- The creator must have **accepted the mission before** the wingman presses Request Mission. It does not rewrite a wingman's pre-existing offer or accepted mission. Declining, expired missions, career/storyline/transport missions and different agents do not gain shared rewards.
- The two independently created native missions still have their own mission sequences and normally their own dungeon state; only the existing verified two-ship completion bridge handles shared objective credit at the actual leader site. This PR does **not** clone the creator's site or force the client onto it.
- If native `offerSpecificMission` produces a different content ID or template, the module reports `JOIN_OFFER_MISMATCH_REQUIRES_MANUAL_REVIEW`. No fake co-op readiness, reward or completion is reported. Native mission persistence failures are not retried automatically.
- Clicking Request Mission is an explicit action by the **second user's authenticated client**, not an agent impersonation; it does not enroll an inactive wingman or auto-accept for them.

## Evidence / testing

- **16/16** direct native-join regressions passed in an isolated JS execution harness: accepted/unchanged separate offers, no repeat, standing/cooldown, existing mission, wrong fleet, ghost and duplicate sessions, station/structure mismatch, invalid dungeon, career/storyline exclusion, allowlist and native uncertainty.
- **3/3** vertical contract regressions passed using actual `coopFleetMissionJoin` plus existing `coopFleetMissionTurnin.prepare`: offered-only cannot pay; both independently accepted and completed native missions pass the existing turn-in preflight; mismatched mission content/template fails.
- Actual upstream pinned `agentMissionRuntime.js` (211,741 bytes) plus the existing `coop-fleet-mission-native-patch.cjs` and the new join helper: native source **parses**, second application is **idempotent**, and removal returns **byte-exact original**. The **complete current pinned transactional installer transform** was also run against the real upstream source with those properties.
- Added `tests/coop-fleet-mission-join-overlay.test.mjs` for official local Node+upstream roundtrip coverage and default-OFF deployment-flag guard. **Official Node `node --test`/Docker/two real client acceptance have not been run** from this connector session.

### Approved checkout verification, read-only first

```powershell
node --test tests/coop-fleet-mission-join.test.mjs tests/coop-fleet-mission-join-vertical.test.mjs tests/coop-fleet-mission-join-overlay.test.mjs
$env:EVEJS_COOP_CODE_PATH='C:\Games\EveCoop\upstream-evejs\Code'
node --test tests/coop-fleet-mission-join-overlay.test.mjs tests/coop-crossstream-overlay-roundtrip.test.mjs
node scripts/patch-evejs-coop.cjs --code-path $env:EVEJS_COOP_CODE_PATH --dry-run
node scripts/patch-evejs-coop.cjs --code-path $env:EVEJS_COOP_CODE_PATH --check
```

The dry-run must show the new overlay `server/src/space/coopFleetMissionJoin.js` and the existing native agent source in the transaction plan, without writing them. `--check` of the currently deployed old revision may legitimately report the **new module missing**; never describe a missing module as `OVERLAY_OK`.

### Required gameplay acceptance before enabling

With owner approval and a backed-up disposable test deployment, use two separate real EVE clients and one genuine eligible agent. Validate stock offer and native fleet creator's Accepted state, wingman Request showing **exactly the same native content ID**, explicit wingman Accept, both mission journals, fleet warp into the leader's actual dungeon, shared objective after physical participation, and each individual's real wallet/LP/standings/hangar after completion. Reconnect both before and after mission and check no duplicated reward/ghost offer. Test negative scenarios: standings restriction, peer cooldown, different station, disconnect, peer has own mission, wrong fleet, career/storyline agent.

**No Docker restart, upstream modification, permanent data/market mutation, public network access, CI, or main merge performed in this PR.**
