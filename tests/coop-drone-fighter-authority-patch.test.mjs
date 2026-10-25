import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {patch,HOOK}=require('../scripts/coop-drone-fighter-authority-patch.cjs');
const fixture=`const path = require('path');
function getShipStateForSession(session) {
  const characterID = toInt(session && (session.characterID || session.charid), 0);
  const shipRecord = resolveActiveShipRecord(characterID);
  const scene = getRuntime().ensureScene(session._space.systemID);
  const shipEntity = scene.getEntityByID(shipRecord.itemID);
  if (!shipRecord || !scene || !shipEntity) {
    return null;
  }
  return {
    characterID,
    shipRecord,
    shipEntity,
    scene,
  };
}
`;
test('one reversible, default-OFF hook in original native admission path',()=>{
 const p=patch(fixture);
 assert.ok(p.includes(HOOK));assert.equal(p.split(HOOK).length,2);
 assert.equal(patch(p),p);
 assert.equal(patch(p,{remove:true}),fixture);
 assert.equal(patch(fixture,{remove:true}),fixture);
 assert.match(p,/process\.env\.EVEJS_COOP_DRONE_FIGHTER_AUTHORITY === "1"/);
});
test('pinned source helper is byte-identical across CRLF and LF roundtrips',()=>{
 for(const eol of ['\n','\r\n']){
   const src=fixture.replace(/\n/g,eol);
   const p=patch(src);
   assert.equal(patch(p),p);
   assert.equal(patch(p,{remove:true}),src);
 }
});
test('unrecognized and ambiguous native anchors are rejected, not silently patched',()=>{
 assert.throws(()=>patch('function noOtherFn() {}'),/UNSUPPORTED/);
 assert.throws(()=>patch(fixture+fixture),/NON_UNIQUE/);
 assert.throws(()=>patch('function getShipStateForSession(session) { return {}; }'),/NON_UNIQUE/);
});
