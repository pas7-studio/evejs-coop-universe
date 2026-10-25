import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createAmmoDebitJournal}=require("../integration/coopNpcAmmoDebitJournal.cjs");
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"coop-npc-ammo-wal-"));
 let quantity=5;
 const ship={entityID:101,ownerID:900,systemID:30000144};
 const rows=[{cargoID:501,entityID:101,moduleID:401,ownerID:900,
  typeID:35,flagID:27,categoryID:8,quantity:5}];
 const store={getNativeEntity:()=>ship,
  listNativeCargoForEntity:()=>rows.map(r=>({...r}))};
 const make=()=>createAmmoDebitJournal({root,store,clock:()=>1000000});
 const args=(other={})=>({
  entity:{kind:"ship",nativeNpc:true,itemID:101,ownerID:900},
  moduleItem:{itemID:401,flagID:27},
  chargeItem:{itemID:501,typeID:35,quantity},
  quantity:1,whenMs:1000,...other
 });
 const debit=(to)=>{quantity=to;
  if(to===0)rows.splice(0);
  else rows[0].quantity=to};
 const state=()=>JSON.parse(fs.readFileSync(
  path.join(root,"ships","101","401.json"),"utf8"));
 const cleanup=()=>fs.rmSync(root,{recursive:true,force:true});
 return {root,store,make,args,debit,state,rows,cleanup};
}
test("native ammo journal PREPARED is durable before debit, COMMITTED after verified store",()=>{
 const f=fixture();try{
  const journal=f.make(),begin=journal.begin(f.args());
  assert.equal(begin.status,"PREPARED");
  assert.equal(f.state().phase,"PREPARED");
  assert.equal(f.state().beforeQuantity,5);
  assert.equal(f.state().afterQuantity,4);
  assert.equal(journal.inspect({entityID:101,moduleID:401}).status,
   "LOCKED_RECONCILE");
  f.debit(4);
  const committed=journal.commit(begin.token);
  assert.equal(committed.status,"NATIVE_AMMO_DEBIT_COMMITTED");
  assert.equal(f.state().phase,"COMMITTED");
  assert.equal(journal.inspect({entityID:101,moduleID:401}).status,"COMMITTED");
 }finally{f.cleanup();}
});
test("same boundary or older replay across journal re-instantiation never debits twice",()=>{
 const f=fixture();try{
  const j=f.make(),x=j.begin(f.args());f.debit(4);
  assert.equal(j.commit(x.token).ok,true);
  assert.equal(f.make().begin(f.args({whenMs:1000,
   chargeItem:{itemID:501,typeID:35,quantity:4}})).status,
   "NATIVE_AMMO_CYCLE_REPLAY");
  assert.equal(f.make().begin(f.args({whenMs:999,
   chargeItem:{itemID:501,typeID:35,quantity:4}})).status,
   "NATIVE_AMMO_CYCLE_REPLAY");
 }finally{f.cleanup();}
});
test("later boundary can debit real source again using exactly same native module",()=>{
 const f=fixture();try{
  const j=f.make(),a=j.begin(f.args());f.debit(4);
  assert.equal(j.commit(a.token).ok,true);
  const b=f.make().begin(f.args({whenMs:1100,
   chargeItem:{itemID:501,typeID:35,quantity:4}}));
  assert.equal(b.status,"PREPARED");f.debit(3);
  assert.equal(f.make().commit(b.token).status,"NATIVE_AMMO_DEBIT_COMMITTED");
  assert.equal(f.state().boundaryMs,1100);
 }finally{f.cleanup();}
});
test("crash after PREPARED before authoritative debit blocks replay permanently",()=>{
 const f=fixture();try{
  assert.equal(f.make().begin(f.args()).status,"PREPARED");
  assert.equal(f.make().begin(f.args({whenMs:1100})).status,
   "NATIVE_AMMO_CYCLE_NEEDS_RECONCILIATION");
  assert.equal(f.rows[0].quantity,5);
 }finally{f.cleanup();}
});
test("crash after debit before COMMITTED never automatically spends another charge",()=>{
 const f=fixture();try{
  const begin=f.make().begin(f.args());
  assert.equal(begin.ok,true);f.debit(4);
  const retry=f.make().begin(f.args({whenMs:1100,
   chargeItem:{itemID:501,typeID:35,quantity:4}}));
  assert.equal(retry.status,"NATIVE_AMMO_CYCLE_NEEDS_RECONCILIATION");
  assert.equal(f.rows[0].quantity,4);
 }finally{f.cleanup();}
});
test("confirmed native stock missing after fake successful write refuses settlement",()=>{
 const f=fixture();try{
  const begin=f.make().begin(f.args());
  assert.equal(begin.ok,true);
  assert.equal(f.make().commit(begin.token).status,
   "NATIVE_AMMO_COMMIT_STOCK_MISMATCH");
  assert.equal(f.state().phase,"PREPARED");
  assert.equal(f.make().inspect({entityID:101,moduleID:401}).lockExists,true);
 }finally{f.cleanup();}
});
test("full depletion commits only after the true native cargo row disappears",()=>{
 const f=fixture();try{
  f.debit(1);
  const one=f.make().begin(f.args({
   chargeItem:{itemID:501,typeID:35,quantity:1},whenMs:1000}));
  assert.equal(one.ok,true);
  assert.equal(f.make().commit(one.token).ok,false);
  f.debit(0);
  assert.equal(f.make().commit(one.token).status,
   "NATIVE_AMMO_DEBIT_COMMITTED");
  assert.equal(f.state().afterQuantity,0);
 }finally{f.cleanup();}
});
test("stale exclusive writer lock blocks later debit even with a committed receipt",()=>{
 const f=fixture();try{
  const one=f.make().begin(f.args());f.debit(4);
  assert.equal(f.make().commit(one.token).ok,true);
  const lock=path.join(f.root,"ships","101","401.json.lock");
  fs.writeFileSync(lock,"stale");
  assert.equal(f.make().begin(f.args({whenMs:1200,
   chargeItem:{itemID:501,typeID:35,quantity:4}})).status,
   "NATIVE_AMMO_JOURNAL_UNSAFE");
 }finally{f.cleanup();}
});
test("corrupted receipt cannot be overwritten or silently skipped",()=>{
 const f=fixture();try{
  const folder=path.join(f.root,"ships","101");
  fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,"401.json"),"{invalid json");
  assert.equal(f.make().begin(f.args()).status,
   "NATIVE_AMMO_JOURNAL_UNSAFE");
  assert.equal(f.make().inspect({entityID:101,moduleID:401}).status,
   "CORRUPT_RECONCILE");
 }finally{f.cleanup();}
});
test("parallel attempts cannot acquire the same module writer lock",()=>{
 const f=fixture();try{
  const first=f.make().begin(f.args());
  assert.equal(first.ok,true);
  const second=f.make().begin(f.args());
  assert.equal(second.ok,false);
  assert.equal(f.state().phase,"PREPARED");
 }finally{f.cleanup();}
});
test("wrong ship owner or wrong credited type cannot settle any cargo debit",()=>{
 const f=fixture();try{
  const first=f.make().begin(f.args());f.debit(4);
  f.rows[0].typeID=99;
  assert.equal(f.make().commit(first.token).status,
   "NATIVE_AMMO_COMMIT_STOCK_MISMATCH");
  f.rows[0].typeID=35;f.rows[0].ownerID=901;
  assert.equal(f.make().commit(first.token).ok,false);
 }finally{f.cleanup();}
});
test("tampered commit token cannot authorize a different native cargo or barrel",()=>{
 const f=fixture();try{
  const first=f.make().begin(f.args());f.debit(4);
  const forged={...first.token,cargoID:502};
  assert.equal(f.make().commit(forged).status,
   "NATIVE_AMMO_COMMIT_LOCK_LOST");
  assert.equal(f.state().phase,"PREPARED");
 }finally{f.cleanup();}
});
test("invalid time, cargo amount or module cannot create a journal",()=>{
 const f=fixture();try{
  assert.equal(f.make().begin(f.args({whenMs:0})).ok,false);
  assert.equal(f.make().begin(f.args({
   moduleItem:{itemID:0,flagID:27}})).ok,false);
  assert.equal(f.make().begin(f.args({quantity:6})).ok,false);
  assert.equal(f.make().inspect({entityID:101,moduleID:401}).status,"EMPTY");
 }finally{f.cleanup();}
});

test("lost or replaced exclusive writer lock cannot commit ambiguous native debit",()=>{
 const f=fixture();try{
  const j=f.make(),first=j.begin(f.args());f.debit(4);
  const lock=path.join(f.root,"ships","101","401.json.lock");
  fs.unlinkSync(lock);
  assert.equal(j.commit(first.token).status,"NATIVE_AMMO_COMMIT_UNSAFE");
  fs.writeFileSync(lock,JSON.stringify({entityID:101,moduleID:401,
   cargoID:501,boundaryMs:1000,pid:999999}));
  assert.equal(j.commit(first.token).status,"NATIVE_AMMO_COMMIT_LOCK_LOST");
  assert.equal(f.state().phase,"PREPARED");
 }finally{f.cleanup();}
});

test("entire bank is blocked before first new debit if another barrel has uncertain PREPARED",()=>{
 const f=fixture();try{
  const j=f.make(),first=j.begin(f.args());
  assert.equal(first.ok,true);f.debit(4);
  assert.equal(j.commit(first.token).ok,true);
  f.rows.push({cargoID:502,entityID:101,moduleID:402,ownerID:900,
   typeID:35,flagID:27,categoryID:8,quantity:5});
  const pending=j.begin(f.args({
   moduleItem:{itemID:402,flagID:27},
   chargeItem:{itemID:502,typeID:35,quantity:5},
   whenMs:1000
  }));
  assert.equal(pending.status,"PREPARED");
  const bank=j.preflightBank({
   entity:f.args().entity,
   entries:[{moduleItem:{itemID:401}},{moduleItem:{itemID:402}}],
   whenMs:1100
  });
  assert.equal(bank.ok,false);
  assert.equal(bank.status,"NATIVE_AMMO_BANK_NEEDS_RECONCILIATION");
  assert.equal(bank.moduleID,402);
  assert.equal(f.rows[0].quantity,4,"first barrel must not be charged again");
 }finally{f.cleanup();}
});

test("whole-bank preflight rejects replay of any committed barrel before spending",()=>{
 const f=fixture();try{
  const j=f.make(),first=j.begin(f.args());
  f.debit(4);assert.equal(j.commit(first.token).ok,true);
  const entry={entity:f.args().entity,
   entries:[{moduleItem:{itemID:402}},{moduleItem:{itemID:401}}]};
  assert.equal(j.preflightBank({...entry,whenMs:1000}).status,
   "NATIVE_AMMO_BANK_REPLAY");
  assert.equal(j.preflightBank({...entry,whenMs:1100}).status,
   "NATIVE_AMMO_BANK_READY");
  assert.equal(f.rows[0].quantity,4);
 }finally{f.cleanup();}
});

test("orphaned receipt temp marks a committed bank unsafe until operator review",()=>{
 const f=fixture();try{
  const j=f.make(),one=j.begin(f.args());
  f.debit(4);assert.equal(j.commit(one.token).ok,true);
  const dir=path.join(f.root,"ships","101");
  fs.writeFileSync(path.join(dir,"401.json.tmp-333-2"),"uncertain");
  assert.equal(j.inspect({entityID:101,moduleID:401}).status,
   "ORPHAN_TEMP_RECONCILE");
  const bank=j.preflightBank({entity:f.args().entity,
   entries:[{moduleItem:{itemID:401}}],whenMs:1200});
  assert.equal(bank.status,"NATIVE_AMMO_BANK_NEEDS_RECONCILIATION");
  assert.equal(bank.reason,"ORPHAN_TEMP_RECONCILE");
  assert.equal(f.rows[0].quantity,4);
 }finally{f.cleanup();}
});

test("bank identity and repeated module IDs fail closed",()=>{
 const f=fixture();try{
  const j=f.make();
  assert.equal(j.preflightBank({entity:f.args().entity,entries:[],whenMs:1200}).ok,false);
  assert.equal(j.preflightBank({entity:f.args().entity,
   entries:[{moduleItem:{itemID:401}},{moduleItem:{itemID:401}}],
   whenMs:1200}).status,"NATIVE_AMMO_BANK_DUPLICATE_MODULE");
  const one=j.begin(f.args());f.debit(4);
  assert.equal(j.commit(one.token).ok,true);
  assert.equal(j.preflightBank({
   entity:{itemID:101,ownerID:901},
   entries:[{moduleItem:{itemID:401}}],whenMs:1200
  }).status,"NATIVE_AMMO_BANK_IDENTITY_MISMATCH");
 }finally{f.cleanup();}
});

test("unloaded pending weapon still quarantines entire ship before a new bank debit",()=>{
 const f=fixture();try{
  const j=f.make(),first=j.begin(f.args());
  f.debit(4);assert.equal(j.commit(first.token).ok,true);
  const pending=j.begin(f.args({moduleItem:{itemID:402,flagID:27},
   chargeItem:{itemID:502,typeID:35,quantity:5}}));
  assert.equal(pending.status,"PREPARED");
  // Simulate gun 402 no longer listed among active weapon-bank members.
  const result=j.preflightBank({entity:f.args().entity,
   entries:[{moduleItem:{itemID:401}}],whenMs:1200});
  assert.equal(result.status,"NATIVE_AMMO_BANK_NEEDS_RECONCILIATION");
  assert.equal(result.moduleID,402);
  assert.equal(f.rows[0].quantity,4);
 }finally{f.cleanup();}
});

test("unexpected journal filename fails the ship-wide preflight closed",()=>{
 const f=fixture();try{
  const j=f.make(),one=j.begin(f.args());f.debit(4);
  assert.equal(j.commit(one.token).ok,true);
  fs.writeFileSync(path.join(f.root,"ships","101","401.json.tmp-UNKNOWN"),"bad");
  const result=j.preflightBank({entity:f.args().entity,
   entries:[{moduleItem:{itemID:401}}],whenMs:1100});
  assert.equal(result.status,"NATIVE_AMMO_BANK_UNKNOWN_FILE");
  assert.equal(f.rows[0].quantity,4);
 }finally{f.cleanup();}
});
