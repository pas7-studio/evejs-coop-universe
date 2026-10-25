# Chat 06 - pinned EveJS player travel continuity contract

Status: CODE_READY / LIVE_UNVERIFIED / NOT INSTALLED. This package is an isolated
source module and deterministic tests, not a claim that game travel works.
The runtime integration belongs to Chat 01. Wormholes belong to Chat 23.

## Source review (pinned c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f)

- `Code/server/src/space/transitions.js:967-998` `beginTransition` blocks only
  another *same kind* within the guard window; another kind replaces the
  `_transitionState` record. A dock, solar jump, clone jump or stargate jump
  can race unless the active native session is revalidated.
- `transitions.js:2990-3118` `jumpSessionViaStargate` checks the physical gate
  distance only *if both* the native ship and gate entity are found. With a
  missing entity this check is skipped, although the gate SDE record exists.
  The delayed callback at 3095-3107 captures `session` and `activeShip` but
  does not re-check registry ownership immediately before state mutation.
- `transitions.js:1607-1794` `completeStargateJump` detaches first, then
  `moveShipToSpace`, `updateCharacterRecord`, `applyCharacterToSession`,
  `attachSession`. Failure after detachment has no automatic atomic rollback
  across native stores. `attachSession` is not checked for physical arrival.
- `transitions.js:1890-2231` native undock/dock; `3340-3657` station and
  solar jumps. `dockSession` intentionally recharges shield and capacitor
  (`charge` and `shieldCharge` are set to 1) during docking.
- `Code/server/src/services/ship/beyonceService.js:2525` supports native
  warp-to-entity and warp-to-point destinations; `3010-3047` is the client
  `CmdStargateJump` handler. `1837-2206` contains fleet beacon, jump drive,
  bridge and conduit jump commands. These use `jumpSessionToSolarSystem`;
  some consume native fuel *before* transition. Snapshot the cargo only
  after a legitimate native fuel debit.
- Neither `beyonceService.js` nor `transitions.js` contains a Shipcaster RPC.
  Do not infer support from newer EVE Online or create a fake shipcaster.
  A full native service/client RPC inventory is still needed before ruling
  the mechanism out everywhere.

## New independent module

`integration/coopPlayerTravelGuard.cjs` exports `createPlayerTravelGuard`.
It is strictly observational except for rejecting unsafe entry into a
transition. The module never mutates a native inventory, wallet, scene,
entity, session or character record and does not move ships.

Dependencies (inject the actual native pinned EveJS functions, not mocks in
production):

```js
const guard = require('./coopPlayerTravelGuard').createPlayerTravelGuard({
  getActiveShipRecord: require('../services/character/characterState').getActiveShipRecord,
  getCharacterRecord: require('../services/character/characterState').getCharacterRecord,
  getSceneForSession: require('./runtime').getSceneForSession,
  getSessions: require('../services/chat/sessionRegistry').getSessions,
  listContainerItems: require('../services/inventory/itemStore').listContainerItems,
  getStargateByID: require('./worldData').getStargateByID,
});
```

Methods and return contract:

- `guard.begin({session,kind,destinationSystemID?,destinationLocationID?,sourceGateID?,destinationGateID?})`
  returns `{ok:true,ticket}` or `{ok:false,reason}`. `kind` is one of
  `stargate`, `solar-jump`, `dock`, `undock`. No fleet-warp, wormhole or
  shipcaster alias is accepted. Stargate requests require an actual gate
  entity within 2500m surface distance, reciprocal SDE gates, a linked
  source native scene, a physical ship owned by the registered character,
  an unambiguous native account-matched session, live original ship from
  `scene.getShipEntityForSession`, finite position and no active warp.
  Source gates may appear in the authoritative static topology instead of
  the dynamic entity map, but a gate absent from both fails closed.
- `guard.pendingFor(session)` returns a ticket only for its original session.
- `guard.handoff(ticket,session)` rechecks that the same registered client
  and ship still own the source just before detaching. Reject any
  disconnect, stale session, changed ship, changed system or expiry.
- `guard.finish(ticket,session,{docked:false,expectedArrivalPoint:null,arrivalToleranceMeters:2500})` verifies that the same
  authoritative ship and character appear in the real destination scene,
  that the ship is *absent* in the original source scene, and that exact
  native contained item IDs/owner/quantity/fitting flags, nested charges,
  item custom info/damage metadata and ship HP are preserved.
  Use `{docked:true}` only for a `dock` ticket: the source scene must lose
  the hull and native station/structure ID must match. Native shield/cap
  recharge is intentionally allowed while remaining damage fields cannot
  silently change. A successful result explicitly carries
  `clientArrivalVerified:false`; only a real EVE client can prove rendering.
  Supply `expectedArrivalPoint: spawnState.position` from the native EveJS
  transition to verify the physical landing against its own authoritative
  computed anchor (within the optional tolerance). With no native anchor
  supplied, `nativeArrivalCoordinatesVerified:false`, never claim position
  evidence merely because the ship exists in the destination scene.
- `guard.cancel(ticket)` may clear the ticket ONLY after a confirmed
  no-mutation failure/rollback; never cancel an ambiguous transaction and
  blindly retry. A failed `finish` retains the unresolved ticket.

`begin` uses native source `shipID`, `characterID`, `session.userid` and
`getCharacterRecord(charID).accountId`, `ownerID`, `spaceState`,
`session._space`, `scene.sessions`, `scene.getEntityByID`,
`scene.getShipEntityForSession`, the native live session registry and
recursive `listContainerItems(null,parentID,null)`. It does not
maintain a separate durable pilot/ship registry. Pending tickets are
*ephemeral verification state*: after a process restart, use native item and
character stores to assess continuity; NEVER replay the old command or
invent a replacement ship from this module.

## Required Chat 01 integration contract

Feature flag: `EVEJS_COOP_PLAYER_TRAVEL_GUARD=0` by default. Central installer
must register only this L2 module and add single-call native hooks in the
existing reversible patcher, preserving all current hooks and roundtrip.
No second installer or runtime wrapper.

1. In `jumpSessionViaStargate`, at the verified source gate / physical
   distance check and before `spaceRuntime.startStargateJump`, invoke `begin`
   with real source/destination SDE data; a rejection must return a native
   failure, not start an FX, move the ship or fabricate success.
2. At the start of delayed `completeStargateJump` (before deactivating
   modules, detaching or moving inventory), fetch the same ticket with
   `pendingFor(session)` and invoke `handoff`. Reject a stale/disconnected
   handoff, and safely clear the original native transition state. After
   `attachSession`, verify the native destination scene and call `finish`
   with `expectedArrivalPoint:spawnState.position`.
   Failure after mutation must be reported as an unresolved safety incident
   requiring native store reconciliation; do not autoretry the jump.
3. For `jumpSessionToSolarSystem` (cyno / fleet beacon / bridge / conduit)
   call `begin(kind='solar-jump')` after the legitimate fuel debit but
   before native detach. Do not duplicate fuel consumption. `handoff`
   immediately before detach; `finish` after native attach with
   `expectedArrivalPoint:spawnState.position` from native code. On post-move
   failure, report exact native state; do not apply compensating item writes
   without a reviewed transactional recovery contract.
4. For `dockSession` and `undockSession`, bracket native state mutation with
   `begin` / `handoff` / `finish` using native location IDs. Station-jump
   and clone-bay transitions need explicit extra design, not a silently
   remapped generic stargate wrapper.
5. Cancel the ticket only on confirmed pre-mutation failure, logout or
   an independently verified rollback. Never call `finish` merely because
   an RPC returned success: require actual native scene membership and cargo.
6. Run overlay dry-run / apply / remove / roundtrip against pinned EveJS,
   confirm all old hooks remain, and test with two independent authorized
   clients on the same and different solar systems. An accepted warp order
   or a TCP socket is NOT an arrival result.

Chat 23 owns wormhole admission and transitions; expose only common
`begin/handoff/finish` contracts where appropriate, not a second wormhole
routing engine. Chat 05 owns fleet commands and fleet-warp followers; this
module never moves a fleet or changes member roles. Chat 03 owns native
session lifetime; Chat 04 owns physical scene lifecycle.

## Test and acceptance evidence

Local standalone test:

```
node --test tests/coop-player-travel-guard.test.mjs
```

47/47 isolated Node tests PASS. Includes concurrent independent pilots,
reciprocal jumps, failed destination and duplicate scenes, owner mismatch,
interrupted session/ship replacement, disconnected client and reconnect,
expired tickets without replay, station docking and allowed capacitor/shield
recharge, undocking, native solar jumps, lost or nested cargo, changed HP,
changed module metadata, active warp rejection, static gate topology,
physical destination spawn point mismatches, native scene failures and
ephemeral state following process restart. These are fixture-based; they do not invoke
pinned EveJS at runtime. No installed overlay dry-run, Docker reboot, live
client, real NPC stargate transition or live two-player round trip has been
run in this environment. Syntax checks pass on Node v22.16.0.

Tests were executed against injected native-shaped fixtures only; these are
not pinned EveJS integration tests. Stargate player-facing behavior stays
blocked until Chat 01 installs the guarded single-call native hooks and the
local host completes the manual native integration checks.

Acceptance still required: genuine two-client round trip A->B->A with
original `characterID`, `shipID`, fitting item IDs, cargo quantities,
shield/armor/structure state, station transitions, active sessions and
visible arrival. Then intentionally interrupt a legitimate transition,
disconnect and reconnect one client while the second keeps playing,
and perform an authorized restart without deleting any persistent volume.

Status remains `CODE_READY / LIVE_UNVERIFIED / BLOCKED_INTEGRATION_CHAT_01`.
This isolated module, regression suite and contract may be published to the
repository without installing native hooks. Chat 01 must separately approve and
perform central runtime wiring and native/live verification before the feature
is enabled. Publishing these files is not gameplay acceptance.
