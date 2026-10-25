# Chat 20 — personal storyline, career and Epic Arc progression

Status **CODE_READY / LIVE_UNVERIFIED / NOT WIRED**. Pinned upstream:
`gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.
This change supplies default-OFF source modules and isolated regression tests,
**not** a claim that Epic Arcs or two-client missions are playable.

## Verified native structure and defects

- `services/agent/missionRuntimeState.js`: native per-character SQLite
  `missionsByAgentID`, `history`, `completedCareerAgentIDs`,
  `epicArcProgress.missionStatusByArcID`, `completedArcsByID` and
  `storylineProgress.pendingOffersByAgentID`; Epic replay = **90 days**.
  The state is normalized on load. Never build parallel progress state.
- `services/agent/missionAuthority.js`: authored `missionID`,
  `epicArcID`, `nextMissionIDs`, authored agent IDs, allowlists. Use
  `getPayload().missionsByID` to find incoming edges; a mission title or
  identical template does not prove progression.
- `services/agent/agentMissionRuntime.js:5039–5092`:
  `acceptMission` grants `initialAgentGift` before committing
  `runtimeStatus="accepted"`. Repeated Accept after an interrupted write
  can duplicate the gift.
- `agentMissionRuntime.js:5129–5351`:
  `completeMission` calls wallet, item, LP and standing writers **before**
  recording history, career completion and Epic Arc completion. Failure
  after a subset of these writes leaves a repeatable accepted mission;
  there is no demonstrated atomic all-reward transaction.
- `agentMissionRuntime.js:5737–5816`:
  `advanceConversationMission` completes the previous stage before
  resolving and offering the next mission; interruption may strand a
  character with native completed history but no next offer.
- `agentMissionRuntime.js:4904–5005`: ordinary `offerMission` and
  `offerSpecificMission` do not themselves enforce authored Epic Arc
  predecessor and replay rules on every path.
- `services/agent/epicArcStatusService.js` checks root-agent availability,
  but this does not make all lower-level offer/accept/settlement writes
  atomic or cover forced admin/test paths.

## Implemented: native-authority-only preflight

`integration/coopStoryMissionGuard.cjs` exports
`createStoryMissionGuard`. Supply **actual** pinned EveJS callbacks:

```js
const sessionRegistry=require("../services/chat/sessionRegistry");
const characters=require("../services/character/characterState");
const missionState=require("../services/agent/missionRuntimeState");
const missionAuthority=require("../services/agent/missionAuthority");
const agents=require("../services/agent/agentAuthority");
const nativeMission=require("../services/agent/agentMissionRuntime");
const guard=require("./coopStoryMissionGuard").createStoryMissionGuard({
 getSessions:()=>sessionRegistry.getSessions(),
 getCharacterRecord:id=>characters.getCharacterRecord(id),
 getCharacterStateSnapshot:id=>missionState.getCharacterStateSnapshot(id),
 getAgentByID:id=>agents.getAgentByID(id),
 getMissionByID:id=>missionAuthority.getMissionByID(id),
 listAuthoredMissions:()=>Object.values(missionAuthority.getPayload().missionsByID),
 isMissionOfferAllowedForAgent:(agent,mission)=>
   missionAuthority.isMissionOfferAllowedForAgent(agent,mission),
 checkAgentEligibility:(characterID,agent)=>
   nativeMission.canUseAgent(characterID,agent),
 nowFiletime:()=>missionState.currentFileTimeString()
});
```

**Action contract** — always take fresh native state at the action boundary,
and **do not** let a previous request's `ok` bypass a subsequent check:

- `check({session,action:"offer",agentID,missionID,
  sourceAgentID?,sourceSequence?})` after a canonical mission candidate
  is selected, **before** persisting an offer. Rejects duplicate active
  agent, mismatched account/session, eligibility, cooldown, missing
  personal storyline milestone, career rerun, skipped Epic predecessors.
- `check({session,action:"accept",agentID,missionID,
  expectedSequence})` before `grantMissionInitialAgentGift`.
  Requires the exact native offered sequence. Returns an immutable native
  `PERSONAL_ACCEPT_AUTHORIZED` proof that may be reserved under the
  separate `ACCEPT_GIFT` settlement key BEFORE the first
  `grantMissionInitialAgentGift`. This prevents an automatic gift
  replay after an ambiguous crash, but unknown state needs reconciliation.
- `check({session,action:"complete",agentID,missionID,
  expectedSequence})` before **any** native payout side effect.
  Requires a matching Accepted mission, completed native objective
  and no matching completed history. Returns
  `PERSONAL_COMPLETE_PREFLIGHT_ONLY` with the immutable mission identity.
- `check({session,action:"advance",agentID:nextAgentID,
  sourceAgentID,sourceMissionID,sourceSequence,nextMissionID})`
  before completing the existing accepted agent-interaction stage.
  Checks authored edge and same Epic Arc, canonical receiving agent,
  eligibility, source sequence and absence of a conflicting next offer.
- `check({session,action:"recover",agentID:nextAgentID,
  sourceAgentID,sourceMissionID,sourceSequence,nextMissionID})`
  **after reconnect**, only if native `history[0]` proves the precise
  completed source and the intended next agent has no active mission.
  The result authorizes an **offer only** through native
  `offerSpecificMission`; never re-complete/pay the source stage.

These decisions are pure, use existing authoritative state and do not
mutate or clone native missions, player accounts, character progress,
objectives, rewards, cargo or standings. For unscripted missions they
return `skip:true`, leaving ordinary native/Chat 19 flow untouched.

## Implemented: durable at-most-once payout fence

`integration/coopStoryMissionSettlementFence.cjs` exports
`createStoryMissionSettlementFence({file})`. Use a **persistent, absolute**
operator-approved JSONL path, e.g.
`/var/lib/evejs/coop-story-mission-settlement.jsonl` (never use
`/tmp` in a server). Call `begin({preflight,mission})` only with a
fresh `PERSONAL_COMPLETE_PREFLIGHT_ONLY` receipt and a mission
identity containing native `characterID`, `agentID`,
`missionSequence`, `contentID`, `missionTemplateID`.

Use `begin({preflight,mission,kind:"ACCEPT_GIFT"})` before the native
Accept path (including its initial gift), or
`begin({preflight,mission,kind:"COMPLETE"})` before native Complete.
The journal key includes action kind, so a claimed gift does not consume
the later mission reward. A single on-disk writer lock and `fsync`
reserve the immutable per-character/per-sequence key as `PREPARED`
**before** the trusted native action. Invoke **exactly one** native action. Then call
`finish({ticket,nativeResult,readNativeState})` and verify that native
mission history contains the exact completed sequence and no active
mission for that agent (Complete), or that the exact mission sequence
is now native `accepted` (Accept/initial gift). Only then append
`SETTLED`; otherwise append `UNKNOWN`. After restart, `PREPARED`/`UNKNOWN` blocks automatic
retries for manual reconciliation, and `SETTLED` rejects replay.
Corrupt/truncated journals and stale lockfiles fail closed. Do **not**
delete the lock or journal to force success.

This prevents **automatic duplicate reward calls**, but it is **not**
an atomic multi-store commit and cannot guarantee a missed payout is
automatically restored. Owner/operator must reconcile ISK, LP, unique
items, mission gift, standings and native history after an unknown
outcome. A native SQLite wallet/inventory/LP/standing transaction with
idempotent reward lines would be required for fully automatic exactly
once settlement. No shadow wallet or synthetic reward is created.

## Personal vs cooperative policy

- Career agent completion flags, storyline counters/milestones, Epic
  status and replay cooldowns are **character-specific**, not fleet
  flags. No automatic mirrored acceptance, rewards or standings.
- An Epic/storyline/career stage with an encounter dungeon may allow
  **two physical ships to fight together**, but that is not evidence
  both characters accepted that stage or earned a reward. Full shared
  objective credit is NOT certified for scripted content.
- The existing `coopFleetMissionJoin` opt-in design supports an
  **ordinary independently accepted dungeon mission**; it intentionally
  excludes important/storyline/career missions in its leader gate.
  Chat 19 must also exclude client missions with `isEpicArc`/
  `epicArcID` even if `importantMission` is false. Reuse the
  exported `classify` helper to avoid silently sharing an Epic stage.
- Faction and standings prerequisites use native `canUseAgent`,
  without fabricated standing or GM objective completion.
- Chat 01 owns the shared installer/native hooks and must wire these
  modules behind **`EVEJS_COOP_SCRIPTED_MISSION_GUARD=1`**, default OFF.
  Chat 19 owns cross-player mission grants; no shared files were edited.

## Reproduction and acceptance

Isolated tests: `tests/coop-story-mission-guard.test.mjs` (12 cases)
and `tests/coop-story-mission-settlement-fence.test.mjs` (10 cases).
The module sources and test bodies passed an in-memory JS execution
harness against the exact submitted blobs: **22/22**, no failures.
This is NOT an official local Node `node --test`/Docker/client run.

On an authorized disposable deployment only, Chat 01 should first
run local `node --test tests/coop-story-mission-*.test.mjs` and the
existing overlay `--dry-run`/`--check` and roundtrip suite; then
perform a real two-client test with distinct character accounts:
personal storyline offers, career completion, Epic branch, 90-day replay
cooldown, native mission site, solo vs duo encounter, Accept retry,
Complete retry, reconnect before/after completion, forced process
interruption **after** settlement PREPARED, and independent native
wallet/LP/items/standings/mission history inspection. Never test against
a valuable existing live world or delete persistent volumes.
Status remains **CODE_READY / INTEGRATION_CHAT01_REQUIRED /
LIVE_UNVERIFIED** until these gates pass.
