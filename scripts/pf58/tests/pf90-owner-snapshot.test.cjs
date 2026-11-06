'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,F}=require('./fixture.cjs');
const {createReciprocalWriterFence}=
 require('../native/coopPersonalFleetOriginalNativePermit.cjs');
const T='corporationRuntime',ITEMS='items';
const stockItem=(id,where=F.STATION)=>({
 itemID:id,typeID:34,categoryID:7,ownerID:F.OWNER,locationID:where,
 flagID:4,quantity:1,stacksize:1,singleton:0});
function fixture(fn,{reserved=false}={}){
 const temp=F.tempDb(),f=setup(temp.file);
 try{
  f.seed();
  if(reserved)f.onboard();
  const gate=createReciprocalWriterFence({pf52:F.pf52});
  return fn({f,gate});
 }finally{f.close();temp.cleanup();}
}
function run({f,gate},prepare,{writer='PLAYER',declaredItemIDs=null,before}={}){
 return f.gameStore.coopAtomicNativeRows.transact([T,ITEMS],tx=>{
  const expectedBefore=before===undefined?tx.get(ITEMS,ITEMS):before;
  const nextItems=structuredClone(expectedBefore);
  if(typeof prepare==='function')prepare(nextItems,tx);
  return gate.commitOriginalOwnerSnapshot({tx,writer,
   expectedBefore,nextItems,declaredItemIDs});
 });
}
const id=()=>String(F.SHIP);
test('PF90 original ItemStore owner commits changed original ship via one GameStore transaction',()=>fixture(h=>{
 const out=run(h,next=>{next[id()].itemName='A true original stock write'});
 assert.equal(out.status,'APPLIED_WITH_RECIPROCAL_CUSTODY');
 assert.deepEqual(out.changedItemIDs,[F.SHIP]);
 assert.equal(h.f.get(ITEMS,ITEMS)[id()].itemName,'A true original stock write');
}));
test('PF90 reserved original hull denies even an owner-scoped stock write',()=>fixture(h=>{
 const out=run(h,next=>{next[id()].itemName='Reservation bypass'});
 assert.equal(out.reason,'PF88_PF52_SHIP_RESERVED');
 assert.equal(h.f.get(ITEMS,ITEMS)[id()].itemName,undefined);
},{reserved:true}));
test('PF90 rejects stale before snapshot after a competing SQLite change',()=>fixture(h=>{
 const expected=h.f.get(ITEMS,ITEMS);
 const changed=structuredClone(expected);changed[id()].itemName='competitor';
 h.f.put(ITEMS,ITEMS,changed);
 const out=run(h,next=>{next[id()].itemName='stale writer';},{before:expected});
 assert.equal(out.reason,'PF90_ORIGINAL_OWNER_STALE_SNAPSHOT');
 assert.equal(h.f.get(ITEMS,ITEMS)[id()].itemName,'competitor');
}));
test('PF90 prevents duplicate stock actor regardless of declared original item IDs',()=>fixture(h=>{
 const out=run(h,next=>{next[id()].flagID=0;},{declaredItemIDs:[F.SHIP+1]});
 assert.equal(out.reason,'PF89_UNDECLARED_STOCK_ITEM_MUTATION');
 assert.equal(h.f.get(ITEMS,ITEMS)[id()].flagID,4);
}));
test('PF90 rejects stock mutation while original owner shell holds mutated preflight data',()=>fixture(h=>{
 const before=h.f.get(ITEMS,ITEMS);
 const bad=structuredClone(before);bad[id()].itemName='already changed outside tx';
 const result=h.f.gameStore.coopAtomicNativeRows.transact([T,ITEMS],tx=>
  h.gate.commitOriginalOwnerSnapshot({tx,writer:'PLAYER',
   expectedBefore:bad,nextItems:bad}));
 assert.equal(result.reason,'PF90_ORIGINAL_OWNER_STALE_SNAPSHOT');
 assert.equal(h.f.get(ITEMS,ITEMS)[id()].itemName,undefined);
}));
test('PF90 protects fitted original module updates',()=>fixture(h=>{
 const items=h.f.get(ITEMS,ITEMS);
 items['8710']=stockItem(8710,F.SHIP);
 h.f.put(ITEMS,ITEMS,items);
 const out=run(h,next=>{next['8710'].quantity=2});
 assert.equal(out.reason,'PF88_PF52_SHIP_RESERVED');
 assert.equal(h.f.get(ITEMS,ITEMS)['8710'].quantity,1);
},{reserved:true}));
test('PF90 rejects new cargo into reserved original ship',()=>fixture(h=>{
 const out=run(h,next=>{next['8711']=stockItem(8711,F.SHIP)});
 assert.equal(out.reason,'PF88_PF52_SHIP_RESERVED');
 assert.equal(h.f.get(ITEMS,ITEMS)['8711'],undefined);
},{reserved:true}));
test('PF90 unrelated original inventory remains writable despite PF52 reservation',()=>fixture(h=>{
 const items=h.f.get(ITEMS,ITEMS);
 items['8712']=stockItem(8712);
 h.f.put(ITEMS,ITEMS,items);
 const out=run(h,next=>{next['8712'].itemName='unrelated'});
 assert.equal(out.status,'APPLIED_WITH_RECIPROCAL_CUSTODY');
 assert.deepEqual(out.originalShipIDs,[]);
 assert.equal(h.f.get(ITEMS,ITEMS)['8712'].itemName,'unrelated');
},{reserved:true}));
test('PF90 new ship creation cannot use foreign writer stock snapshot',()=>fixture(h=>{
 const out=run(h,next=>{next['8713']={...next[id()],itemID:8713}});
 assert.equal(out.reason,'PF89_SHIP_CREATION_REQUIRES_ORIGINAL_ITEMSTORE');
 assert.equal(h.f.get(ITEMS,ITEMS)['8713'],undefined);
}));
test('PF90 does not allow mutation with malformed expected snapshot',()=>fixture(h=>{
 const out=h.f.gameStore.coopAtomicNativeRows.transact([T,ITEMS],tx=>
  h.gate.commitOriginalOwnerSnapshot({tx,writer:'PLAYER',expectedBefore:[],
   nextItems:tx.get(ITEMS,ITEMS)}));
 assert.equal(out.reason,'PF90_ORIGINAL_OWNER_SNAPSHOT_AUTHORITIES_REQUIRED');
}));
test('PF90 refuses native writer spoofed as unsupported owner',()=>fixture(h=>{
 const out=run(h,next=>{next[id()].itemName='fake owner'},{writer:'ADMIN'});
 assert.equal(out.reason,'PF90_ORIGINAL_OWNER_SNAPSHOT_AUTHORITIES_REQUIRED');
 assert.equal(h.f.get(ITEMS,ITEMS)[id()].itemName,undefined);
}));
test('PF90 rejects non-JSON next snapshot rather than truncating data',()=>fixture(h=>{
 const out=run(h,next=>{next[id()].customMarker=()=>true});
 assert.equal(out.reason,'PF90_ORIGINAL_OWNER_SNAPSHOT_UNREADABLE');
 assert.equal(h.f.get(ITEMS,ITEMS)[id()].customMarker,undefined);
}));
test('PF90 validates changing one ship and another unrelated item together',()=>fixture(h=>{
 const items=h.f.get(ITEMS,ITEMS);items['8714']=stockItem(8714);h.f.put(ITEMS,ITEMS,items);
 const out=run(h,next=>{
  next[id()].itemName='hidden';next['8714'].itemName='declared only';
 },{declaredItemIDs:[8714]});
 assert.equal(out.reason,'PF89_UNDECLARED_STOCK_ITEM_MUTATION');
 assert.equal(h.f.get(ITEMS,ITEMS)[id()].itemName,undefined);
},{reserved:true}));
test('PF90 repeated same stock snapshot does not fabricate a second item event',()=>fixture(h=>{
 const first=run(h,next=>{next[id()].itemName='once'});
 assert.equal(first.status,'APPLIED_WITH_RECIPROCAL_CUSTODY');
 const old=h.f.get(ITEMS,ITEMS);
 const again=run(h,next=>{next[id()].itemName='once'});
 assert.equal(again.status,'NOOP_IN_SAME_TRANSACTION');
 assert.deepEqual(h.f.get(ITEMS,ITEMS),old);
}));
test('PF90 no-op on a reserved hull does not fabricate a ship write',()=>fixture(h=>{
 const out=run(h,_next=>{});
 assert.equal(out.status,'NOOP_IN_SAME_TRANSACTION');
},{reserved:true}));
test('PF90 external transaction throws do not turn a stock write into success',()=>fixture(h=>{
 assert.throws(()=>h.f.gameStore.coopAtomicNativeRows.transact([T,ITEMS],tx=>{
  const before=tx.get(ITEMS,ITEMS),next=structuredClone(before);
  next[id()].itemName='rolled back';
  const out=h.gate.commitOriginalOwnerSnapshot({tx,writer:'PLAYER',
   expectedBefore:before,nextItems:next});
  assert.equal(out.status,'APPLIED_WITH_RECIPROCAL_CUSTODY');
  throw Error('PF90_TEST_FORCE_ROLLBACK');
 }),/PF90_TEST_FORCE_ROLLBACK/);
 assert.equal(h.f.get(ITEMS,ITEMS)[id()].itemName,undefined);
}));
