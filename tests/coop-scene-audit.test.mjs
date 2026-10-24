import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditCoopScene } from '../scripts/coop-scene-audit.mjs';
const mk=(c,ch,s,see=[])=>({clientID:c,characterID:ch,socket:{destroyed:false},_space:{shipID:s,initialStateSent:true,visibleDynamicEntityIDs:new Set(see)}});
function fixture(){
  const a=mk(101,1001,8001,[8002]),b=mk(102,1002,8002,[8001]);
  const scene={systemID:30000142,sessions:new Map([[101,a],[102,b]]),dynamicEntities:new Map([[8001,{itemID:8001,kind:'ship'}],[8002,{itemID:8002,kind:'ship'}]])};
  return {a,b,scene};
}
test('two distinct pilots and two ships with mutual visibility pass',()=>{
  const {a,b,scene}=fixture();const result=auditCoopScene(scene,{registryLookup:id=>id===1001?a:b});
  assert.equal(result.status,'PASS');assert.equal(result.livePilotCount,2);assert.equal(result.visibility.length,1);
});
test('duplicate ship and character are rejected',()=>{
  const {b,scene}=fixture();b._space.shipID=8001;b.characterID=1001;
  const r=auditCoopScene(scene);assert.equal(r.status,'FAIL');
  assert.ok(r.findings.some(f=>f.code==='DUPLICATE_SHIP'));
  assert.ok(r.findings.some(f=>f.code==='DUPLICATE_CHARACTER'));
});
test('stale session fails; reconnect after cleanup passes',()=>{
  const {a,b,scene}=fixture();a.socket.destroyed=true;
  assert.ok(auditCoopScene(scene).findings.some(f=>f.code==='STALE_SESSION'));
  scene.sessions.delete(101);
  const replacement=mk(103,1001,8001,[8002]);scene.sessions.set(103,replacement);
  assert.equal(auditCoopScene(scene,{registryLookup:id=>id===1001?replacement:b}).status,'PASS');
});
test('asymmetric visibility warns but does not claim corruption',()=>{
  const {b,scene}=fixture();b._space.visibleDynamicEntityIDs.clear();
  const r=auditCoopScene(scene);assert.equal(r.status,'PASS');
  assert.ok(r.findings.some(f=>f.code==='ASYMMETRIC_VISIBILITY'&&f.level==='WARNING'));
});
test('missing ship and registry mismatch fail',()=>{
  const {scene}=fixture();scene.dynamicEntities.delete(8002);
  const r=auditCoopScene(scene,{registryLookup:()=>null});assert.equal(r.status,'FAIL');
  assert.ok(r.findings.some(f=>f.code==='MISSING_SHIP'));
  assert.ok(r.findings.some(f=>f.code==='REGISTRY_MISMATCH'));
});
test('invalid scene and pilot count are rejected',()=>{
  assert.throws(()=>auditCoopScene({sessions:[],dynamicEntities:new Map()}),/Maps/);
  assert.throws(()=>auditCoopScene(fixture().scene,{minimumPilots:0}),/minimumPilots/);
});
