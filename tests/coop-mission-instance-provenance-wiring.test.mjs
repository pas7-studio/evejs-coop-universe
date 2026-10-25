import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const paths=[
 'integration/coopFleetMissionJoin.cjs',
 'integration/coopFleetDungeonCredit.cjs',
 'integration/coopFleetMissionTurnin.cjs'
];
const safe=(name)=>fs.existsSync(path.join(root,name))?
 fs.readFileSync(path.join(root,name),'utf8'):null;
test('join, objective and settlement use the identical opt-in native instance link flag',t=>{
 const loaded=paths.map(safe);if(loaded.some(x=>x===null)){
  t.skip('Requires repository checkout containing the current integration files');return;
 }
 for(const [i,src] of loaded.entries()){
  assert.match(src,/EVEJS_COOP_MISSION_INSTANCE_LINK==="1"/,paths[i]);
  assert.match(src,/\.\/coopMissionInstanceProvenance/,paths[i]);
 }
 assert.match(loaded[0],/\.record\(/);
 assert.match(loaded[1],/\.verify\(/);
 assert.match(loaded[2],/\.verify\(/);
 assert.match(loaded[2],/nativeSharedObjectiveMatches/);
});
test('new link file is the only writer: no new synthetic wallet/LP/item state',()=>{
 const src=fs.readFileSync(path.resolve(import.meta.dirname,'../integration/coopMissionInstanceProvenance.cjs'),'utf8');
 assert.doesNotMatch(src,/adjustCharacterBalance|addLoyaltyPoints|grantItemsToCharacterStationHangar|setMissionObjectiveCompleted|gmComplete\(/);
 assert.match(src,/fs\.fsyncSync\(fd\)/);
 assert.match(src,/fs\.fsyncSync\(dirfd\)/);
});
