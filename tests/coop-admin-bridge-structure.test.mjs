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
