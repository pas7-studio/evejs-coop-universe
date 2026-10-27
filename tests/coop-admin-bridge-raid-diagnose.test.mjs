import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const bridge=require('../integration/coopAdminBridge.cjs');

test('raid_diagnose is an allowed read-only admin action',()=>{
 assert.equal(bridge.ALLOWED_ACTIONS.has('raid_diagnose'),true);
});

test('raid_diagnose refuses without a system instead of guessing one',()=>{
 const result=bridge.executeRequest({action:'raid_diagnose'});
 assert.equal(result.ok,false);
 assert.equal(result.error,'systemID is required');
});

test('raid_diagnose reports a missing scene instead of inventing pirates',()=>{
 const result=bridge.executeRequest({action:'raid_diagnose',systemID:1});
 assert.equal(result.ok,true);
 assert.equal(result.systemID,1);
 assert.equal(result.status,'SCENE_MISSING');
});

test('the runtime exports the raid diagnose it hands to the bridge',()=>{
 const runtime=require('../integration/coopVirtualWorldRuntime.cjs');
 assert.equal(typeof runtime.diagnoseNativeRaids,'function');
 assert.deepEqual(runtime.diagnoseNativeRaids({}),{status:'SYSTEM_ID_REQUIRED'});
});
