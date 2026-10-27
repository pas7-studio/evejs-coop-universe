import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const bridge=require('../integration/coopAdminBridge.cjs');

test('deploy_structure is an allowed admin action',()=>{
 assert.equal(bridge.ALLOWED_ACTIONS.has('deploy_structure'),true);
});

test('deploy_structure does not require a characterID',()=>{
 const result=bridge.executeRequest({action:'deploy_structure',systemID:30000144,typeID:35832,
  factionID:'500014',ownerCorpID:1000043,position:{x:1,y:2,z:3},name:'X'});
 // It reaches the factory, which refuses the non-numeric faction; it is never
 // rejected for the missing character that a structure does not have.
 assert.equal(result.ok,false);
 assert.notEqual(result.error,'characterID is required');
 assert.equal(result.status,'REFUSED');
 assert.equal(result.error,'INVALID_FACTION');
});

test('an unknown action is still refused',()=>{
 const result=bridge.executeRequest({action:'deploy_anything',characterID:1});
 assert.equal(result.ok,false);
 assert.match(result.error,/action not allowed/);
});

test('a structure request without a name is refused by the factory, not written',()=>{
 const result=bridge.executeRequest({action:'deploy_structure',systemID:30000144,typeID:35832,
  factionID:500014,ownerCorpID:1000043,position:{x:1,y:2,z:3},name:''});
 assert.equal(result.ok,false);
 assert.equal(result.status,'REFUSED');
 assert.equal(result.error,'NAME_REQUIRED');
});

test('spawn_native_npc validates its inputs before touching native code',()=>{
 assert.equal(bridge.ALLOWED_ACTIONS.has('spawn_native_npc'),true);
 const noSystem=bridge.executeRequest({action:'spawn_native_npc',profileQuery:'angel_raider'});
 assert.equal(noSystem.ok,false);
 assert.equal(noSystem.error,'systemID is required');
 const noProfile=bridge.executeRequest({action:'spawn_native_npc',systemID:30000142});
 assert.equal(noProfile.ok,false);
 assert.equal(noProfile.error,'profileQuery is required');
 // A repo without the EveJS tree must refuse, never pretend a ship exists.
 const offline=bridge.executeRequest({action:'spawn_native_npc',systemID:30000142,profileQuery:'angel_raider'});
 assert.equal(offline.ok,false);
 assert.match(offline.error,/native spawn dependencies unavailable/);
});

test('inspect_npc is a read-only action that validates its input',()=>{
 assert.equal(bridge.ALLOWED_ACTIONS.has('inspect_npc'),true);
 const none=bridge.executeRequest({action:'inspect_npc'});
 assert.equal(none.ok,false);
 assert.equal(none.error,'entityID is required');
 const offline=bridge.executeRequest({action:'inspect_npc',entityID:980000000113});
 assert.equal(offline.ok,false);
 assert.match(offline.error,/inspect failed/);      // no EveJS tree in the repo
});
