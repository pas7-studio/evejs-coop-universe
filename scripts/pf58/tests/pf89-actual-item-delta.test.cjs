'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,F}=require('./fixture.cjs');
const {createReciprocalWriterFence}=
 require('../native/coopPersonalFleetOriginalNativePermit.cjs');
const ITEMS='items',T='corporationRuntime';
function fixture(cb,{reserved=false}={}){
 const tmp=F.tempDb(),f=setup(tmp.file);
 try{
  f.seed();if(reserved)f.onboard();
  const gate=createReciprocalWriterFence({pf52:F.pf52});
  return cb({f,gate});
 }finally{f.close();tmp.cleanup();}
}
const stockItem=(id,locationID=F.STATION)=>({
 itemID:id,ownerID:F.OWNER,typeID:34,categoryID:7,
 locationID,flagID:4,quantity:1,singleton:0,stacksize:1});
function withExtra(f,entries){
 const items=f.get(ITEMS,ITEMS);
 for(const x of entries)items[String(x.itemID)]=x;
 f.put(ITEMS,ITEMS,items);
}
function gate(f,policy,buildNext,options={}){
 return f.gameStore.coopAtomicNativeRows.transact([T,ITEMS],tx=>
  policy.mutateOriginalItemsInTransaction({tx,writer:'PLAYER',
   buildNext,...options}));
}
const ship=()=>String(F.SHIP);
test('PF89 first-party original ship title edit commits when unreserved',()=>fixture(({f,gate:policy})=>{
 const before=f.get(ITEMS,ITEMS)[ship()];
 const result=gate(f,policy,next=>{next[ship()].itemName='Protected edit';return true;});
 assert.equal(result.status,'APPLIED_WITH_RECIPROCAL_CUSTODY');
 assert.deepEqual(result.changedItemIDs,[F.SHIP]);
 assert.deepEqual(result.originalShipIDs,[F.SHIP]);
 assert.equal(f.get(ITEMS,ITEMS)[ship()].itemName,'Protected edit');
 assert.equal(f.get(ITEMS,ITEMS)[ship()].itemID,before.itemID);
}));
test('PF89 reserved original ship edit is blocked without ANY stock mutation',()=>fixture(({f,gate:policy})=>{
 const result=gate(f,policy,next=>{next[ship()].itemName='Bypass attempt';return true;});
 assert.equal(result.reason,'PF88_PF52_SHIP_RESERVED');
 assert.equal(f.get(ITEMS,ITEMS)[ship()].itemName,undefined);
}),{reserved:true});
test('PF89 lying declared itemIDs cannot hide a reserved ship mutation',()=>fixture(({f,gate:policy})=>{
 withExtra(f,[stockItem(8011)]);
 const result=gate(f,policy,next=>{next[ship()].itemName='Wrong target';return true;},
  {declaredItemIDs:[8011]});
 assert.equal(result.reason,'PF89_UNDECLARED_STOCK_ITEM_MUTATION');
 assert.equal(f.get(ITEMS,ITEMS)[ship()].itemName,undefined);
}),{reserved:true});
test('PF89 lying declared itemIDs rejected for an otherwise clear ship too',()=>fixture(({f,gate:policy})=>{
 const result=gate(f,policy,next=>{next[ship()].itemName='Claimed other';return true;},
  {declaredItemIDs:[F.SHIP+1]});
 assert.equal(result.reason,'PF89_UNDECLARED_STOCK_ITEM_MUTATION');
 assert.equal(f.get(ITEMS,ITEMS)[ship()].itemName,undefined);
}));
test('PF89 matching declared IDs accepted for non-reserved stock ship',()=>fixture(({f,gate:policy})=>{
 const result=gate(f,policy,next=>{next[ship()].itemName='Declared';return true;},
  {declaredItemIDs:[F.SHIP]});
 assert.equal(result.status,'APPLIED_WITH_RECIPROCAL_CUSTODY');
 assert.equal(f.get(ITEMS,ITEMS)[ship()].itemName,'Declared');
}));
test('PF89 fitted module inside PF52 reserved hull cannot be modified',()=>fixture(({f,gate:policy})=>{
 withExtra(f,[stockItem(8012,F.SHIP)]);
 const result=gate(f,policy,next=>{next['8012'].stacksize=5;return true;});
 assert.equal(result.reason,'PF88_PF52_SHIP_RESERVED');
 assert.equal(f.get(ITEMS,ITEMS)['8012'].stacksize,1);
}),{reserved:true});
test('PF89 new cargo injected into reserved original hull is blocked',()=>fixture(({f,gate:policy})=>{
 const result=gate(f,policy,next=>{next['8013']=stockItem(8013,F.SHIP);return true;});
 assert.equal(result.reason,'PF88_PF52_SHIP_RESERVED');
 assert.equal(f.get(ITEMS,ITEMS)['8013'],undefined);
}),{reserved:true});
test('PF89 moved cargo FROM hangar INTO reserved original hull is blocked',()=>fixture(({f,gate:policy})=>{
 withExtra(f,[stockItem(8014)]);
 const result=gate(f,policy,next=>{next['8014'].locationID=F.SHIP;return true;});
 assert.equal(result.reason,'PF88_PF52_SHIP_RESERVED');
 assert.equal(f.get(ITEMS,ITEMS)['8014'].locationID,F.STATION);
}),{reserved:true});
test('PF89 removed item INSIDE reserved hull is blocked',()=>fixture(({f,gate:policy})=>{
 withExtra(f,[stockItem(8015,F.SHIP)]);
 const result=gate(f,policy,next=>{delete next['8015'];return true;});
 assert.equal(result.reason,'PF88_PF52_SHIP_RESERVED');
 assert.ok(f.get(ITEMS,ITEMS)['8015']);
}),{reserved:true});
test('PF89 unrelated warehouse item still writable when another ship reserved',()=>fixture(({f,gate:policy})=>{
 withExtra(f,[stockItem(8016)]);
 const result=gate(f,policy,next=>{next['8016'].itemName='Warehouse';return true;});
 assert.equal(result.status,'APPLIED_WITH_RECIPROCAL_CUSTODY');
 assert.deepEqual(result.originalShipIDs,[]);
 assert.equal(f.get(ITEMS,ITEMS)['8016'].itemName,'Warehouse');
}),{reserved:true});
test('PF89 mutation with NO affected root item is acknowledged as NOOP',()=>fixture(({f,gate:policy})=>{
 const result=gate(f,policy,_next=>true);
 assert.equal(result.status,'NOOP_IN_SAME_TRANSACTION');
 assert.deepEqual(result.changedItemIDs,[]);
}));
test('PF89 callback false returns BLOCKED without touching stock items',()=>fixture(({f,gate:policy})=>{
 const result=gate(f,policy,next=>{next[ship()].itemName='No ACK';return false;});
 assert.equal(result.reason,'PF89_BUILDER_NOT_SYNCHRONOUSLY_ACKED');
 assert.equal(f.get(ITEMS,ITEMS)[ship()].itemName,undefined);
}));
test('PF89 asynchronous callback is not interpreted as a committed mutation',()=>fixture(({f,gate:policy})=>{
 const result=gate(f,policy,async next=>{
  next[ship()].itemName='Promise untrusted';return true;});
 assert.equal(result.reason,'PF89_BUILDER_NOT_SYNCHRONOUSLY_ACKED');
 assert.equal(f.get(ITEMS,ITEMS)[ship()].itemName,undefined);
}));
test('PF89 builder exception aborts original SQLite transaction',()=>fixture(({f,gate:policy})=>{
 assert.throws(()=>gate(f,policy,next=>{
  next[ship()].itemName='Exception';throw Error('PF89_TEST_FAIL');
 }),/PF89_TEST_FAIL/);
 assert.equal(f.get(ITEMS,ITEMS)[ship()].itemName,undefined);
}));
test('PF89 malicious builder direct tx.put forces rollback even with false ack',()=>fixture(({f,policy:unused,gate:policy})=>{
 assert.throws(()=>f.gameStore.coopAtomicNativeRows.transact([T,ITEMS],tx=>
  policy.mutateOriginalItemsInTransaction({tx,writer:'PLAYER',
   buildNext:_next=>{
    const items=tx.get(ITEMS,ITEMS);
    items[ship()].itemName='Illegal tx direct write';
    tx.put(ITEMS,ITEMS,items);
    return false;
   }})),/PF89_STOCK_ITEMS_CHANGED_DURING_BUILDER_ROLLBACK/);
 assert.equal(f.get(ITEMS,ITEMS)[ship()].itemName,undefined);
}));
test('PF89 new independent ship creation needs original ItemStore creator',()=>fixture(({f,gate:policy})=>{
 const result=gate(f,policy,next=>{
  next['8020']={...next[ship()],itemID:8020,locationID:F.STATION};
  return true;
 });
 assert.equal(result.reason,'PF89_SHIP_CREATION_REQUIRES_ORIGINAL_ITEMSTORE');
 assert.equal(f.get(ITEMS,ITEMS)['8020'],undefined);
}));
test('PF89 non-canonical new item key fails closed',()=>fixture(({f,gate:policy})=>{
 const result=gate(f,policy,next=>{next['0001']=stockItem(1);return true;});
 assert.equal(result.reason,'PF89_NONCANONICAL_ORIGINAL_ITEM_KEY');
 assert.equal(f.get(ITEMS,ITEMS)['0001'],undefined);
}));
test('PF89 non-JSON inventory changes cannot silently omit extra metadata',()=>fixture(({f,gate:policy})=>{
 const result=gate(f,policy,next=>{
  next[ship()].customUnsafe=()=>true;return true;
 });
 assert.equal(result.reason,'PF89_NON_JSON_INVENTORY_MUTATION');
 assert.equal(f.get(ITEMS,ITEMS)[ship()].customUnsafe,undefined);
}));
test('PF89 invalid declared IDs never reach the stock writer',()=>fixture(({f,gate:policy})=>{
 for(const declaredItemIDs of [[0],[F.SHIP,F.SHIP],['8011'],new Array(1025).fill(1)]){
  const outcome=gate(f,policy,next=>{next[ship()].itemName='Wrong input';return true;},
   {declaredItemIDs});
  assert.equal(outcome.reason,'PF89_DECLARED_ITEMS_INVALID');
 }
 assert.equal(f.get(ITEMS,ITEMS)[ship()].itemName,undefined);
}));
test('PF89 cyclic future child-parent chain blocks instead of resolving as stock-free',()=>fixture(({f,gate:policy})=>{
 const result=gate(f,policy,next=>{
  next['8030']=stockItem(8030,8031);
  next['8031']=stockItem(8031,8030);
  return true;
 });
 assert.equal(result.reason,'PF89_NEW_ITEM_PARENT_UNVERIFIED');
 assert.equal(f.get(ITEMS,ITEMS)['8030'],undefined);
}));
test('PF89 covers moved item in another original ship even if declared source ID is unrelated',()=>fixture(({f,gate:policy})=>{
 withExtra(f,[stockItem(8040),stockItem(8041,F.SHIP)]);
 const result=gate(f,policy,next=>{
  next['8040'].locationID=F.SHIP;
  next['8041'].itemName='Hidden child';
  return true;
 },{declaredItemIDs:[8040,8041]});
 assert.equal(result.reason,'PF88_PF52_SHIP_RESERVED');
 assert.equal(f.get(ITEMS,ITEMS)['8040'].locationID,F.STATION);
}),{reserved:true});
