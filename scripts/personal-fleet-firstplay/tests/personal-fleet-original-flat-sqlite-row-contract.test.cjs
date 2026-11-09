'use strict';
/**
 * PF109: source-level native SQLite test with real PF52/PF58 original code,
 * but an isolated, synchronous in-memory transaction double. Original
 * Node/SQLite WORK tests and two-player gameplay are still necessary.
 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const pf52=require('../../pf52/native/coopPersonalFleetHangarBridge.cjs');
const pf58=require('../../pf58/native/coopPersonalFleetOriginalNativePermit.cjs');
const bootstrap=require('../../pf58/native/coopPersonalFleetNativeBootstrap.cjs');
const deep=x=>structuredClone(x);
const shipID=5001,ownerID=90000001,stationID=60000001,systemID=30000142;
const ship=()=>({itemID:shipID,ownerID,locationID:stationID,flagID:4,
 categoryID:6,typeID:606,singleton:1,stacksize:1,quantity:-1,spaceState:null});
const moduleItem=(id=7001,where=shipID)=>({itemID:id,ownerID,locationID:where,flagID:11,
 categoryID:7,typeID:500,singleton:1,stacksize:1,quantity:-1});
function fixture(){
 const table={items:new Map([[String(shipID),ship()],[String(7001),moduleItem()]]),
  corporationRuntime:new Map()};
 const trace=[];
 const tx=Object.freeze({
  get:(t,k)=>table[t]?.has(String(k))?deep(table[t].get(String(k))):null,
  put:(t,k,v)=>{assert.ok(table[t]);table[t].set(String(k),deep(v));
   trace.push({kind:'put',table:t,key:String(k)});},
  del:(t,k)=>{assert.ok(table[t]);table[t].delete(String(k));
   trace.push({kind:'del',table:t,key:String(k)});},
  scan:t=>{assert.ok(table[t]);return [...table[t]].map(([key,value])=>({key,value:deep(value)}));}
 });
 return {table,trace,tx};
}
function ownedReservation(){
 const idx=pf52.newIndex(),pilot='coop-pilot-123';
 const h='a'.repeat(64),contractID='pf109-contract-1';
 idx.pilots[pilot]={pilotID:pilot,ownerCharacterID:ownerID,contractID,
   hireReceiptHash:h};
 idx.contracts[contractID]=pilot;
 idx.generations[String(shipID)]=1;
 idx.ships[String(shipID)]={shipItemID:shipID,pilotID:pilot,
  ownerCharacterID:ownerID,stationID,assignmentID:'pf109-assignment',
  generation:1};
 pf52.validateIndex(idx);
 return idx;
}
test('PF109 original PF52 stock hangar resolves only canonical SQLite itemID row',()=>{
 const f=fixture();
 assert.equal(f.tx.get('items','items'),null);
 assert.equal(pf52.readStockHangar(f.tx,shipID,ownerID,stationID)?.itemID,shipID);
 assert.equal(pf52.readStockHangar(f.tx,shipID,ownerID+1,stationID),null);
 assert.equal(f.trace.length,0);
});
test('PF109 PF52 rejects forged items/items aggregate when physical ship row absent',()=>{
 const f=fixture();f.tx.del('items',String(shipID));
 f.tx.put('items','items',{[shipID]:ship()});
 assert.equal(pf52.readStockHangar(f.tx,shipID,ownerID,stationID),null);
});
test('PF109 PF58 native atomic transfer changes exactly original itemID SQL row',()=>{
 const f=fixture(),stock=ship(),row={shipItemID:shipID,ownerCharacterID:ownerID,
  stationID,systemID,typeID:stock.typeID};
 const spawn={stationID,systemID,sessionless:true,position:{x:1,y:2,z:3},
  direction:{x:1,y:0,z:0}};
 const x=bootstrap.moveOriginalShipToSpaceAtomically(row,spawn,f.tx);
 assert.equal(x.success,true);
 assert.deepEqual(f.trace,[{kind:'put',table:'items',key:String(shipID)}]);
 assert.equal(f.tx.get('items',String(shipID)).locationID,systemID);
 assert.equal(f.tx.get('items',String(shipID)).spaceState.systemID,systemID);
 assert.equal(f.tx.get('items','items'),null);
 assert.equal(f.tx.get('items',String(7001)).locationID,shipID);
});
test('PF109 PF58 original atomic title transfer refuses missing stock ship row',()=>{
 const f=fixture();f.tx.del('items',String(shipID));f.trace.length=0;
 const result=bootstrap.moveOriginalShipToSpaceAtomically({
  shipItemID:shipID,ownerCharacterID:ownerID,stationID,systemID,typeID:606
 },{stationID,systemID,sessionless:true,position:{x:0,y:0,z:0},
  direction:{x:1,y:0,z:0}},f.tx);
 assert.equal(result.success,false);
 assert.equal(result.errorMsg,'PF87_ATOMIC_HANGAR_TITLE_CHANGED');
 assert.deepEqual(f.trace,[]);
});
test('PF109 real PF58 reciprocal writer fence permits free original SQLite ship',()=>{
 const f=fixture(),fence=pf58.createReciprocalWriterFence({pf52});
 assert.equal(fence.inTransaction({tx:f.tx,writer:'PLAYER',shipItemID:shipID}).status,
  'CLEAR_IN_SAME_TRANSACTION');
 assert.deepEqual(f.trace,[]);
});
test('PF109 PF58 blocks edits to a reserved ship without a root SQL record',()=>{
 const f=fixture(),fence=pf58.createReciprocalWriterFence({pf52});
 f.tx.put('corporationRuntime',pf52.REGISTRY_KEY,ownedReservation());
 f.trace.length=0;
 const result=fence.inTransaction({tx:f.tx,writer:'MINING',affectedItemID:7001});
 assert.equal(result.reason,'PF88_PF52_SHIP_RESERVED');
 assert.deepEqual(f.trace,[]);
});
test('PF109 PF58 rejects a forged malformed unrelated original SQL item row',()=>{
 const f=fixture(),fence=pf58.createReciprocalWriterFence({pf52});
 f.tx.put('items','00042',moduleItem(42,stationID));f.trace.length=0;
 const result=fence.inTransaction({tx:f.tx,writer:'PLAYER',shipItemID:shipID});
 assert.equal(result.mayCommit,false);
 assert.equal(result.reason,'PF88_ORIGINAL_CUSTODY_READ_FAILED');
 assert.deepEqual(f.trace,[]);
});
test('PF109 PF89 reciprocal owner delta writes only added native itemID row',()=>{
 const f=fixture(),fence=pf58.createReciprocalWriterFence({pf52});
 const result=fence.mutateOriginalItemsInTransaction({tx:f.tx,writer:'INDUSTRY',
  declaredItemIDs:[7002],buildNext:root=>{
   root['7002']=moduleItem(7002,shipID);return true;
  }});
 assert.equal(result.mayCommit,true,JSON.stringify(result));
 assert.deepEqual(f.trace,[{kind:'put',table:'items',key:'7002'}]);
 assert.equal(f.tx.get('items','7002').itemID,7002);
 assert.equal(f.tx.get('items','items'),null);
});
test('PF109 PF89 reciprocal owner rejects unreported added itemID',()=>{
 const f=fixture(),fence=pf58.createReciprocalWriterFence({pf52});
 const result=fence.mutateOriginalItemsInTransaction({tx:f.tx,writer:'PLAYER',
  declaredItemIDs:[shipID],buildNext:root=>{
   root['7002']=moduleItem(7002);return true;
  }});
 assert.equal(result.reason,'PF89_UNDECLARED_STOCK_ITEM_MUTATION');
 assert.deepEqual(f.trace,[]);
});
test('PF109 PF89 reciprocal owner deletes exactly the physical old item row',()=>{
 const f=fixture(),fence=pf58.createReciprocalWriterFence({pf52});
 const result=fence.mutateOriginalItemsInTransaction({tx:f.tx,writer:'MARKET',
  declaredItemIDs:[7001],buildNext:root=>{delete root['7001'];return true;}});
 assert.equal(result.mayCommit,true,JSON.stringify(result));
 assert.deepEqual(f.trace,[{kind:'del',table:'items',key:'7001'}]);
 assert.equal(f.tx.get('items','7001'),null);
 assert.equal(f.tx.get('items',String(shipID)).itemID,shipID);
});
test('PF109 PF89 reciprocal owner blocks a changed reserved original child',()=>{
 const f=fixture(),fence=pf58.createReciprocalWriterFence({pf52});
 f.tx.put('corporationRuntime',pf52.REGISTRY_KEY,ownedReservation());
 f.trace.length=0;
 const result=fence.mutateOriginalItemsInTransaction({tx:f.tx,writer:'EXPLORATION',
  declaredItemIDs:[7001],buildNext:root=>{
   root['7001'].locationID=stationID;return true;
  }});
 assert.equal(result.mayCommit,false);
 assert.equal(result.reason,'PF88_PF52_SHIP_RESERVED');
 assert.deepEqual(f.trace,[]);
});
test('PF109 PF90 original stock owner snapshot checks actual flat-row preimage',()=>{
 const f=fixture(),fence=pf58.createReciprocalWriterFence({pf52});
 const old=Object.fromEntries(f.tx.scan('items').map(x=>[x.key,x.value]));
 const next=deep(old);next['7001'].flagID=12;
 const result=fence.commitOriginalOwnerSnapshot({tx:f.tx,writer:'PLAYER',
  expectedBefore:old,nextItems:next,declaredItemIDs:[7001]});
 assert.equal(result.mayCommit,true,JSON.stringify(result));
 assert.deepEqual(f.trace,[{kind:'put',table:'items',key:'7001'}]);
});
test('PF109 PF90 stale original stock snapshot rejects changed physical itemID',()=>{
 const f=fixture(),fence=pf58.createReciprocalWriterFence({pf52});
 const old=Object.fromEntries(f.tx.scan('items').map(x=>[x.key,x.value]));
 f.tx.put('items',String(shipID),{...ship(),flagID:0});f.trace.length=0;
 const next=deep(old);next['7001'].flagID=12;
 const result=fence.commitOriginalOwnerSnapshot({tx:f.tx,writer:'PLAYER',
  expectedBefore:old,nextItems:next,declaredItemIDs:[7001]});
 assert.equal(result.reason,'PF90_ORIGINAL_OWNER_STALE_SNAPSHOT');
 assert.deepEqual(f.trace,[]);
});
test('PF109 source owners have no remaining invented items/items reads/writes',()=>{
 const root=path.resolve(__dirname,'../..');
 const files=[
  'pf52/native/coopPersonalFleetHangarBridge.cjs',
  'pf54/native/coopPersonalFleetOriginalDeployment.cjs',
  'pf58/native/coopPersonalFleetOriginalDeployment.cjs',
  'pf58/native/coopPersonalFleetNativeBootstrap.cjs',
  'pf58/native/coopPersonalFleetOriginalShipHandoff.cjs',
  'pf58/native/coopPersonalFleetOriginalNativePermit.cjs',
  'pf57/native/coopPersonalFleetContractLifecycle.cjs',
  'personal-fleet-firstplay/native/coopPersonalFleetOriginalOrderWitness.js',
  'personal-fleet-firstplay/native/coopPersonalFleetOriginalSourceBindings.js',
  'personal-fleet-firstplay/native/coopPersonalFleetOriginalCombatAuthority.js',
  'personal-fleet-firstplay/native/coopPersonalFleetOriginalPhysicalRecovery.js',
  'personal-fleet-firstplay/native/coopPersonalFleetOriginalDockCompletionWitness.js',
  'personal-fleet-firstplay/native/coopPersonalFleetOriginalTerminalDockSources.js'
 ];
 for(const file of files){
  const source=fs.readFileSync(path.join(root,file),'utf8');
  assert.doesNotMatch(source,/tx\.get\(\s*['"]items['"]\s*,\s*['"]items['"]\s*\)/,file);
  assert.doesNotMatch(source,/tx\.put\(\s*['"]items['"]\s*,\s*['"]items['"]\s*,/,file);
  assert.doesNotMatch(source,/tx\.get\(\s*ITEMS\s*,\s*ITEMS\s*\)/,file);
 }
});
