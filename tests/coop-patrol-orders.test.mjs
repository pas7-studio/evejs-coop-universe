import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createPatrolOrders}=require('../integration/coopPatrolOrders.cjs');
test('native patrol orbits existing target once within cooldown',()=>{
 let now=100000,calls=0;
 const d=createPatrolOrders({clock:()=>now,cooldownMs:120000,
  exists:()=>true,orbit:(id,target,range)=>{calls++;assert.equal(id,11);assert.equal(target,99);assert.equal(range,10000);return {success:true};}});
 assert.deepEqual(d.assign(30000142,[11],99).issued,[11]);
 assert.deepEqual(d.assign(30000142,[11],99).issued,[]);
 now+=120000;
 assert.deepEqual(d.assign(30000142,[11],99).issued,[11]);
 assert.equal(calls,2);
});
test('invalid anchor and dead NPC never issue order',()=>{
 const d=createPatrolOrders({exists:()=>false,orbit:()=>{throw Error('must not call');}});
 assert.equal(d.assign(30000142,[11],0).status,'NO_ANCHOR');
 assert.equal(d.assign(30000142,[11],99).status,'UNCHANGED');
});
