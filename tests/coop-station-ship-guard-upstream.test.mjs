import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const code=process.env.EVEJS_COOP_CODE_PATH;
const files=[
 ['services/character/characterState.js', 'function activateShipForSession', 'setActiveShipForCharacter(charId, targetShip.itemID)'],
 ['services/ship/shipService.js', 'Handle_Undock(args, session, kwargs)', 'this._syncRequestedOnlineModulesForUndock(session, shipID, kwargs)'],
 ['space/transitions.js', 'function dockSession(session, stationID)', 'dockShipToLocation(activeShip.itemID, dockable.locationID)'],
 ['services/station/repairRuntime.js', 'function executeRepairPlan', 'const changes = syncRepairPlanToItems(repairPlan)'],
];
for(const [f, anchor, operation] of files){
 test(`pinned station source contains expected ${f} contract`,{skip:!code&&'Pinned upstream checkout unavailable'},()=>{
  const source=fs.readFileSync(path.join(code,'server/src',f),'utf8');
  assert.equal(source.split(anchor).length-1,1,`Source anchor mismatch: ${anchor}`);
  assert.equal(source.split(operation).length-1,1,`Source contract drift: ${operation}`);
 });
}
