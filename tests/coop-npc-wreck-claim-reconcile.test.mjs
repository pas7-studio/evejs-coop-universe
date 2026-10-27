import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWreckClaims}=require("../integration/coopNpcWreckClaims.cjs");
const {measureLoot,planClaim,reconcile}=
 require("../integration/coopNpcWreckClaimReconcile.cjs");
const SID=30000145;
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"coop-wreck-claim-"));
 let now=2000000;
 const claim={wreckID:980300000008,systemID:SID,sourceEntityID:980000016472,
  attackerEntityID:980000000601,attackerPilotID:"coop-pilot-060",
  at:now-60000,expiresAt:now+3540000};
 const wreck={wreckID:claim.wreckID,systemID:SID,
  sourceEntityID:claim.sourceEntityID,launcherID:claim.sourceEntityID,
  expiresAtMs:now+4896000,transient:false};
 const items=[
  {wreckID:claim.wreckID,wreckItemID:980400000001,typeID:17463,quantity:90000},
  {wreckID:claim.wreckID,wreckItemID:980400000002,typeID:482,quantity:3450},
  {wreckID:claim.wreckID,wreckItemID:980400000003,typeID:482,singleton:true}];
 const entities=new Map();
 const scene={systemID:SID,getEntityByID:id=>entities.get(id)||null};
 const store={getNativeWreck:id=>Number(id)===claim.wreckID?wreck:null,
  listNativeWreckItemsForWreck:id=>Number(id)===claim.wreckID?items:[]};
 const file=path.join(dir,"claims.json");
 const journal=createWreckClaims({file,clock:()=>now});
 return {dir,claim,wreck,items,entities,scene,store,file,journal,
  now:()=>now,advance:ms=>{now+=ms;},
  cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test("loot measurement counts stacks, singleton quantity and distinct types",()=>{
 const f=fixture();try{
  assert.deepEqual(measureLoot(f.items),
   {stacks:3,quantity:93451,typeIDs:[17463,482]});
  assert.deepEqual(measureLoot([]),{stacks:0,quantity:0,typeIDs:[]});
 }finally{f.cleanup();}
});
test("a live physical wreck is never touched by reconciliation",()=>{
 const f=fixture();try{
  const physical={itemID:f.claim.wreckID,nativeNpcWreck:true};
  assert.equal(planClaim({claim:f.claim,physical,wreck:f.wreck,items:f.items,
   nowMs:f.now(),bootAgeMs:600000}).action,"KEEP");
 }finally{f.cleanup();}
});
test("inside the boot grace window nothing is restored or closed",()=>{
 const f=fixture();try{
  const plan=planClaim({claim:f.claim,physical:null,wreck:f.wreck,items:f.items,
   nowMs:f.now(),bootAgeMs:5000,graceMs:120000});
  assert.equal(plan.action,"WAIT");
  assert.equal(plan.reason,"BOOT_GRACE");
 }finally{f.cleanup();}
});
test("a durable unexpired row with stored loot is restored, never closed",()=>{
 const f=fixture();try{
  const plan=planClaim({claim:f.claim,physical:null,wreck:f.wreck,
   items:f.items,nowMs:f.now(),bootAgeMs:600000});
  assert.equal(plan.action,"RESTORE");
  assert.equal(plan.reason,"DURABLE_ROW_WITHOUT_PHYSICAL_ENTITY");
  assert.equal(plan.loot.stacks,3);
  assert.equal(plan.loot.quantity,93451);
 }finally{f.cleanup();}
});
test("a lost, decayed, empty or mismatched row closes with its exact reason",()=>{
 const f=fixture();try{
  const base={claim:f.claim,physical:null,nowMs:f.now(),bootAgeMs:600000};
  assert.equal(planClaim({...base,wreck:null,items:[]}).reason,
   "WRECK_ROW_ABSENT");
  assert.equal(planClaim({...base,wreck:null,items:[]}).loot,null);
  assert.equal(planClaim({...base,wreck:null,items:[]}).lootMeasurable,false);
  const expired={...f.wreck,expiresAtMs:f.now()-1000};
  const decayed=planClaim({...base,wreck:expired,items:f.items});
  assert.equal(decayed.reason,"WRECK_DECAYED");
  assert.equal(decayed.loot.quantity,93451);
  assert.equal(planClaim({...base,wreck:f.wreck,items:[]}).reason,
   "WRECK_HAS_NO_STORED_ITEMS");
  assert.equal(planClaim({...base,wreck:{...f.wreck,sourceEntityID:123},
   items:f.items}).reason,"WRECK_ROW_MISMATCH");
 }finally{f.cleanup();}
});
test("reconcile restores through the native spawn and keeps the claim alive",()=>{
 const f=fixture();try{
  f.journal.record({proof:{status:"NATIVE_DESTRUCTION_ATTACKER_PROVIDED",
   systemID:SID,victimEntityID:f.claim.sourceEntityID,
   attackerEntityID:f.claim.attackerEntityID,
   attackerPilotID:f.claim.attackerPilotID,wreckID:f.claim.wreckID},
   wreck:f.wreck});
  const calls=[];
  const result=reconcile({systemID:SID,scene:f.scene,claims:f.journal.active(SID),
   store:f.store,nowMs:f.now(),bootAgeMs:600000,
   restore:args=>{calls.push(args);return {success:true};},
   close:args=>f.journal.close(args)});
  assert.equal(result.status,"OK");
  assert.equal(result.results.length,1);
  assert.equal(result.results[0].status,"RESTORED");
  assert.equal(result.results[0].reason,
   "NATIVE_WRECK_ENTITY_RESTORED_FROM_DURABLE_ROW");
  assert.equal(result.results[0].nativeSource,"STOCK_SPAWN_NATIVE_WRECK");
  assert.deepEqual(calls.map(c=>[c.systemID,c.wreckID]),[[SID,f.claim.wreckID]]);
  assert.equal(f.journal.active(SID).length,1);
  assert.equal(f.journal.closed(SID).length,0);
 }finally{f.cleanup();}
});
test("a refused native restore closes the claim durably with the lost loot",()=>{
 const f=fixture();try{
  f.journal.record({proof:{status:"NATIVE_DESTRUCTION_ATTACKER_PROVIDED",
   systemID:SID,victimEntityID:f.claim.sourceEntityID,
   attackerEntityID:f.claim.attackerEntityID,
   attackerPilotID:f.claim.attackerPilotID,wreckID:f.claim.wreckID},
   wreck:f.wreck});
  const result=reconcile({systemID:SID,scene:f.scene,claims:f.journal.active(SID),
   store:f.store,nowMs:f.now(),bootAgeMs:600000,
   restore:()=>({success:false,errorMsg:"SCENE_NOT_FOUND"}),
   close:args=>f.journal.close(args)});
  assert.equal(result.results[0].status,"CLOSED");
  assert.equal(result.results[0].reason,"RESTORE_REFUSED_SCENE_NOT_FOUND");
  assert.equal(result.results[0].loot.quantity,93451);
  assert.equal(f.journal.active(SID).length,0);
  const closed=f.journal.closed(SID);
  assert.equal(closed.length,1);
  assert.equal(closed[0].reason,"RESTORE_REFUSED_SCENE_NOT_FOUND");
  assert.equal(closed[0].loot.stacks,3);
 }finally{f.cleanup();}
});
test("a closed claim never comes back, survives a restart and is idempotent",()=>{
 const f=fixture();try{
  const reloaded=()=>createWreckClaims({file:f.file,clock:f.now});
  reloaded().record({proof:{status:"NATIVE_DESTRUCTION_ATTACKER_PROVIDED",
   systemID:SID,victimEntityID:f.claim.sourceEntityID,
   attackerEntityID:f.claim.attackerEntityID,
   attackerPilotID:f.claim.attackerPilotID,wreckID:f.claim.wreckID},
   wreck:f.wreck});
  const first=reloaded().close({wreckID:f.claim.wreckID,
   reason:"WRECK_ROW_ABSENT",loot:null});
  assert.equal(first.status,"CLAIM_CLOSED");
  assert.equal(first.record.loot,null);
  assert.equal(reloaded().active(SID).length,0);
  assert.equal(reloaded().closed(SID).length,1);
  assert.equal(reloaded().close({wreckID:f.claim.wreckID,
   reason:"WRECK_ROW_ABSENT"}).status,"ALREADY_CLOSED");
  // A later kill can still be recorded in the same journal.
  assert.equal(reloaded().record({proof:{status:"NATIVE_DESTRUCTION_ATTACKER_PROVIDED",
   systemID:SID,victimEntityID:777,attackerEntityID:888,
   attackerPilotID:"coop-pilot-099",wreckID:980300000099},
   wreck:{wreckID:980300000099,systemID:SID,sourceEntityID:777,launcherID:777}})
   .status,"KILL_PROOF_RECORDED");
  assert.equal(reloaded().closed(SID).length,1);
 }finally{f.cleanup();}
});
test("closing refuses an unknown claim, an invalid reason and bad loot",()=>{
 const f=fixture();try{
  const j=createWreckClaims({file:f.file,clock:f.now});
  assert.equal(j.close({wreckID:424242,reason:"WRECK_ROW_ABSENT"}).status,
   "NO_CLAIM");
  j.record({proof:{status:"NATIVE_DESTRUCTION_ATTACKER_PROVIDED",systemID:SID,
   victimEntityID:f.claim.sourceEntityID,
   attackerEntityID:f.claim.attackerEntityID,
   attackerPilotID:f.claim.attackerPilotID,wreckID:f.claim.wreckID},
   wreck:f.wreck});
  assert.equal(j.close({wreckID:f.claim.wreckID,reason:"lowercase"}).status,
   "INVALID_CLAIM_CLOSE");
  assert.equal(j.close({wreckID:f.claim.wreckID,reason:"WRECK_ROW_ABSENT",
   loot:{stacks:-1,quantity:0,typeIDs:[]}}).status,"INVALID_CLAIM_CLOSE");
  assert.equal(j.active(SID).length,1);
 }finally{f.cleanup();}
});
test("a corrupt closed section fails closed instead of overwriting proof",()=>{
 const f=fixture();try{
  fs.writeFileSync(f.file,JSON.stringify({version:1,claims:{},
   closed:{980300000008:{wreckID:980300000008}}}));
  assert.throws(()=>createWreckClaims({file:f.file,clock:f.now}),
   /INVALID_NATIVE_WRECK_CLAIMS_JOURNAL/);
 }finally{f.cleanup();}
});
