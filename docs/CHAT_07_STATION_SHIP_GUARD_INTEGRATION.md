# Chat 07 — Station and ship services, native integration contract

Status: **CODE_READY / LIVE_UNVERIFIED**, **module and tests staged for main**. The Chat 01-owned installer/native anchor changes have not been made. This is not proof that station gameplay works.

Source review: EveJS pinned `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f` as checked using the GitHub connector on 2026-10-25. Project starting HEAD `44d0a650b52c0da21e8ba779faca750cb635ec1b`.

## Confirmed defects in pinned upstream

1. `Code/server/src/services/character/characterState.js`, `activateShipForSession()` (~4227): checks `isDockedSession`, `findCharacterShip` (global owner scope), then `setActiveShipForCharacter`. Neither function checks that target hull is actually in the pilot's current station/structure and `ITEM_FLAGS.HANGAR` nor that it is assembled. Thus pilot A can activate an owned ship at station B while docked at A. `getCharacterShipItems` returns all owner ships; `itemStore.setActiveShipForCharacter` only checks ownership. This can confuse the active ship/hangar/undock session state.
2. `Code/server/src/services/ship/shipService.js`, `Handle_Undock` (~1469): accepts `args[0]` shipID, runs `_syncRequestedOnlineModulesForUndock(session, shipID, kwargs)` (writes item moduleState), then `undockSession(session)` which instead reads `getActiveShipRecord(session.characterID)`. There is no requested-active comparison before the first write. An owned remote ship can have module states touched while the wrong actual hull undocks.
3. `Code/server/src/space/transitions.js`, `dockSession()` (~2096): sends preliminary session and world effects and detaches the session before `dockShipToLocation` and `updateCharacterRecord`, and returns from any failed write without a transactional rollback. The attached guard checks a native scene and physical hull *before* these effects, but does not make a multi-table dock transaction atomic. Failures after detach remain a **BLOCKED** persistence issue requiring upstream transaction/recovery design.
4. `Code/server/src/services/station/repairRuntime.js`, `executeRepairPlan()` (~889-1018): debits the character wallet before `syncRepairPlanToItems` (~816) which skips missing/failed item writes and still proceeds. A failure may charge without repairing; a crash between writes has no atomic wallet/item guarantee. The proposed ship guard does **not** solve repair fee atomicity. Do not enable a purported repair fix without durable native transaction/reconciliation tests.

## This isolated module

`integration/coopStationShipGuard.cjs` exports `createStationShipGuard(deps)` and three lazy native wrappers, `assertDockedActivation`, `assertUndock`, `assertDock`. All wrappers are inert unless `EVEJS_COOP_STATION_SHIP_GUARD=1` (default OFF), and they call native `throwWrappedUserError('CustomNotify')` to refuse unsafe requests. They read native, authoritative `peekCharacterRecord`, `findCharacterShip`, `getActiveShipRecord`, `findItemById`, `spaceRuntime.getSceneForSession` and `spaceRuntime.getEntity`. **No** copied ship model, fake inventory, monetary debit, bypass, timer, retry or mutation.

The checks enforce native character + session location consistency, unique owner/type/ItemStore snapshot, station-local assembled hull, exact active and client requested ID on undock, physical ship + solarSystem + scene session on dock, and no duplicate ship claimant on that grid. These checks are a *precondition*, not a substitute for native transitions.

## Required Chat 01 central integration (not done by Chat 07)

1. Add `coopStationShipGuard.cjs` to the existing installer L2 module deploy list (installed as `Code/server/src/space/coopStationShipGuard.js`, same content). Do not add a parallel installer.
2. Add one line in pinned `Code/server/src/services/character/characterState.js`, `activateShipForSession()`, **after** `if (!targetShip) ...` and **before** `const updateResult = setActiveShipForCharacter(charId, targetShip.itemID);`:

   ```js
   require('../../space/coopStationShipGuard').assertDockedActivation(session, targetShip.itemID);
   ```

3. Add one line in `Code/server/src/services/ship/shipService.js` under `Handle_Undock`, immediately **before** `this._syncRequestedOnlineModulesForUndock(session, shipID, kwargs);`:

   ```js
   require('../../space/coopStationShipGuard').assertUndock(session, shipID);
   ```

4. Add one line in `Code/server/src/space/transitions.js` under `dockSession`, after native `activeShip` and `dockable` have been validated, but **before** `beginTransition(session, 'dock', targetStationID)` and any detach, ship mutation or session notification:

   ```js
   require('./coopStationShipGuard').assertDock(session, targetStationID, dockable);
   ```

5. All three patch anchors must be unique for pinned SHA, EOL-agnostic, dry-run/applied/removed byte-identical, feature flag default-OFF. Do not duplicate wrapper registration or touch ship/character runtime implementations in Chat 07. Preserve every other current native hook.
6. Integration gate: `node --test tests/coop-station-ship-guard.test.mjs`; `node scripts/patch-evejs-coop.cjs --code-path <separate pinned upstream>/Code --dry-run`; `node --test tests/coop-crossstream-overlay-roundtrip.test.mjs` with `EVEJS_COOP_CODE_PATH`; full local suite; restart/reconnect and two native authenticated clients. `OVERLAY_OK` and two-client evidence are separate gates.

Note: Native `spaceRuntime` methods need their correct `this` binding. The module binds through arrow functions; `scene.sessions` is a `Map` in pinned EveJS, so use its `.values()` (not Map entries).

## Live acceptance matrix — NOT RUN

- Two pilots dock same station concurrently; each sees only own ships/items and can change active ship without changing other pilot's state.
- Pilot A attempts `Board`/`ActivateShip` with B's shipID, and A's ship in a remote station; both rejected with no item mutation.
- Dock/undock with correct active IDs and session/character/ItemStore records, both ships remain independent; do sequential and parallel operations.
- Reconnect both clients separately; relog; stale station alias, stale `_space`, duplicate ship claim; scene and native records survive without cross-account data.
- Eject, space boarding, station boarding, leave-ship capsule; confirm real cargo, fitting, HP, repaired item condition, items in hangar.
- Native repair quote, insufficient ISK, repeated repair RPC, failed item save, partial module/ship repair, process-crash between wallet debit and item write; balance and item state must be conserved before repair can claim PASS.
- Ship destroyed in space followed by clone/resurrection, new capsule; no vanished old ship or accidental default-station reinstatement.
- Restart with disposable DB backup; verify persistent inventory, repair, ship and wallet with no item duplication.

**No central hooks implemented**, no deployed runtime, no gameplay proof until Chat 01 integration and these necessary live/persistence gates complete. Do not mark DONE from isolated tests.

## Publication note

This changeset intentionally stages the isolated guard and tests in the repository without patching the shared installer, central hooks, database, persistence volumes, or deployment configuration. The guard remains feature OFF and is not deployed until Chat 01 wires it through the canonical patch installer. No server-side gameplay PASS is claimed by isolated or source-contract tests.
