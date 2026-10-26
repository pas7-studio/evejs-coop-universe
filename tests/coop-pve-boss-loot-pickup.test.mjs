import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {verify,createObserver}=require("../integration/coopPveBossLootPickup.cjs");
const {verify:verifyNative}=require("../integration/coopNativeLootPickupEvidence.cjs");
function fixture({available=3,take=2,singleton=false}={}){
 const systemID=30000144,wreckID=9551,wreckItemID=9901,typeID=91001;
 const characterID=77,shipID=8001;
 const wreck={wreckID,sourceEntityID:101,systemID,launcherID:101,
  sourceTypeID:30001,transient:true,createdAtMs:1001000};
 const bossWitness={systemID,instanceID:6001,siteID:7001,
  bossEntityID:101,bossTypeID:30001,wreckID,
  originalItems:[{wreckItemID,typeID,quantity:available,singleton}]};
 const sourceBefore={wreckID,wreckItemID,typeID,quantity:available,
  singleton,ownerID:999,locationID:wreckID};
 const sourceAfter=available===take?null:{...sourceBefore,quantity:available-take};
 const ship={kind:"ship",itemID:shipID,ownerID:characterID};
 const nativeWreckEntity={kind:"wreck",itemID:wreckID,nativeNpcWreck:true,
  launcherID:101};
 const entities=new Map([[shipID,ship],[wreckID,nativeWreckEntity]]);
 const session={characterID,clientID:700,_space:{
  shipID,systemID,initialStateSent:true},socket:{destroyed:false}};
 const scene={systemID,session,entities,getEntityByID:id=>entities.get(id),
  sessions:new Map([[characterID,session]])};
 const destBefore={itemID:123456,ownerID:characterID,locationID:shipID,
  typeID,stacksize:1};
 const destAfter={...destBefore,stacksize:1+take};
 const grantResult={success:true,data:{quantity:take,changes:[
  {removed:false,previousData:destBefore,item:destAfter}
 ]}};
 const args={scene,wreck,characterID,wreckItemID,destinationLocationID:shipID,
  sourceBefore,sourceAfter,availableQuantity:available,
  requestedQuantity:take,grantResult};
 const nativePickup=verifyNative(args);
 return {args,nativePickup,bossWitness,currentWreck:wreck,
  sourceBefore,sourceAfter,grantResult,session,ship,entities,scene};
}
test("P0-4B uses the EXISTING authentic native cargo pickup witness",()=>{
 const f=fixture();assert.equal(f.nativePickup.status,"VERIFIED_NATIVE_LOOT_PICKUP");
 const x=verify(f);
 assert.equal(x.status,"ORIGINAL_BOSS_ITEM_PICKUP_VERIFIED");
 assert.equal(x.wreckItemID,9901);
 assert.equal(x.bossEntityID,101);
 assert.equal(x.characterID,77);
 assert.equal(x.shipID,8001);
 assert.equal(x.quantity,2);assert.equal(x.remainingQuantity,1);
});
test("the last legitimate native cargo stack pickup has no residual wreck item",()=>{
 const f=fixture({available:1,take:1,singleton:true});
 assert.equal(f.nativePickup.status,"VERIFIED_NATIVE_LOOT_PICKUP");
 assert.equal(verify(f).remainingQuantity,0);
});
test("never promote a native transfer without the original death/manifest witness",()=>{
 const f=fixture();
 assert.equal(verify({...f,bossWitness:null}).status,"NO_SOURCE_VERIFIED_BOSS_WRECK");
 assert.equal(verify({...f,bossWitness:{...f.bossWitness,originalItems:[]}}).status,
  "ITEM_NOT_IN_ORIGINAL_BOSS_LOOT");
});
test("a different NPC wreck, system, type or duplicate item manifest is blocked",()=>{
 const f=fixture();
 for(const mutation of [
  {bossEntityID:102},{bossTypeID:42},{wreckID:9552},{systemID:30000145},
  {originalItems:[...f.bossWitness.originalItems,...f.bossWitness.originalItems]}
 ]){
  assert.equal(verify({...f,bossWitness:{...f.bossWitness,...mutation}}).status,
   "BOSS_LOOT_SOURCE_MISMATCH");
 }
});
test("item ID and type must be original to the boss native death",()=>{
 const f=fixture();
 for(const mutate of [
  {wreckItemID:9999},{typeID:999},{quantity:1},
  {singleton:true}
 ]){
  const witness={...f.bossWitness,originalItems:[
   {...f.bossWitness.originalItems[0],...mutate}
  ]};
  assert.equal(verify({...f,bossWitness:witness}).status,
   "ITEM_NOT_IN_ORIGINAL_BOSS_LOOT");
 }
});
test("no fake pickup on a native source-debit failure",()=>{
 const f=fixture();
 f.args.sourceAfter={...f.args.sourceAfter,quantity:3};
 const native=verifyNative(f.args);
 assert.equal(native.status,"NATIVE_LOOT_SOURCE_NOT_DECREMENTED");
 assert.equal(verify({...f,nativePickup:native}).status,"NATIVE_PICKUP_NOT_VERIFIED");
});
test("no claim without native destination inventory delta",()=>{
 const f=fixture();
 f.grantResult.data.changes[0].item.stacksize=2;
 const native=verifyNative(f.args);
 assert.equal(native.status,"NATIVE_GRANT_DESTINATION_UNVERIFIED");
 assert.equal(verify({...f,nativePickup:native}).status,"NATIVE_PICKUP_NOT_VERIFIED");
});
test("no fake pickup for disconnected, duplicate or changed native pilot",()=>{
 for(const mutate of [
  f=>{f.session.socket.destroyed=true},
  f=>{f.scene.sessions.set(999,{...f.session,socket:{destroyed:false}})},
  f=>{f.ship.ownerID=78}
 ]){
  const f=fixture();mutate(f);
  const native=verifyNative(f.args);
  assert.notEqual(native.status,"VERIFIED_NATIVE_LOOT_PICKUP");
  assert.equal(verify({...f,nativePickup:native}).status,"NATIVE_PICKUP_NOT_VERIFIED");
 }
});
test("observer reports exactly one original source slice, not a second item",()=>{
 const f=fixture(),emitted=[],observer=createObserver({
  getBossWreck:()=>f.bossWitness,getNativeWreck:()=>f.currentWreck,
  observe:row=>{emitted.push(row);return true}
 });
 assert.equal(observer.note(f.args,f.nativePickup).status,
  "ORIGINAL_BOSS_ITEM_PICKUP_VERIFIED");
 assert.equal(observer.note(f.args,f.nativePickup).status,"ALREADY_REPORTED_BOSS_PICKUP");
 assert.equal(emitted.length,1);
 assert.equal(observer.snapshot().emitted,1);
 assert.equal(f.sourceBefore.quantity,3,"read-only evidence must not debit again");
});
test("two native partial pickups are distinct only when original source quantity changes",()=>{
 const f=fixture(),emitted=[],observer=createObserver({
  getBossWreck:()=>f.bossWitness,getNativeWreck:()=>f.currentWreck,
  observe:row=>{emitted.push(row);return true}
 });
 assert.equal(observer.note(f.args,f.nativePickup).status,"ORIGINAL_BOSS_ITEM_PICKUP_VERIFIED");
 const second=fixture({available:1,take:1});
 second.bossWitness.originalItems=[...f.bossWitness.originalItems];
 assert.equal(observer.note(second.args,second.nativePickup).status,
  "ORIGINAL_BOSS_ITEM_PICKUP_VERIFIED");
 assert.equal(emitted.length,2);
 assert.equal(emitted.reduce((n,x)=>n+x.quantity,0),3);
});
test("telemetry failure does not produce a false confirmed record",()=>{
 const f=fixture();
 const observer=createObserver({
  getBossWreck:()=>f.bossWitness,getNativeWreck:()=>f.currentWreck,
  observe:()=>false
 });
 assert.equal(observer.note(f.args,f.nativePickup).status,"BOSS_LOOT_TELEMETRY_NOT_RECORDED");
 assert.equal(observer.snapshot().emitted,0);
});
test("boss pickup witness cannot be used to fabricate rare drop types or grants",()=>{
 const f=fixture(),observer=createObserver({
  getBossWreck:()=>null,getNativeWreck:()=>f.currentWreck,
  observe:()=>{throw Error("should not emit")}
 });
 assert.equal(observer.note(f.args,f.nativePickup).status,"NO_SOURCE_VERIFIED_BOSS_WRECK");
 assert.equal(observer.snapshot().emitted,0);
});
