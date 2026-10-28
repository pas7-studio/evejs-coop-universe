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

test('a patrol that cannot deploy says why, per faction',()=>{
 // Measured live: "virtual-faction-patrol FAILED" every two minutes in 30045343/30045344
 // with no reason, while the materializer in the same tick reported SPAWN_LIMIT_REACHED
 // (occupied 3, limit 3). A failed deployment must name its cause.
 const director=createPatrolDirector({
  spawn:()=>({success:false,errorMsg:'SPAWN_LIMIT_REACHED'}),
  exists:()=>false,clock:()=>1000000,
 });
 const result=director.reconcile(30045343,[
  {faction:500001,systemID:30045343,patrolPriority:50,readiness:2},
 ]);
 assert.equal(result.status,'FAILED');
 assert.equal(result.reason,'SPAWN_LIMIT_REACHED');
 assert.deepEqual(result.failures,[{faction:500001,reason:'SPAWN_LIMIT_REACHED'}]);
});

test('a partly successful deployment keeps the failures next to the spawned ships',()=>{
 let calls=0;
 const director=createPatrolDirector({
  spawn:()=>{
   calls+=1;
   return calls===1
    ? {success:true,data:{spawned:[{entity:{itemID:4242}}]}}
    : {success:false,errorMsg:'SPAWN_LIMIT_REACHED'};
  },
  exists:()=>true,clock:()=>1000000,maxPerSystem:2,
 });
 const result=director.reconcile(30045343,[
  {faction:500001,systemID:30045343,patrolPriority:50,readiness:2},
  {faction:500004,systemID:30045343,patrolPriority:40,readiness:2},
 ]);
 assert.equal(result.status,'SPAWNED');
 assert.equal(result.spawned.length,1);
 assert.equal(result.reason,undefined,'a successful deployment carries no reason');
 assert.deepEqual(result.failures,[{faction:500004,reason:'SPAWN_LIMIT_REACHED'}]);
});
