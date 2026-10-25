import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {auditBanks}=require("../scripts/audit-npc-ammo-banks.cjs");
const {createAtomicAmmoBank,inspectShip,gate,verifyDirectDebit}=require("../integration/coopNpcAmmoBankAtomic.cjs");
const {createAmmoDebitJournal}=require("../integration/coopNpcAmmoDebitJournal.cjs");

const SEP="\u001f";
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"coop-bank-atomic-"));
 let state={
  npcEntities:{["entities"+SEP+"101"]:{entityID:101,ownerID:900,systemID:30000144}},
  npcModules:{
   ["modules"+SEP+"401"]:{moduleID:401,entityID:101,ownerID:900,typeID:123,categoryID:7,flagID:27},
   ["modules"+SEP+"402"]:{moduleID:402,entityID:101,ownerID:900,typeID:123,categoryID:7,flagID:28}
  },
  npcCargo:{cargo:{
   "501":{cargoID:501,entityID:101,moduleID:401,ownerID:900,typeID:35,categoryID:8,flagID:27,quantity:5},
   "502":{cargoID:502,entityID:101,moduleID:402,ownerID:900,typeID:35,categoryID:8,flagID:28,quantity:5}
  }}
 };
 const entity={kind:"ship",nativeNpc:true,itemID:101,ownerID:900,
  nativeCargoItems:[
   {itemID:501,moduleID:401,typeID:35,ownerID:900,quantity:5,stacksize:5},
   {itemID:502,moduleID:402,typeID:35,ownerID:900,quantity:5,stacksize:5}
  ]};
 const entries=[
  {moduleItem:{itemID:401,typeID:123,flagID:27},chargeItem:{itemID:501,typeID:35,quantity:5}},
  {moduleItem:{itemID:402,typeID:123,flagID:28},chargeItem:{itemID:502,typeID:35,quantity:5}}
 ];
 let calls=0,fault=null,readbackFail=false;
 const atomicRows={transact(tables,fn){
  ++calls;
  assert.deepEqual(tables,["npcEntities","npcModules","npcCargo"]);
  const next=structuredClone(state);
  const tx={get(t,k){return next[t][k]??null;},
   put(t,k,v){next[t][k]=structuredClone(v);},
   del(t,k){delete next[t][k];}};
  const result=fn(tx);
  if(fault==="rollback")throw Error("SQLITE_ROLLBACK");
  state=next;
  if(fault==="postcommit")throw Error("SQLITE_COMMIT_UNKNOWN");
  return result;
 }};
 const store={listNativeCargoForEntity(id){
  if(readbackFail)throw Error("NATIVE_STORE_READ_FAIL");
  return Object.values(state.npcCargo.cargo).filter(x=>x.entityID===id);
 }};
 const bank=createAtomicAmmoBank({root,atomicRows,store,
  compatible:()=>true,clock:()=>1500});
 return {root,entity,entries,bank,state:()=>state,calls:()=>calls,
  fault:x=>{fault=x;},readbackFail:x=>{readbackFail=x;},
  cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const fire=(f,opts={})=>f.bank.consume({entity:f.entity,entries:f.entries,whenMs:1000,...opts});
test("two turret barrels: all native cargo and replay fences commit atomically",()=>{
 const f=fixture();try{
  const result=fire(f);
  assert.equal(result.success,true);
  assert.equal(f.calls(),1);
  assert.equal(f.state().npcCargo.cargo["501"].quantity,4);
  assert.equal(f.state().npcCargo.cargo["502"].quantity,4);
  assert.equal(f.state().npcCargo.coopAmmoCycles_101.modules["401"],1000);
  assert.equal(f.state().npcCargo.coopAmmoCycles_101.modules["402"],1000);
  assert.deepEqual(result.results.map(x=>x.result.data.nextQuantity),[4,4]);
  assert.deepEqual(f.entity.nativeCargoItems.map(x=>x.quantity),[4,4]);
  assert.equal(inspectShip({root:f.root,entityID:101}).status,"COMMITTED");
 }finally{f.cleanup();}
});
test("invalid second barrel aborts every native cargo update inside SQLite transaction",()=>{
 const f=fixture();try{
  f.entries[1].chargeItem.quantity=4;
  const result=fire(f);
  assert.equal(result.success,false);
  assert.equal(f.state().npcCargo.cargo["501"].quantity,5);
  assert.equal(f.state().npcCargo.cargo["502"].quantity,5);
  assert.equal(f.state().npcCargo.coopAmmoCycles_101,undefined);
  assert.equal(inspectShip({root:f.root,entityID:101}).status,"BANK_LOCKED_RECONCILE");
  assert.equal(f.entity.nativeCargoItems[0].quantity,5);
 }finally{f.cleanup();}
});
test("SQLite rollback leaves no charge consumed and quarantines uncertain journal",()=>{
 const f=fixture();try{
  f.fault("rollback");
  assert.equal(fire(f).success,false);
  assert.equal(f.state().npcCargo.cargo["501"].quantity,5);
  assert.equal(f.state().npcCargo.cargo["502"].quantity,5);
  assert.equal(fire(f,{whenMs:1100}).success,false);
  assert.equal(f.calls(),1);
 }finally{f.cleanup();}
});
test("unknown post-COMMIT result never triggers another debit or refund",()=>{
 const f=fixture();try{
  f.fault("postcommit");
  assert.equal(fire(f).success,false);
  assert.equal(f.state().npcCargo.cargo["501"].quantity,4);
  assert.equal(f.state().npcCargo.cargo["502"].quantity,4);
  assert.equal(fire(f,{whenMs:1100}).success,false);
  assert.equal(f.calls(),1);
 }finally{f.cleanup();}
});
test("repeating a completed bank boundary does not quarantine an otherwise healthy ship",()=>{
 const f=fixture();try{
  assert.equal(fire(f).success,true);
  const repeated=fire(f);
  assert.equal(repeated.success,false);
  assert.equal(f.calls(),1);
  assert.equal(inspectShip({root:f.root,entityID:101}).status,"COMMITTED");
  f.entries.forEach(e=>{e.chargeItem.quantity=4;});
  assert.equal(fire(f,{whenMs:1100}).success,true);
  assert.equal(f.state().npcCargo.cargo["501"].quantity,3);
 }finally{f.cleanup();}
});
test("SQLite replay fence rejects old modules no longer listed by latest bank journal",()=>{
 const f=fixture();try{
  assert.equal(fire(f).success,true);
  f.entries[0].chargeItem.quantity=4;
  assert.equal(fire(f,{entries:[f.entries[0]],whenMs:1100}).success,true);
  // Latest ship journal now mentions only module 401. Module 402 is
  // still protected by its SQLite replay fence at boundary 1000.
  f.entries[1].chargeItem.quantity=4;
  const before=f.calls();
  const alternate=fire(f,{entries:[f.entries[1]],whenMs:1000});
  assert.equal(alternate.success,false);
  assert.equal(f.calls(),before+1,"must reach SQLite to check old module fence");
  assert.equal(f.state().npcCargo.cargo["502"].quantity,4);
  assert.equal(inspectShip({root:f.root,entityID:101}).ok,false);
 }finally{f.cleanup();}
});
test("native readback failure leaves DB debit but quarantines journal and never updates live cache",()=>{
 const f=fixture();try{
  f.readbackFail(true);
  assert.equal(fire(f).success,false);
  assert.equal(f.state().npcCargo.cargo["501"].quantity,4);
  assert.equal(f.entity.nativeCargoItems[0].quantity,5);
  assert.equal(inspectShip({root:f.root,entityID:101}).ok,false);
 }finally{f.cleanup();}
});
test("depletion deletes both native stacks and the in-scene cache only after commit",()=>{
 const f=fixture();try{
  for(const entry of f.entries){
   entry.chargeItem.quantity=1;
   f.state().npcCargo.cargo[String(entry.chargeItem.itemID)].quantity=1;
  }
  const result=fire(f);
  assert.equal(result.success,true);
  assert.equal(Object.keys(f.state().npcCargo.cargo).length,0);
  assert.equal(f.entity.nativeCargoItems.length,0);
  assert.deepEqual(result.results.map(x=>x.result.data.depleted),[true,true]);
 }finally{f.cleanup();}
});
test("missing or partial flags cannot enable the native atomic bank path",()=>{
 assert.equal(gate({EVEJS_COOP_NPC_STRICT_AMMO:"1",EVEJS_COOP_NPC_BANK_ATOMIC:"1"}),false);
 assert.equal(gate({EVEJS_COOP_NPC_STRICT_AMMO:"1",
  EVEJS_COOP_NPC_AMMO_DURABLE_CYCLE:"1",EVEJS_COOP_NPC_BANK_ATOMIC:"1",
  EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1"}),true);
});

test("operator audit is read-only for a committed bank receipt",()=>{
 const f=fixture();try{
  assert.equal(fire(f).success,true);
  const file=path.join(f.root,"bank-ships","101.json");
  const before=fs.readFileSync(file,"utf8");
  const audited=auditBanks({root:f.root});
  assert.equal(audited.status,"CLEAN");
  assert.equal(audited.counts.COMMITTED,1);
  assert.equal(fs.readFileSync(file,"utf8"),before);
 }finally{f.cleanup();}
});
test("operator audit reports a stranded bank PREPARED/lock and never repairs it",()=>{
 const f=fixture();try{
  f.fault("rollback");assert.equal(fire(f).success,false);
  const file=path.join(f.root,"bank-ships","101.json.lock");
  assert.equal(auditBanks({root:f.root}).counts.BANK_LOCKED_RECONCILE,1);
  assert.equal(fs.existsSync(file),true);
 }finally{f.cleanup();}
});

test("strict per-module fallback cannot bypass a ship that previously used atomic bank receipts",()=>{
 const f=fixture(),prior=process.env.EVEJS_COOP_NPC_BANK_ATOMIC;
 try{
  assert.equal(fire(f).success,true);
  delete process.env.EVEJS_COOP_NPC_BANK_ATOMIC;
  const store={
   getNativeEntity:()=>({entityID:101,ownerID:900,systemID:30000144}),
   listNativeCargoForEntity:()=>Object.values(f.state().npcCargo.cargo)
  };
  const journal=createAmmoDebitJournal({root:f.root,store});
  const result=journal.preflightBank({entity:f.entity,whenMs:1200,
   entries:[{moduleItem:{itemID:401}}]});
  assert.equal(result.status,"NATIVE_AMMO_ATOMIC_DOWNGRADE_FORBIDDEN");
 }finally{
  if(prior===undefined)delete process.env.EVEJS_COOP_NPC_BANK_ATOMIC;
  else process.env.EVEJS_COOP_NPC_BANK_ATOMIC=prior;
  f.cleanup();
 }
});

test("legacy direct debit is denied using authoritative SQLite history even if journal directory is deleted",()=>{
 const f=fixture();try{
  assert.equal(fire(f).success,true);
  // Simulates a misconfigured new journal mount: SQLite replay history remains.
  const emptyRoot=fs.mkdtempSync(path.join(os.tmpdir(),"coop-bank-new-root-"));
  try{
   const result=verifyDirectDebit({entity:f.entity,root:emptyRoot,
    env:{EVEJS_COOP_NPC_STRICT_AMMO:"1"},
    database:{read(table,key){
     assert.equal(table,"npcCargo");
     assert.equal(key,"/coopAmmoCycles_101");
     return {success:true,data:f.state().npcCargo.coopAmmoCycles_101};
    }}});
   assert.equal(result.status,"BANK_DIRECT_SQLITE_FENCE_PRESENT");
  }finally{fs.rmSync(emptyRoot,{recursive:true,force:true});}
 }finally{f.cleanup();}
});
test("strict native direct debit is denied by committed bank receipt even without a DB fence",()=>{
 const f=fixture();try{
  assert.equal(fire(f).success,true);
  const response=verifyDirectDebit({entity:f.entity,root:f.root,
   env:{EVEJS_COOP_NPC_STRICT_AMMO:"1"},
   database:{read(){throw Error("should not query DB after journal proof");}}});
  assert.equal(response.status,"BANK_DIRECT_RECEIPT_PRESENT");
 }finally{f.cleanup();}
});
test("direct ammo debit is allowed only after authoritative missing-history proof",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"coop-bank-empty-"));
 try{
  let reads=0;
  const entity={kind:"ship",nativeNpc:true,itemID:101,ownerID:900};
  const allowed=verifyDirectDebit({entity,root,env:{},
   database:{read(){reads++;return {success:false,errorMsg:"ENTRY_NOT_FOUND",data:null};}}});
  assert.equal(allowed.allowed,true);
  assert.equal(reads,1);
  const broken=verifyDirectDebit({entity,root,env:{},
   database:{read(){return {success:false,errorMsg:"READ_ERROR",data:null};}}});
  assert.equal(broken.allowed,false);
  assert.equal(broken.status,"BANK_DIRECT_NATIVE_READ_UNSAFE");
  const misconfigured=verifyDirectDebit({entity,root,
   env:{EVEJS_COOP_NPC_BANK_ATOMIC:"1"},
   database:{read(){throw Error("should not read");}}});
  assert.equal(misconfigured.status,"BANK_ATOMIC_DIRECT_DEBIT_FORBIDDEN");
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
