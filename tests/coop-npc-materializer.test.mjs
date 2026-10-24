import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createBridge}=require('../integration/coopNpcMaterializer.cjs');
test('same persistent pilot maps to same live native NPC, no duplicate spawn',()=>{
 let next=100,spawns=0;
 const live=new Set();
 const bridge=createBridge({limit:2,exists:(_sys,id)=>live.has(id),spawn:()=>{const id=++next;live.add(id);spawns++;return {success:true,data:{spawned:[{entity:{itemID:id}}]}};}});
 const pilots=[{id:'pilot-a'},{id:'pilot-b'},{id:'pilot-c'}];
 assert.equal(bridge.reconcile(30000142,pilots).filter(x=>x.entityID).length,2);
 assert.equal(spawns,2);
 bridge.reconcile(30000142,pilots);
 assert.equal(spawns,2);
 assert.equal(bridge.snapshot().length,2);
 live.delete(101);
 bridge.reconcile(30000142,pilots);
 assert.equal(spawns,3);
 assert.equal(bridge.snapshot().length,2);
});
test('failed native spawn is not assigned to a virtual identity',()=>{
 const b=createBridge({spawn:()=>({success:false,errorMsg:'NO_POOL'}),exists:()=>false});
 assert.equal(b.reconcile(30000142,[{id:'p1'}])[0].error,'NO_POOL');
 assert.deepEqual(b.snapshot(),[]);
});
test('invalid bridge limits are rejected',()=>assert.throws(()=>createBridge({spawn:()=>{},exists:()=>true,limit:11}),/limit/));

test("two real mining NPC identities do not consume two co-op pirate spawn slots",()=>{
 const live=new Set([101,102]);
 const links={
  "coop-pilot-001":{pilotID:"coop-pilot-001",entityID:101,systemID:30000142,role:"miner"},
  "coop-pilot-002":{pilotID:"coop-pilot-002",entityID:102,systemID:30000142,role:"hauler"}
 };
 const registry={
  prune:()=>0,
  get:id=>links[id]&&live.has(links[id].entityID)?links[id]:null,
  snapshot:()=>({links}),
  link:(pilot,systemID,entityID)=>links[pilot.id]={pilotID:pilot.id,systemID,entityID,role:pilot.role}
 };
 let next=102;
 const bridge=createBridge({limit:2,registry,exemptRoles:["miner","hauler"],
  exists:(_s,id)=>live.has(id),
  spawn:()=>{const id=++next;live.add(id);return {success:true,data:{spawned:[{entity:{itemID:id}}]}}}
 });
 const row=bridge.reconcile(30000142,[
  {id:"coop-pilot-005",role:"pirate"},
  {id:"coop-pilot-003",role:"patrol"},
  {id:"coop-pilot-008",role:"trader"}
 ],{exemptEntityIDs:[101,102]});
 assert.equal(row.filter(x=>x.entityID).length,2);
 assert.equal(bridge.snapshot().length,2);
 assert.deepEqual(bridge.snapshot().map(x=>x.pilotID),["coop-pilot-005","coop-pilot-003"]);
 bridge.reconcile(30000142,[{id:"coop-pilot-005",role:"pirate"},{id:"coop-pilot-003",role:"patrol"}]);
 assert.equal(next,104);
});
test("saved miner role alone never exempts a ship absent from a real EveJS fleet",()=>{
 const links={
  a:{pilotID:"a",role:"miner",entityID:101,systemID:30000142},
  b:{pilotID:"b",role:"hauler",entityID:102,systemID:30000142}
 };
 const registry={prune:()=>0,snapshot:()=>({links}),get:()=>null,
  link:(pilot,systemID,entityID)=>links[pilot.id]={pilotID:pilot.id,systemID,entityID,role:pilot.role}};
 let spawned=0;
 const bridge=createBridge({limit:2,registry,exemptRoles:["miner","hauler"],
  exists:(_s,id)=>[101,102].includes(id),
  spawn:()=>{spawned++;return {success:true,data:{spawned:[{entity:{itemID:200}}]}}}});
 const noFleet=bridge.reconcile(30000142,[{id:"pirate",role:"pirate"}]);
 assert.equal(spawned,0);
 assert.deepEqual(noFleet,[]);
 const oneStockShip=bridge.reconcile(30000142,[{id:"pirate",role:"pirate"}],
  {exemptEntityIDs:[101]});
 assert.equal(spawned,1);
 assert.equal(oneStockShip[0].entityID,200);
});
test("a co-op-spawned legacy miner with the same role is not exempt even with native mining enabled",()=>{
 const links={
  a:{pilotID:"a",role:"miner",entityID:101,systemID:30000142},
  b:{pilotID:"b",role:"hauler",entityID:102,systemID:30000142}
 };
 const bridge=createBridge({limit:2,exemptRoles:["miner","hauler"],
  registry:{prune:()=>0,snapshot:()=>({links}),get:()=>null},
  exists:(_s,id)=>[101,102].includes(id),
  spawn:()=>{throw Error("stale role must not grant extra spawn")}});
 const result=bridge.reconcile(30000142,[{id:"pirate",role:"pirate"}],
  {exemptEntityIDs:[999,888]});
 assert.deepEqual(result,[]);
});
test("fallback co-op miner/hauler links still count toward spawn cap",()=>{
 const live=new Set([101,102]);
 const registry={prune:()=>0,snapshot:()=>({links:{
  a:{pilotID:"a",role:"miner",systemID:30000142,entityID:101},
  b:{pilotID:"b",role:"hauler",systemID:30000142,entityID:102}}}),
  get:()=>null};
 const bridge=createBridge({limit:2,registry,exists:(_s,id)=>live.has(id),
  spawn:()=>{throw Error("would wrongly exceed fallback limit")}});
 assert.deepEqual(bridge.reconcile(30000142,[{id:"pirate"}]),[]);
});
