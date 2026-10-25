import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWreckCustody}=require("../integration/coopNpcWreckCustody.cjs");
const SID=30000144;
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"coop-wreck-custody-"));
 let now=1000000,allocated=3000,failDebit=false,failCredit=false;
 const source={wreckItemID:500,wreckID:201,typeID:42,groupID:7,categoryID:8,
  quantity:3,itemName:"Verified Resource",singleton:false,transient:false};
 const cargo=new Map(),sources=new Map([[500,source]]);
 const wreck={wreckID:201,systemID:SID,sourceEntityID:301,launcherID:301,
  ownerID:900,lootRightCorpID:44,transient:false};
 const native={entityID:101,systemID:SID,typeID:40,ownerID:900,corporationID:44};
 const hunter={kind:"ship",itemID:101,nativeNpc:true,position:{x:0,y:0,z:0}};
 const physical={itemID:201,nativeNpcWreck:true,position:{x:2200,y:0,z:0}};
 const scene={systemID:SID,getEntityByID:id=>id===101?hunter:id===201?physical:null,
  sessions:new Map()};
 const types={40:{typeID:40,volume:100,capacity:500},
  42:{typeID:42,volume:10,capacity:0}};
 const store={
  getNativeEntity:id=>id===101?native:null,
  getNativeWreck:id=>id===201?wreck:null,
  getNativeWreckItem:id=>sources.get(id)||null,
  listNativeCargoForEntity:id=>[...cargo.values()].filter(x=>x.entityID===id),
  buildNativeCargoItems:id=>[...cargo.values()].filter(x=>x.entityID===id)
   .map(x=>({itemID:x.cargoID,typeID:x.typeID,quantity:x.quantity,
    ownerID:x.ownerID,locationID:id})),
  allocateCargoID:()=>({success:true,data:++allocated}),
  removeNativeWreckItem:id=>{if(failDebit)return {success:false};
   sources.delete(id);return {success:true};},
  upsertNativeCargo:row=>{if(failCredit)return {success:false};
   cargo.set(row.cargoID,{...row});return {success:true};}
 };
 const claim={wreckID:201,systemID:SID,sourceEntityID:301,
  attackerEntityID:101,attackerPilotID:"coop-pilot-001",
  at:1000000,expiresAt:2000000};
 const assignments=[{pilotID:"coop-pilot-001",entityID:101,systemID:SID}];
 const controller={entityID:101,systemID:SID,currentTargetID:0};
 const create=()=>createWreckCustody({store,sceneForSystem:()=>scene,
  resolveType:id=>types[id],root:dir,clock:()=>now});
 const input=(other={})=>({claim,scene,entityID:101,wreckItemID:500,
  assignments,getController:()=>controller,canLoot:()=>true,
  verifyClaim:()=>true,...other});
 return {dir,native,hunter,physical,wreck,source,store,types,claim,
  cargo,sources,assignments,scene,controller,create,input,
  failDebit:v=>{failDebit=v},failCredit:v=>{failCredit=v},
  advance:ms=>{now+=ms},cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test("source-first full native transfer conserves existing quantity and real owner",()=>{
 const f=fixture();try{
  const result=f.create().transfer(f.input());
  assert.equal(result.status,"NATIVE_WRECK_CARGO_SETTLED");
  assert.equal(result.nativeSourceDebited,true);
  assert.equal(result.nativeCargoCredited,true);assert.equal(result.iskCredited,false);
  assert.equal(f.sources.size,0);assert.equal(f.cargo.size,1);
  const item=[...f.cargo.values()][0];assert.equal(item.quantity,3);
  assert.equal(item.ownerID,f.native.ownerID);assert.equal(item.entityID,101);
  assert.equal(f.hunter.nativeCargoItems.length,1);
 }finally{f.cleanup();}
});
test("duplicate item request and process restart are idempotent, never credit twice",()=>{
 const f=fixture();try{
  const first=f.create();assert.equal(first.transfer(f.input()).status,"NATIVE_WRECK_CARGO_SETTLED");
  assert.equal(first.transfer(f.input()).status,"ALREADY_SETTLED");
  const restarted=f.create();assert.equal(restarted.recover().status,"CLEAN");
  assert.equal(restarted.transfer(f.input()).status,"ALREADY_SETTLED");
  assert.equal(f.cargo.size,1);
 }finally{f.cleanup();}
});
test("without native wreck rights even matching kill claim cannot confiscate cargo",()=>{
 const f=fixture();try{
  f.wreck.ownerID=999;f.wreck.lootRightCorpID=999;
  assert.equal(f.create().transfer(f.input()).status,"NATIVE_LOOT_RIGHTS_NOT_VERIFIED");
  assert.equal(f.sources.size,1);assert.equal(f.cargo.size,0);
 }finally{f.cleanup();}
});
test("explicit authority callback fail-closed even with matching native owner",()=>{
 const f=fixture();try{
  assert.equal(f.create().transfer(f.input({canLoot:()=>false})).status,
   "NATIVE_LOOT_RIGHTS_NOT_VERIFIED");
  assert.equal(f.sources.size,1);
 }finally{f.cleanup();}
});
test("physical collection range cannot be bypassed by prior proximity inspection",()=>{
 const f=fixture();try{
  f.physical.position.x=3000;
  assert.equal(f.create().transfer(f.input()).status,"NATIVE_WRECK_OR_SHIP_UNVERIFIED");
  assert.equal(f.cargo.size,0);
 }finally{f.cleanup();}
});
test("native capacity and existing cargo are conserved without overflow",()=>{
 const f=fixture();try{
  f.types[40].capacity=25;
  assert.equal(f.create().transfer(f.input()).status,"NATIVE_CARGO_FULL");
  assert.equal(f.sources.size,1);assert.equal(f.cargo.size,0);
 }finally{f.cleanup();}
});
test("player-controlled or battle-locked hull never receives wreck item",()=>{
 const f=fixture();try{
  f.hunter.nativeNpc=false;
  assert.equal(f.create().transfer(f.input()).status,"NATIVE_WRECK_OR_SHIP_UNVERIFIED");
  f.hunter.nativeNpc=true;f.scene.sessions.set("active",{characterID:4,
   _space:{shipID:101}});
  assert.equal(f.create().transfer(f.input()).status,"PLAYER_SHIP_EXCLUDED");
  f.scene.sessions.clear();f.controller.currentTargetID=301;
  assert.equal(f.create().transfer(f.input()).status,"NATIVE_COMBAT_ORDER_ACTIVE");
 }finally{f.cleanup();}
});
test("fake pilot and conflicting physical entity assignment refuse native debit",()=>{
 const f=fixture();try{
  assert.equal(f.create().transfer(f.input({claim:{...f.claim,
   attackerPilotID:"coop-pilot-009"}})).status,"NATIVE_PILOT_NOT_UNIQUE");
  f.assignments.push({pilotID:"coop-pilot-009",entityID:101,systemID:SID});
  assert.equal(f.create().transfer(f.input()).status,"NATIVE_PILOT_NOT_UNIQUE");
  assert.equal(f.sources.size,1);
 }finally{f.cleanup();}
});
test("debit fails after durable PREPARED: recovery blocks instead of minting cargo",()=>{
 const f=fixture();try{
  const tx=f.create();f.failDebit(true);
  assert.equal(tx.transfer(f.input()).status,"DEBIT_OUTCOME_UNCERTAIN_REPAIR_REQUIRED");
  assert.equal(tx.recover().status,"NEEDS_OPERATOR_REPAIR");
  assert.equal(f.create().transfer(f.input()).status,"PREPARED_REQUIRES_REPAIR");
  assert.equal(f.sources.size,1);assert.equal(f.cargo.size,0);
 }finally{f.cleanup();}
});
test("confirmed source debit then failed credit is replayed exactly once after restart",()=>{
 const f=fixture();try{
  f.failCredit(true);
  assert.equal(f.create().transfer(f.input()).status,
   "DEBIT_CONFIRMED_DESTINATION_PENDING");
  assert.equal(f.sources.size,0);assert.equal(f.cargo.size,0);
  f.failCredit(false);
  const resumed=f.create().recover();
  assert.equal(resumed.status,"CLEAN");assert.equal(resumed.recovered,1);
  assert.equal(f.cargo.size,1);
  assert.equal(f.create().recover().recovered,0);
 }finally{f.cleanup();}
});
test("native hull changed ownership while debit pending: no cargo is granted",()=>{
 const f=fixture();try{
  f.failCredit(true);f.create().transfer(f.input());
  f.native.ownerID=998;f.failCredit(false);
  assert.equal(f.create().recover().status,"NEEDS_OPERATOR_REPAIR");
  assert.equal(f.cargo.size,0);
 }finally{f.cleanup();}
});
test("journal corrupted after previous commit does not silently reset or create",()=>{
 const f=fixture();try{
  f.create().transfer(f.input());
  const journal=path.join(f.dir,"tx","500.json");
  fs.writeFileSync(journal,'{"version":55}');
  assert.equal(f.create().recover().status,"NEEDS_OPERATOR_REPAIR");
  assert.equal(f.create().transfer(f.input()).status,"NATIVE_CUSTODY_REPAIR_REQUIRED");
  assert.equal(f.cargo.size,1);
 }finally{f.cleanup();}
});
test("one full wreck stack yields one new cargo ID; no partial free leftovers",()=>{
 const f=fixture();try{
  f.sources.get(500).quantity=9;
  f.types[40].capacity=100;
  assert.equal(f.create().transfer(f.input()).status,"NATIVE_WRECK_CARGO_SETTLED");
  assert.equal([...f.cargo.values()][0].quantity,9);
  assert.equal(f.sources.size,0);
 }finally{f.cleanup();}
});

test("fabricated receipt cannot reuse a live native wreck or bypass custody attestation",()=>{
 const f=fixture();try{
  assert.equal(f.create().transfer(f.input({verifyClaim:()=>false})).status,
   "NATIVE_KILL_RECEIPT_NOT_VERIFIED");
  assert.equal(f.sources.size,1);
  assert.equal(f.cargo.size,0);
 }finally{f.cleanup();}
});
test("inspecting a wreck at 5km is not automatically a valid 2.5km cargo pickup",()=>{
 const f=fixture();try{
  f.physical.position.x=4900;
  assert.equal(f.create().transfer(f.input()).status,"NATIVE_WRECK_OR_SHIP_UNVERIFIED");
 }finally{f.cleanup();}
});
