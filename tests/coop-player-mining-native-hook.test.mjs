import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {patch,HOOK,TARGET}=require('../scripts/coop-player-mining-shift-native-patch.cjs');
const fixture=['function tickMiningFleet(scene, fleetRecord, now, hooks) {',
 '  if (!scene || !fleetRecord || !hooks) {','    return;','  }','',
 '  const thinkIntervalMs = Math.max(','    250,','    1000,','  );',
 '  if (fleetRecord.state === "hauling") {','    return;','  }','}',
 'function tickScene(scene, now, hooks = {}) {','}'].join('\n');
test('native hook injects exactly one guarded opt-in call at original think boundary',()=>{
 const s=patch(fixture,TARGET,false);
 assert.equal(s.split(HOOK).length-1,1);
 assert.ok(s.indexOf(HOOK)<s.indexOf('  if (fleetRecord.state === "hauling")'));
 assert.match(s,/process\.env\.EVEJS_COOP_PLAYER_NPC_MINING_COMPANY === "1"/);
});
test('native hook is LF/CRLF reversible and install is idempotent',()=>{
 for(const s of [fixture,fixture.replaceAll('\n','\r\n')]){
  const first=patch(s,TARGET,false);
  assert.equal(patch(first,TARGET,false),first);
  assert.equal(patch(first,TARGET,true),s);
  assert.equal(patch(s,TARGET,true),s);
 }
});
test('native hook rejects ambiguous or drifted stock anchors',()=>{
 assert.throws(()=>patch(fixture+'\n'+fixture,TARGET,false),/AMBIGUOUS/);
 assert.throws(()=>patch(fixture.replace('  if (fleetRecord.state === "hauling") {',
  '  if (fleetRecord.state === "haul_alt") {'),TARGET,false),/MISSING/);
 assert.throws(()=>patch(fixture,'server/src/space/other.js'),/UNSUPPORTED/);
});
