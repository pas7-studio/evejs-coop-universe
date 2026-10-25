import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWreckClaims}=require("../integration/coopNpcWreckClaims.cjs");
const {createWreckRecovery}=require("../integration/coopNpcWreckRecovery.cjs");
const SID=30000144;
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"coop-native-wreck-"));
 let now=1000000;
 const ship={itemID:101,kind:"ship",nativeNpc:true,position:{x:0,y:0,z:0}};
 const wreck={itemID:201,nativeNpcWreck:true,kind:"wreck",position:{x:400000,y:0,z:0}};
 const entities=new Map([[101,ship],[201,wreck]]);
 const scene={systemID:SID,getEntityByID:id=>entities.get(id),
   getCurrentSimTimeMs:()=>now};
 const record={wreckID:201,systemID:SID,sourceEntityID:300,
  launcherID:300,expiresAtMs:2000000};
 const items=[{wreckID:201,wreckItemID:500,typeID:42,quantity:3}];
 const store={getNativeWreck:id=>id===201?record:null,
  listNativeWreckItemsForWreck:id=>id===201?items:[]};
 const proof={status:"NATIVE_DESTRUCTION_ATTACKER_PROVIDED",
  systemID:SID,victimEntityID:300,attackerEntityID:101,
  attackerPilotID:"coop-pilot-001",wreckID:201};
 const file=path.join(dir,"claims.json");
 const create=()=>createWreckClaims({file,clock:()=>now});
 const orders=[];
 const recovery=createWreckRecovery({clock:()=>now,
  warp:(id,wreckID)=>{orders.push({action:"warp",id,wreckID});return {success:true};},
  orbit:(id,wreckID)=>{orders.push({action:"orbit",id,wreckID});return {success:true};}});
 const controller={entityID:101,systemID:SID,currentTargetID:0};
 const assignments=[{pilotID:"coop-pilot-001",entityID:101,systemID:SID},
   {pilotID:"coop-pilot-001",entityID:101,systemID:SID}];
 const tick=(claims,extra={})=>recovery.tick({
  systemID:SID,scene,claims,assignments,store,
  getController:()=>controller,...extra});
 return {dir,now:()=>now,advance:ms=>{now+=ms;},ship,wreck,record,items,entities,
  scene,store,proof,create,recovery,controller,assignments,orders,tick,
  cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test("native destruction proof persists once and survives restart",()=>{
 const f=fixture();try{
  const a=f.create();
  assert.equal(a.record({proof:f.proof,wreck:f.record}).status,"KILL_PROOF_RECORDED");
  assert.equal(f.create().active(SID).length,1);
  assert.equal(a.record({proof:f.proof,wreck:f.record}).status,"ALREADY_RECORDED");
  assert.equal(f.create().active(30000142).length,0);
 }finally{f.cleanup();}
});
test("missing upstream attacker proof or incompatible wreck origin cannot create claim",()=>{
 const f=fixture();try{const j=f.create();
  assert.equal(j.record({proof:{...f.proof,status:"UPSTREAM_ATTACKER_NOT_PROVIDED"},
    wreck:f.record}).status,"NO_NATIVE_KILL_PROOF");
  assert.equal(j.record({proof:f.proof,wreck:{...f.record,sourceEntityID:404}})
    .status,"NO_NATIVE_KILL_PROOF");
  assert.equal(j.active(SID).length,0);
 }finally{f.cleanup();}
});
test("conflicting second attacker cannot reassign already witnessed native kill",()=>{
 const f=fixture();try{const j=f.create();
  j.record({proof:f.proof,wreck:f.record});
  assert.equal(j.record({proof:{...f.proof,attackerPilotID:"coop-pilot-002"},
   wreck:f.record}).status,"CLAIM_CONFLICT_REQUIRES_REPAIR");
 }finally{f.cleanup();}
});
test("persistent journal corruption fails closed rather than overwriting proof",()=>{
 const f=fixture();try{
  fs.writeFileSync(path.join(f.dir,"claims.json"),'{"version":2,"claims":{}}');
  assert.throws(()=>f.create(),/INVALID_NATIVE_WRECK_CLAIMS_JOURNAL/);
  assert.match(fs.readFileSync(path.join(f.dir,"claims.json"),"utf8"),/"version":2/);
 }finally{f.cleanup();}
});
test("verified surviving native wreck with real items triggers native warp and no loot grant",()=>{
 const f=fixture();try{
  const j=f.create();j.record({proof:f.proof,wreck:f.record});
  const result=f.tick(j.active(SID));
  assert.equal(result.orders.length,1);
  assert.equal(result.orders[0].action,"NATIVE_WARP_TO_WRECK");
  assert.equal(result.orders[0].cargoTransferred,false);
  assert.equal(result.orders[0].iskGranted,false);
  assert.deepEqual(f.orders,[{action:"warp",id:101,wreckID:201}]);
  assert.deepEqual([...f.recovery.activeIDs(SID)],[101]);
 }finally{f.cleanup();}
});
test("same native pilot can orbit and inspect only at physical wreck within real distance",()=>{
 const f=fixture();try{
  const j=f.create();j.record({proof:f.proof,wreck:f.record});
  const claims=j.active(SID);
  f.ship.position.x=200000;
  assert.equal(f.tick(claims).orders[0].action,"NATIVE_ORBIT_WRECK");
  f.advance(61000);f.ship.position.x=397000;
  const inspected=f.tick(claims).inspections;
  assert.equal(inspected.length,1);
  assert.equal(inspected[0].status,"NATIVE_WRECK_REACHED");
  assert.equal(inspected[0].distinctNativeItemCount,1);
  assert.equal(inspected[0].cargoTransferred,false);
 }finally{f.cleanup();}
});
test("no actual native items, missing wreck or false physical wreck never initiates recovery",()=>{
 const f=fixture();try{
  const j=f.create();j.record({proof:f.proof,wreck:f.record});
  f.items.splice(0);
  assert.equal(f.tick(j.active(SID)).orders.length,0);
  f.items.push({wreckID:201,wreckItemID:500,typeID:42,quantity:3});
  f.wreck.nativeNpcWreck=false;
  assert.equal(f.tick(j.active(SID)).orders.length,0);
  f.wreck.nativeNpcWreck=true;f.entities.delete(201);
  assert.equal(f.tick(j.active(SID)).orders.length,0);
 }finally{f.cleanup();}
});
test("combat, warp in progress, player-owned ship and blocked arbiter prevent recovery",()=>{
 const f=fixture();try{const j=f.create();j.record({proof:f.proof,wreck:f.record});
  const claims=j.active(SID);
  f.controller.currentTargetID=202;
  assert.equal(f.tick(claims).orders.length,0);
  f.controller.currentTargetID=0;f.ship.mode="WARP";
  assert.equal(f.tick(claims).orders.length,0);
  f.ship.mode="STOP";f.ship.nativeNpc=false;
  assert.equal(f.tick(claims).orders.length,0);
  f.ship.nativeNpc=true;
  assert.equal(f.tick(claims,{blockedIDs:new Set([101])}).orders.length,0);
  assert.equal(f.orders.length,0);
 }finally{f.cleanup();}
});
test("conflicting durable ship identities fail closed while identical links are allowed",()=>{
 const f=fixture();try{const j=f.create();j.record({proof:f.proof,wreck:f.record});
  const claims=j.active(SID);
  f.assignments.push({pilotID:"coop-pilot-002",entityID:101,systemID:SID});
  assert.equal(f.tick(claims).orders.length,0);
  f.assignments.pop();
  assert.equal(f.tick(claims).orders.length,1);
 }finally{f.cleanup();}
});
test("expired kill receipt and stale physical wreck never justify recovery",()=>{
 const f=fixture();try{const j=f.create();j.record({proof:f.proof,wreck:f.record});
  const saved=j.active(SID);
  f.advance(3600001);
  assert.equal(j.active(SID).length,0);
  assert.equal(f.tick(saved).orders.length,0);
 }finally{f.cleanup();}
});
test("same real wreck can't receive repeated native orders every 30-second world tick",()=>{
 const f=fixture();try{const j=f.create();j.record({proof:f.proof,wreck:f.record});
  const claims=j.active(SID);
  assert.equal(f.tick(claims).orders.length,1);
  f.advance(30000);
  assert.equal(f.tick(claims).orders.length,0);
  assert.equal(f.orders.length,1);
 }finally{f.cleanup();}
});
