'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('./pf54-fixture.cjs');
const {createOriginalCharacterRecordWriteBarrier}=
 require('../native/coopPersonalFleetOriginalNativePermit.cjs');
const C='characters',I='items',T='corporationRuntime',OTHER=2002,FOREIGN=90000002;
const clone=x=>structuredClone(x);
const item=(f,id)=>({...f.get(I,String(F.SHIP)),itemID:id});
function fixture(fn,{reserved=false}={}){
 const tmp=F.tempDb(),f=F.open(tmp.file);
 try{
  f.seed();if(reserved)f.onboard();
  const owner=f.get(C,String(F.OWNER));
  if(!owner||owner.characterID!==F.OWNER)
   throw Error('PF92_NATIVE_PF54_OWNER_UNAVAILABLE');
  return fn(f);
 }finally{f.close();tmp.cleanup();}
}
function commit(f,modify,{lease=()=>false,before=null,
                         characterID=F.OWNER,session=null}={}){
 const barrier=createOriginalCharacterRecordWriteBarrier({
  pf52:F.pf52,verifyOriginalSessionLease:lease});
 return f.gameStore.coopAtomicNativeRows.transact([T,I,C],tx=>{
  const base=before??tx.get(C,String(characterID));
  const next=clone(base);
  modify?.(next,tx);
  return barrier.inTransaction({tx,characterID,expectedBefore:base,
   nextRecord:next,session});
 });
}
function assertNoSelection(f){assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);}
test('PF92 generic original character writer updates unrelated wallet without a ship-session lease',()=>fixture(f=>{
 const output=commit(f,next=>{next.balance+=57;});
 assert.equal(output.status,'APPLIED_ORIGINAL_CHARACTER_ROW');
 assert.equal(output.protectedChange,false);
 assert.equal(f.get(C,String(F.OWNER)).balance,5057);
 assertNoSelection(f);
}));
test('PF92 no-op character snapshot does not issue a second database write',()=>fixture(f=>{
 const result=commit(f,_next=>{});
 assert.equal(result.status,'NOOP_IN_SAME_TRANSACTION');
 assert.equal(result.protectedChange,false);
}));
test('PF92 rejects stale original account snapshot even for unrelated wallet mutation',()=>fixture(f=>{
 const old=clone(f.get(C,String(F.OWNER)));
 f.put(C,String(F.OWNER),{...old,balance:5200});
 const result=commit(f,n=>{n.balance=1;},{before:old});
 assert.equal(result.reason,'PF92_CHARACTER_BEFORE_IMAGE_STALE');
 assert.equal(f.get(C,String(F.OWNER)).balance,5200);
}));
test('PF92 original shipID update without independent session lease fails closed',()=>fixture(f=>{
 const result=commit(f,next=>{next.shipID=F.SHIP;next.shipTypeID=606;});
 assert.equal(result.reason,'PF92_CHARACTER_SESSION_LEASE_REQUIRED');
 assertNoSelection(f);
}));
test('PF92 source-bound lease permits exactly one original character row update',()=>fixture(f=>{
 const prior=f.get(I,'items'),res=commit(f,next=>{
  next.shipID=F.SHIP;next.shipTypeID=606;
 },{lease:()=>true});
 assert.equal(res.status,'APPLIED_ORIGINAL_CHARACTER_ROW');
 assert.equal(res.protectedChange,true);
 assert.equal(f.get(C,String(F.OWNER)).shipID,F.SHIP);
 assert.deepEqual(f.get(I,'items'),prior);
 assert.deepEqual(f.scan(C).map(r=>r.key),[String(F.OWNER)]);
}));
test('PF92 conflicting alias fields cannot hide a second active ship',()=>fixture(f=>{
 const res=commit(f,next=>{
  next.shipID=F.SHIP;next.activeShipID=OTHER;
 },{lease:()=>true});
 assert.equal(res.reason,'PF92_CHARACTER_ACTIVE_SHIP_ALIAS_INVALID');
 assertNoSelection(f);
}));
test('PF92 noncanonical original shipID cannot quietly create invalid player title',()=>fixture(f=>{
 const res=commit(f,next=>{next.shipID='02001';},{lease:()=>true});
 assert.equal(res.reason,'PF92_CHARACTER_ACTIVE_SHIP_ALIAS_INVALID');
 assertNoSelection(f);
}));
test('PF92 rejected PF52 reserved physical hull does not become active for player',()=>fixture(f=>{
 const res=commit(f,next=>{next.shipID=F.SHIP;next.shipTypeID=606;},
  {lease:()=>true});
 assert.equal(res.reason,'PF88_PF52_SHIP_RESERVED');
 assertNoSelection(f);
},{reserved:true}));
test('PF92 foreign original character active on hull blocks new character title',()=>fixture(f=>{
 f.put(C,String(FOREIGN),{characterID:FOREIGN,shipID:String(F.SHIP)});
 const res=commit(f,next=>{next.shipID=F.SHIP;},{lease:()=>true});
 assert.equal(res.reason,'PF91_ORIGINAL_SHIP_ACTIVE_FOR_CHARACTER');
 assertNoSelection(f);
}));
test('PF92 proposed ship type must match real physical original ItemStore hull',()=>fixture(f=>{
 const res=commit(f,next=>{next.shipID=F.SHIP;next.shipTypeID=42;},
  {lease:()=>true});
 assert.equal(res.reason,'PF92_CHARACTER_SHIP_TYPE_MISMATCH');
 assertNoSelection(f);
}));
test('PF92 proposed shipName may not overwrite a different physical item name',()=>fixture(f=>{
 const items=f.get(I,'items');items[String(F.SHIP)].itemName='Original Hull';
 f.put(I,'items',items);
 const res=commit(f,next=>{
  next.shipID=F.SHIP;next.shipTypeID=606;next.shipName='Forged';
 },{lease:()=>true});
 assert.equal(res.reason,'PF92_CHARACTER_SHIP_NAME_MISMATCH');
 assertNoSelection(f);
}));
test('PF92 can move from one original stock hull to another under one owner',()=>fixture(f=>{
 const items=f.get(I,'items');items[String(OTHER)]=item(f,OTHER);f.put(I,'items',items);
 const owner=f.get(C,String(F.OWNER));
 f.put(C,String(F.OWNER),{...owner,shipID:F.SHIP,shipTypeID:606});
 const result=commit(f,next=>{next.shipID=OTHER;},{lease:()=>true});
 assert.equal(result.status,'APPLIED_ORIGINAL_CHARACTER_ROW');
 assert.equal(f.get(C,String(F.OWNER)).shipID,OTHER);
}));
test('PF92 previous reserved hull cannot be abandoned to bypass custody',()=>fixture(f=>{
 const items=f.get(I,'items');items[String(OTHER)]=item(f,OTHER);f.put(I,'items',items);
 const owner=f.get(C,String(F.OWNER));
 f.put(C,String(F.OWNER),{...owner,shipID:F.SHIP,shipTypeID:606});
 const result=commit(f,next=>{next.shipID=OTHER;},{lease:()=>true});
 assert.equal(result.reason,'PF88_PF52_SHIP_RESERVED');
 assert.equal(f.get(C,String(F.OWNER)).shipID,F.SHIP);
},{reserved:true}));
test('PF92 in-place physical ship metadata repair is valid for original active owner',()=>fixture(f=>{
 const items=f.get(I,'items');items[String(F.SHIP)].itemName='Real hull';
 f.put(I,'items',items);
 const owner=f.get(C,String(F.OWNER));
 f.put(C,String(F.OWNER),{...owner,shipID:F.SHIP,shipTypeID:606,shipName:'Old'});
 const result=commit(f,next=>{next.shipName='Real hull';},{lease:()=>true});
 assert.equal(result.status,'APPLIED_ORIGINAL_CHARACTER_ROW');
 assert.equal(f.get(C,String(F.OWNER)).shipName,'Real hull');
}));
test('PF92 in-place metadata repair still rejects second character holding hull',()=>fixture(f=>{
 const owner=f.get(C,String(F.OWNER));
 f.put(C,String(F.OWNER),{...owner,shipID:F.SHIP,shipTypeID:606});
 f.put(C,String(FOREIGN),{characterID:FOREIGN,shipID:F.SHIP});
 const result=commit(f,next=>{next.shipName='Repair';},{lease:()=>true});
 assert.equal(result.reason,'PF91_ORIGINAL_SHIP_ACTIVE_FOR_CHARACTER');
}));
test('PF92 retained shipID requires a lease to remove legacy storedShips metadata',()=>fixture(f=>{
 const owner=f.get(C,String(F.OWNER));
 f.put(C,String(F.OWNER),{...owner,shipID:F.SHIP,storedShips:[]});
 const denied=commit(f,next=>{delete next.storedShips;});
 assert.equal(denied.reason,'PF92_CHARACTER_SESSION_LEASE_REQUIRED');
 const allowed=commit(f,next=>{delete next.storedShips;},{lease:()=>true});
 assert.equal(allowed.status,'APPLIED_ORIGINAL_CHARACTER_ROW');
}));
test('PF92 missing physical original item cannot be adopted via a character row',()=>fixture(f=>{
 const result=commit(f,next=>{next.shipID=999999;},{lease:()=>true});
 assert.equal(result.reason,'PF92_CHARACTER_SHIP_TITLE_UNVERIFIED');
 assertNoSelection(f);
}));
test('PF92 characterID mismatch is rejected before any stock mutation',()=>fixture(f=>{
 const result=commit(f,next=>{next.characterID=F.OWNER+3;},
  {lease:()=>true});
 assert.equal(result.reason,'PF92_CHARACTER_OWNER_IDENTITY_INVALID');
 assertNoSelection(f);
}));
test('PF92 malformed non-JSON original character record is rejected',()=>fixture(f=>{
 const result=commit(f,next=>{next.bad=()=>true;},{lease:()=>true});
 assert.equal(result.reason,'PF92_CHARACTER_SNAPSHOT_UNSERIALIZABLE');
}));
test('PF92 false late session witness blocks the change after an earlier successful witness',()=>fixture(f=>{
 let n=0;
 const result=commit(f,next=>{next.shipID=F.SHIP;},
  {lease:()=>++n===1});
 assert.equal(result.reason,'PF92_CHARACTER_SESSION_LEASE_REVOKED');
 assert.equal(n,2);
 assertNoSelection(f);
}));
test('PF92 original session witness never receives a writable GameStore tx',()=>fixture(f=>{
 let calls=0;
 const result=commit(f,next=>{next.shipID=F.SHIP;},{lease:(_w,reader)=>{
  calls++;assert.equal(reader.put,undefined);assert.equal(reader.del,undefined);
  assert.equal(reader.get('items',String(F.SHIP)).itemID,F.SHIP);
  return true;
 }});
 assert.equal(calls,2);
 assert.equal(result.status,'APPLIED_ORIGINAL_CHARACTER_ROW');
}));
test('PF92 original SQLite put failure causes rollback, not a partial character title',()=>fixture(f=>{
 const before=f.get(C,String(F.OWNER));
 f.shared.failAfterPut=1;
 assert.throws(()=>commit(f,next=>{next.shipID=F.SHIP;},
  {lease:()=>true}),/PF92_CHARACTER_TRANSACTION_ABORT/);
 assert.deepEqual(f.get(C,String(F.OWNER)),before);
}));
test('PF92 session witness throwing after ownership check forces rollback',()=>fixture(f=>{
 assert.throws(()=>commit(f,next=>{next.shipID=F.SHIP;},
  {lease:()=>{throw Error('TEST_SESSION_OWNER_FAILURE')}}),
  /PF92_CHARACTER_TRANSACTION_ABORT/);
 assertNoSelection(f);
}));
test('PF92 old active hull alias corruption denies a wallet plus ship metadata write',()=>fixture(f=>{
 const old=f.get(C,String(F.OWNER));
 f.put(C,String(F.OWNER),{...old,shipID:F.SHIP,shipid:OTHER});
 const before=f.get(C,String(F.OWNER));
 const result=commit(f,next=>{next.shipName='Changed';},{lease:()=>true});
 assert.equal(result.reason,'PF92_CHARACTER_ACTIVE_SHIP_ALIAS_INVALID');
 assert.deepEqual(f.get(C,String(F.OWNER)),before);
}));

test('PF92 first failed witness cannot commit a captured direct character tx.put',()=>fixture(f=>{
 let captured=null;
 const original=f.get(C,String(F.OWNER));
 assert.throws(()=>commit(f,(next,tx)=>{
  captured=tx;next.shipID=F.SHIP;
 },{lease:()=>{
  captured.put(C,String(F.OWNER),{...original,shipID:999999});
  return false;
 }}),/PF93_SESSION_WITNESS_MUTATED_ORIGINAL_SQLITE_ROLLBACK/);
 assert.deepEqual(f.get(C,String(F.OWNER)),original);
}));
test('PF92 second witness cannot change original physical ship and then fail',()=>fixture(f=>{
 let captured=null,n=0;
 const original=f.get(I,'items');
 assert.throws(()=>commit(f,(next,tx)=>{
  captured=tx;next.shipID=F.SHIP;
 },{lease:()=>{
  if(++n===2){
   const stock=captured.get(I,'items');
   stock[String(F.SHIP)].ownerID=FOREIGN;
   captured.put(I,'items',stock);
   return false;
  }
  return true;
 }}),/PF93_SESSION_WITNESS_MUTATED_ORIGINAL_SQLITE_ROLLBACK/);
 assert.deepEqual(f.get(I,'items'),original);
 assertNoSelection(f);
}));
