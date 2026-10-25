import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createFireOutcomeWitness,enabled}=require("../integration/coopNpcFireOutcomeWitness.cjs");
const {inspectShip,createAtomicAmmoBank}=require("../integration/coopNpcAmmoBankAtomic.cjs");
const entity={kind:"ship",nativeNpc:true,itemID:101,ownerID:900};
function fixture(fn,{phase="COMMITTED",outcome=null}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"coop-fire-outcome-"));
 const dir=path.join(root,"bank-ships");
 fs.mkdirSync(dir);
 const file=path.join(dir,"101.json");
 const value={version:1,phase,entityID:101,boundaryMs:1000,
  modules:[401],nonce:"test-101",...(outcome?{outcome}:{})};
 fs.writeFileSync(file,JSON.stringify(value));
 try{return fn({root,dir,file,record:createFireOutcomeWitness({root,clock:()=>2000}).record,
  inspect:()=>inspectShip({root,entityID:101})});}
 finally{fs.rmSync(root,{recursive:true,force:true});}
}
test("native turret miss is durably recorded as a legitimate spent-charge outcome",()=>{
 fixture(f=>{
  const result=f.record({entity,whenMs:1000,kind:"TURRET_RESOLVED",hit:false});
  assert.equal(result.ok,true);
  const written=JSON.parse(fs.readFileSync(f.file,"utf8"));
  assert.equal(written.phase,"COMMITTED");
  assert.equal(written.outcome.kind,"TURRET_RESOLVED");
  assert.equal(written.outcome.hit,false);
  assert.equal(written.outcome.boundaryMs,1000);
  assert.equal(f.inspect().status,"COMMITTED");
  assert.equal(fs.existsSync(f.file+".lock"),false);
 });
});
test("native missile launch is tied to the real spawned entity ID",()=>{
 fixture(f=>{
  const result=f.record({entity,whenMs:1000,kind:"MISSILE_LAUNCHED",missileID:99001});
  assert.equal(result.ok,true);
  const written=JSON.parse(fs.readFileSync(f.file,"utf8"));
  assert.equal(written.outcome.missileID,99001);
  assert.equal(written.outcome.kind,"MISSILE_LAUNCHED");
 });
});
test("known missile launch failure is recorded, but must not authorize next cycle",()=>{
 fixture(f=>{
  assert.equal(f.record({entity,whenMs:1000,kind:"MISSILE_LAUNCH_FAILED"}).ok,true);
  const prev=process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS;
  process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS="1";
  let calls=0;
  try{
   const atomicRows={transact(){calls++;throw Error("must not debit");}};
   const bank=createAtomicAmmoBank({root:f.root,atomicRows,
    store:{listNativeCargoForEntity:()=>[]},compatible:()=>true});
   const result=bank.consume({entity,whenMs:1100,
    entries:[{moduleItem:{itemID:401,typeID:123,flagID:27},
     chargeItem:{itemID:501,typeID:35,quantity:4}}]});
   assert.equal(result.success,false);
   assert.equal(calls,0);
   assert.equal(f.inspect().status,"COMMITTED");
  }finally{
   if(prev===undefined)delete process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS;
   else process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS=prev;
  }
 });
});
test("missing outcome on committed charge prevents a subsequent debit when witnessed mode enabled",()=>{
 fixture(f=>{
  const prev=process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS;
  process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS="1";
  try{
   let transactions=0;
   const bank=createAtomicAmmoBank({root:f.root,
    atomicRows:{transact(){transactions++;return [];}},compatible:()=>true,
    store:{listNativeCargoForEntity:()=>[]}});
   const result=bank.consume({entity,whenMs:1100,
    entries:[{moduleItem:{itemID:401,flagID:27,typeID:123},
     chargeItem:{itemID:501,typeID:35,quantity:4}}]});
   assert.equal(result.success,false);
   assert.equal(transactions,0);
   assert.equal(fs.existsSync(f.file+".lock"),false);
  }finally{
   if(prev===undefined)delete process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS;
   else process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS=prev;
  }
 });
});
test("wrong cycle ID, forged missing missile entity, and PREPARED do not create success outcomes",()=>{
 fixture(f=>{
  assert.equal(f.record({entity,whenMs:999,kind:"TURRET_RESOLVED",hit:true}).ok,false);
  assert.equal(f.record({entity,whenMs:1000,kind:"MISSILE_LAUNCHED",missileID:0}).ok,false);
  assert.equal(JSON.parse(fs.readFileSync(f.file,"utf8")).outcome,undefined);
  assert.equal(fs.existsSync(f.file+".lock"),false);
 });
 fixture(f=>{
  const result=f.record({entity,whenMs:1000,kind:"TURRET_RESOLVED",hit:true});
  assert.equal(result.ok,false);
 },{phase:"PREPARED"});
});
test("duplicate outcome is rejected before lock acquisition; first result never overwritten",()=>{
 fixture(f=>{
  assert.equal(f.record({entity,whenMs:1000,kind:"TURRET_RESOLVED",hit:true}).ok,true);
  const previous=fs.readFileSync(f.file,"utf8");
  const duplicate=f.record({entity,whenMs:1000,kind:"TURRET_RESOLVED",hit:false});
  assert.equal(duplicate.status,"BANK_OUTCOME_ALREADY_PRESENT");
  assert.equal(fs.readFileSync(f.file,"utf8"),previous);
  assert.equal(fs.existsSync(f.file+".lock"),false);
 });
});
test("disk rename failure retains stale exclusive lock and orphan temp; never claims the shot",()=>{
 fixture(f=>{
  const io={...fs,renameSync(){throw Error("SIMULATED_RENAME_FAILURE");}};
  const record=createFireOutcomeWitness({root:f.root,io,clock:()=>2000}).record;
  const failed=record({entity,whenMs:1000,kind:"TURRET_RESOLVED",hit:true});
  assert.equal(failed.ok,false);
  assert.equal(fs.existsSync(f.file+".lock"),true);
  assert.equal(f.inspect().ok,false);
  assert.equal(JSON.parse(fs.readFileSync(f.file,"utf8")).outcome,undefined);
 });
});
test("witness mode remains OFF without all native SQLite safety flags",()=>{
 assert.equal(enabled({EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS:"1"}),false);
 assert.equal(enabled({EVEJS_COOP_NPC_STRICT_AMMO:"1",EVEJS_COOP_NPC_AMMO_DURABLE_CYCLE:"1",
 EVEJS_COOP_NPC_BANK_ATOMIC:"1",EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",
 EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS:"1"}),true);
});

test("attested legitimate turret miss permits next durable native debit boundary",()=>{
 fixture(f=>{
  assert.equal(f.record({entity,whenMs:1000,kind:"TURRET_RESOLVED",hit:false}).ok,true);
  const prior=process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS;
  process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS="1";
  try{
   const SEP="\u001f";
   let state={
    npcEntities:{["entities"+SEP+"101"]:{entityID:101,ownerID:900,systemID:30000144}},
    npcModules:{["modules"+SEP+"401"]:{moduleID:401,entityID:101,ownerID:900,typeID:123,categoryID:7,flagID:27}},
    npcCargo:{cargo:{"501":{cargoID:501,entityID:101,moduleID:401,ownerID:900,typeID:35,categoryID:8,quantity:4}},
     coopAmmoCycles_101:{version:1,entityID:101,modules:{"401":1000}}}
   };
   let transactions=0;
   const tx={get(t,k){return state[t][k]??null;},
    put(t,k,value){state[t][k]=structuredClone(value);}};
   const bank=createAtomicAmmoBank({root:f.root,
    atomicRows:{transact(tables,fn){transactions++;return fn(tx);}},
    store:{listNativeCargoForEntity:()=>Object.values(state.npcCargo.cargo)},
    compatible:()=>true,clock:()=>3000});
   const native={...entity,nativeCargoItems:[{itemID:501,typeID:35,moduleID:401,quantity:4,stacksize:4}]};
   const result=bank.consume({entity:native,whenMs:1100,
    entries:[{moduleItem:{itemID:401,flagID:27,typeID:123},
     chargeItem:{itemID:501,typeID:35,quantity:4}}]});
   assert.equal(result.success,true);
   assert.equal(transactions,1);
   assert.equal(state.npcCargo.cargo["501"].quantity,3);
   assert.equal(state.npcCargo.coopAmmoCycles_101.modules["401"],1100);
   assert.equal(f.inspect().status,"COMMITTED");
  }finally{
   if(prior===undefined)delete process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS;
   else process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS=prior;
  }
 });
});

test("forged incomplete outcome cannot unblock a bank even when kind and boundary match",()=>{
 fixture(f=>{
  const prior=process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS;
  process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS="1";
  try{
   let calls=0;
   const bank=createAtomicAmmoBank({root:f.root,
    atomicRows:{transact(){calls++;throw Error("FORGED_OUTCOME_MUST_BE_BLOCKED");}},
    store:{listNativeCargoForEntity:()=>[]},compatible:()=>true});
   const result=bank.consume({entity,whenMs:1100,
    entries:[{moduleItem:{itemID:401,typeID:123,flagID:27},
     chargeItem:{itemID:501,typeID:35,quantity:4}}]});
   assert.equal(result.success,false);
   assert.equal(calls,0);
   assert.equal(fs.existsSync(f.file+".lock"),false);
  }finally{
   if(prior===undefined)delete process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS;
   else process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS=prior;
  }
 },{outcome:{kind:"TURRET_RESOLVED",boundaryMs:1000}});
});

function checkPriorBankFence({dropJournal=false,dropFence=false,staleBoundary=false}={}){
 fixture(f=>{
  assert.equal(f.record({entity,whenMs:1000,kind:"TURRET_RESOLVED",hit:false}).ok,true);
  if(dropJournal)fs.unlinkSync(f.file); // disposable fixture ONLY
  const previous=process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS;
  process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS="1";
  try{
   const sep="\u001f";
   const state={
    npcEntities:{["entities"+sep+"101"]:{entityID:101,ownerID:900,systemID:30000144}},
    npcModules:{["modules"+sep+"401"]:{moduleID:401,entityID:101,ownerID:900,
      typeID:123,categoryID:7,flagID:27}},
    npcCargo:{cargo:{"501":{cargoID:501,entityID:101,ownerID:900,
      moduleID:401,typeID:35,categoryID:8,quantity:4}}}
   };
   if(!dropFence)state.npcCargo.coopAmmoCycles_101={
    version:1,entityID:101,modules:{"401":staleBoundary?999:1000}};
   let transactions=0,writes=0;
   const bank=createAtomicAmmoBank({
    root:f.root,
    atomicRows:{transact(_tables,callback){
     transactions++;
     return callback({get:(table,key)=>state[table][key]??null,
      put(){writes++;throw Error("WRITES_FORBIDDEN_WHEN_PRIOR_PROOF_MISMATCH");}});
    }},
    store:{listNativeCargoForEntity:()=>Object.values(state.npcCargo.cargo)},
    compatible:()=>true,clock:()=>3000
   });
   const fired=bank.consume({
    entity:{...entity,nativeCargoItems:[{itemID:501,quantity:4,stacksize:4}]},
    entries:[{moduleItem:{itemID:401,flagID:27,typeID:123},
      chargeItem:{itemID:501,typeID:35,quantity:4}}],
    whenMs:1100
   });
   assert.equal(fired.success,false);
   assert.equal(fired.errorMsg,"BANK_ATOMIC_TRANSACTION_UNCERTAIN");
   assert.equal(transactions,1,"test must reach authoritative SQLite proof");
   assert.equal(writes,0,"no native cargo may change");
   assert.equal(state.npcCargo.cargo["501"].quantity,4);
   assert.equal(fs.existsSync(f.file+".lock"),true,
     "unresolved state must retain the writer lock");
  }finally{
   if(previous===undefined)delete process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS;
   else process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS=previous;
  }
 });
}
test("new empty POSIX root cannot bypass an existing authoritative SQLite prior debit",()=>{
 checkPriorBankFence({dropJournal:true});
});
test("forged attested POSIX receipt without corresponding SQLite fence cannot debit",()=>{
 checkPriorBankFence({dropFence:true});
});
test("stale SQLite boundary cannot validate a later attested POSIX bank receipt",()=>{
 checkPriorBankFence({staleBoundary:true});
});
