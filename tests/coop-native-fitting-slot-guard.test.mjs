import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {getSlotFlagsForFamily:slots}=require('../integration/coopNativeFittingSlotGuard.cjs');
const families={low:[11,12,13,14,15,16,17,18],med:[19,20,21,22,23,24,25,26],high:[27,28,29,30,31,32,33,34],rig:[92,93,94,95,96,97,98,99],subsystem:[125,126,127,128,129,130,131,132],service:[164,165,166,167,168,169,170,171]};
function run(family,limit,extra={}){return slots({family,shipTypeID:587,baseFlags:families[family],slotCounts:{[family]:limit},...extra});}
for(const family of Object.keys(families)){
 test(`${family}: zero native slots means no allowed flags`,()=>assert.deepEqual(run(family,0),[]));
 test(`${family}: correct allowed slot prefix and max capacity`,()=>{
  assert.deepEqual(run(family,1),families[family].slice(0,1));
  assert.deepEqual(run(family,4),families[family].slice(0,4));
  assert.deepEqual(run(family,8),families[family]);
 });
}
test('missing, negative, fractional, oversized or malformed counts fail closed',()=>{
 for(const count of [undefined,null,-1,1.5,9,'8',NaN,Infinity])
  assert.deepEqual(run('rig',count),[]);
});
test('unknown family or altered static slot table cannot add slots',()=>{
 assert.deepEqual(slots({family:'fighter',shipTypeID:587,baseFlags:[159],slotCounts:{fighter:1}}),[]);
 assert.deepEqual(run('rig',2,{baseFlags:[92,93,100]}),[]);
});
test('generic family lookup remains available to existing callers',()=>{
 assert.deepEqual(slots({family:'low',shipTypeID:null,baseFlags:families.low}),families.low);
});
test('two ships with independent slot counts cannot contaminate each other',()=>{
 const shipA=run('high',2),shipB=run('high',6);
 shipA.push(999);
 assert.deepEqual(run('high',2),[27,28]);
 assert.deepEqual(shipB,[27,28,29,30,31,32]);
});
