import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createPatrolDirector}=require('../integration/coopFactionPatrolRuntime.cjs');
const faction={faction:'frontier',systemID:30000142,patrolPriority:75,readiness:3};
test('patrol spawns through native API, caps live ships, reuses after second login',()=>{
 let now=1000000,next=4000,spawns=0;const live=new Set();
 const director=createPatrolDirector({clock:()=>now,maxPerSystem:1,cooldownMs:60000,
  exists:(_system,id)=>live.has(id),
  spawn:()=>{const id=++next;live.add(id);spawns++;return {success:true,data:{spawned:[{entity:{itemID:id}}]}};}});
 assert.equal(director.reconcile(30000142,[faction]).status,'SPAWNED');
 assert.equal(director.reconcile(30000142,[faction]).status,'AT_CAP');
 assert.equal(spawns,1);
 live.delete(4001);
 assert.equal(director.reconcile(30000142,[faction]).status,'COOLDOWN');
 now+=60000;
 assert.equal(director.reconcile(30000142,[faction]).status,'SPAWNED');
 assert.equal(spawns,2);
});
test('safe without faction demand, disallowed readiness, bad scene ID',()=>{
 const d=createPatrolDirector({spawn:()=>{throw Error('should not spawn');},exists:()=>false});
 assert.equal(d.reconcile(30000142,[{...faction,readiness:0}]).status,'NO_DEMAND');
 assert.equal(d.reconcile(0,[faction]).status,'INVALID_SYSTEM');
});
