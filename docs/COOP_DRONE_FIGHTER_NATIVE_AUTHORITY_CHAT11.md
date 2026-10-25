# Chat 11: native drone/fighter custody and client acceptance

**Status:** CODE_READY / LIVE_UNVERIFIED; installation requires Chat 01.
**Pinned upstream:** gameboys84/EveJS `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f` (EVE 24.01 client target build 3396210). The server repository does not include a legal EVE client implementation, so fighter UI cannot be claimed verified.

## Native ownership / behavior audit

- `services/drone/entityService.js` handles CmdEngage, CmdMineRepeatedly, CmdSalvage, CmdReturnBay, CmdReturnHome, CmdAbandonDrone and CmdReconnectToDrones. Drone launch belongs to `droneRuntime.launchDronesForSession`, reached by inventory/ship services. `droneRuntime.tickScene` owns combat, support repair, mining, salvage, return, and cleanup. Bandwidth uses ship-side attribute 1271 and per-drone 1272; max drones attribute 352.
- `services/fighter/fighterMgrService.js` handles GetFightersForShip, tube load/unload, LaunchFightersFromTubes, RecallFightersToTubes, movement commands, ability activation/deactivation, abandonment and scoop. `fighterRuntime` owns actual fighters, Dogma effects and damage cycles; `fighterAbilities` loads GameStore `fighterAbilities/authority.json`. NPC supercarrier director uses native inventory-backed fighters.
- `space/npc/npcBehaviorLoop.js` classifies drones as possible threats and has behavior-configured drone signature filtering. Its reaction must be tested with actual player drones/fighters and real NPC orders, not inferred from one code path.
- Both `droneRuntime.getShipStateForSession` and `fighterRuntime.getShipStateForSession` select the character's active ship and call `ensureScene` but do not themselves verify the connected session is its one Ballpark-ready authoritative owner. This is a SOURCE risk: not a reproduced live exploit.
- Native damage builds `buildDroneCombatSourceEntity` or `buildFighterCombatSourceEntity`; the killmail tracker consumes explicit attacker identity. Do not infer drone/fighter player damage in the existing direct-ship-only `coopPlayerCombatWitness`.
- Drone launch moves an item from bay to system before finalizing spaceState and physical spawn; failure may leave a partially launched item. Fighter launch has a rollback on failures after state update; fighter land/scoop removes scene entity before committing inventory transfer. Native NPC supercarrier grants a new item before its move/state/spawn and may leave an orphan on failure. These resource transitions require native idempotent custody/recovery; the admission guard does NOT fix them.

## Delivered isolated code

`integration/coopDroneFighterAuthority.cjs` exports `admitPilot`, `admitCraft`, `admitNativeLaunch`, and `witnessAppliedDamage`. It is read-only, fail closed and references native session/scene/inventory objects. It prevents false attribution or authorizing a second character's ship/controlled craft. No own drone, fighter, NPC, inventory, reward or Dogma system is created. Structure/corporation fighter control is intentionally NOT admitted by the conservative player-ship policy until role-based authorization is separately proven.

`scripts/coop-drone-fighter-authority-patch.cjs` contains an isolated, EOL-preserving, idempotent, reversible source transform for *each* of the two existing `getShipStateForSession` functions. It adds one guarded statement with `EVEJS_COOP_DRONE_FIGHTER_AUTHORITY=1`, OFF by default, and does not modify upstream files or the central installer. The transform and regression tests are ready for Chat 01 to incorporate.

## Exact handoff to Chat 01

1. Use ONLY `scripts/patch-evejs-coop.cjs` to call `patch(source, {remove})` from `scripts/coop-drone-fighter-authority-patch.cjs` for **both** pinned `server/src/services/drone/droneRuntime.js` and `server/src/services/fighter/fighterRuntime.js`. Do not edit stock sources manually. Validate the existing spec uniqueness and a complete overlay rollback. Do not add a second patching entrypoint.
2. Register `integration/coopDroneFighterAuthority.cjs` in the existing installer copy list as `server/src/space/coopDroneFighterAuthority.js` (the extensionless `require` in the hook resolves `.js`). Keep the flag **OFF** until actual in-client QA and source-owned custody checks pass.
3. The one-line hook only fences `getShipStateForSession`. It does NOT yet protect individual craft IDs inside native RPC loops; `admitCraft` and `admitNativeLaunch` can be wired at their concrete source entrypoints after checking the native data shape and return contracts, without mutating Dogma or bypassing native policy. `witnessAppliedDamage` needs an explicit post-application native hook for exactly positive applied damage, not inferred combat/log events.
4. A separate native transaction repair must use the original inventory item and GameStore transaction outcome, not optimistic `spawn` retries. Required cases: after move, after update, after physical spawn, failed remove, failed item update, crash between stages, replay/restart; unresolved writes must halt/raise operator repair, not grant a second drone/fighter. Do not enable fighter or NPC wing launch safety changes merely because this admission guard passes.

## Verification

Run in repository checkout:

`node --test tests/coop-drone-fighter-authority.test.mjs tests/coop-drone-fighter-authority-patch.test.mjs`

Local Node 22: 13/13 focused synthetic tests PASS; JS syntax PASS. Independent GitHub source inspection confirmed native admission anchors unique on both upstream files and insertion/removal string roundtrip at exact pin. **NOT RUN:** source transform through exact local pinned checkout, real EveJS dependencies/GameStore, deployed native hook, Docker, actual EVE fighter UI, two connected clients, shared drone visibility, NPC reaction, combat kill attribution, loss persistence/reconnect/crash. These cannot be marked done or as gameplay PASS.

## Two-client manual acceptance

On isolated owner-authorized host: both authentic characters undock separate actual ships into one grid; each launches and commands drones independently, both see same physical ID and native damage/effects; check remote repair, hostile NPC target choice, ammo/health and source-owned loot. Separate-grid/warp/reconnect changes must not duplicate craft or swap controllerID. Test bandwidth and maxActiveDrones on limited hulls and failed requests. For fighters, confirm native tube UI, squadron controls/ability charge and cooldown, actual orbit/attack/recall, destruction, scoop ownership and after-relog tube contents. Capture native itemID, ownerID, locationID, tubeFlagID, controllerID and exact applied damage. Repeat after restart and partial inventory/spawn failures on disposable data. Status stays LIVE_UNVERIFIED until these run.
