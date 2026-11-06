'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,F}=require('./fixture.cjs');
const {createReciprocalWriterFence}=require('../native/coopPersonalFleetOriginalNativePermit.cjs');

const T='corporationRuntime',ITEMS='items';
const ship=F.SHIP,owner=F.OWNER;
const indexKey=F.pf52.REGISTRY_KEY;
const p='coop-personal-fleet\u001f';
function run(callback){
 const tmp=F.tempDb(),f=setup(tmp.file);
 try{
  f.seed();
  const gate=createReciprocalWriterFence({pf52:F.pf52});
  return callback({f,gate,seeded:()=>f.onboard()});
 }finally{f.close();tmp.cleanup();}
}
function check(f,gate,opts={},mutate=false){
 return f.gameStore.coopAtomicNativeRows.transact([T,ITEMS],tx=>{
  const outcome=gate.inTransaction({tx,writer:'PLAYER',shipItemID:ship,...opts});
  if(outcome.mayCommit===true&&mutate){
   const root=tx.get(ITEMS,'items');
   tx.put(ITEMS,'items',{...root,[String(ship)]:{
    ...root[String(ship)],itemName:'PF88 mutation accepted'}});
  }
  return outcome;
 });
}
const noMutation=f=>f.get(ITEMS,'items')[String(ship)].itemName===undefined;

test('PF88 requires exact original PF52 source index authority',()=>{
 assert.throws(()=>createReciprocalWriterFence(),/PF88_ORIGINAL_PF52_INDEX_AUTHORITY_REQUIRED/);
 assert.throws(()=>createReciprocalWriterFence({pf52:{REGISTRY_KEY:'other',validateIndex:()=>true}}),
  /PF88_ORIGINAL_PF52_INDEX_AUTHORITY_REQUIRED/);
});
test('PF88 in-transaction original player ship write allowed when no fleet custody exists',()=>run(({f,gate})=>{
 const result=check(f,gate,{},true);
 assert.equal(result.status,'CLEAR_IN_SAME_TRANSACTION');
 assert.equal(result.mayCommit,true);
 assert.deepEqual(result.originalShipIDs,[ship]);
 assert.equal(f.get(ITEMS,'items')[String(ship)].itemName,'PF88 mutation accepted');
}));
test('PF88 reservation blocks player mutation before first NPC spawn',()=>run(({f,gate,seeded})=>{
 seeded();
 const result=check(f,gate,{},true);
 assert.equal(result.mayCommit,false);
 assert.equal(result.reason,'PF88_PF52_SHIP_RESERVED');
 assert.ok(noMutation(f));
}));
test('PF88 all foreign native writer kinds deny a reserved original hull',()=>run(({f,gate,seeded})=>{
 seeded();
 for(const writer of ['PLAYER','MINING','WAR','EXPLORATION','MARKET','INDUSTRY']){
  const result=f.gameStore.coopAtomicNativeRows.transact([T,ITEMS],
   tx=>gate.inTransaction({tx,writer,shipItemID:ship}));
  assert.equal(result.reason,'PF88_PF52_SHIP_RESERVED',writer);
 }
 assert.ok(noMutation(f));
}));
test('PF88 release of PF52 registry alone cannot recycle durable handoff ship lock',()=>run(({f,gate,seeded})=>{
 seeded();
 f.put(T,indexKey,F.pf52.newIndex());
 f.put(T,p+'handoff-ship-v1:'+ship,{assignmentID:F.ASSIGNMENT,
  sourcePF54Hash:'a'.repeat(64)});
 assert.equal(check(f,gate).reason,'PF88_ONE_SHOT_OR_TERMINAL_CUSTODY');
 assert.ok(noMutation(f));
}));
test('PF88 terminal original ship still blocked until independently reconciled',()=>run(({f,gate})=>{
 f.put(T,p+'terminal-ship-v1:'+ship,{assignmentID:F.ASSIGNMENT});
 assert.equal(check(f,gate).reason,'PF88_ONE_SHOT_OR_TERMINAL_CUSTODY');
 assert.ok(noMutation(f));
}));
test('PF88 live original actor claim prevents every foreign ship change',()=>run(({f,gate})=>{
 const root=F.claimsPolicy.empty();
 root.generations[String(ship)]=1;
 root.claims[String(ship)]={entityID:ship,ownerType:'PERSONAL_FLEET',
  pilotID:F.PILOT,ownerCharacterID:owner,systemID:F.SYSTEM,
  assignmentID:F.ASSIGNMENT,generation:1};
 f.put(T,p+'actor-claims-v1',root);
 assert.equal(check(f,gate).reason,'PF88_NATIVE_ACTOR_CLAIMED');
 assert.ok(noMutation(f));
}));
test('PF88 corruption anywhere in PF52 global registry fails closed',()=>run(({f,gate})=>{
 f.put(T,indexKey,{version:1,ships:{x:{shipItemID:2008}},
  pilots:{},contracts:{},generations:{},processed:{}});
 assert.equal(check(f,gate).reason,'PF88_HANGAR_CUSTODY_CORRUPT');
 assert.ok(noMutation(f));
}));
test('PF88 corrupt actor index globally fails closed for unrelated ship',()=>run(({f,gate})=>{
 f.put(T,p+'actor-claims-v1',{version:1,claims:{bad:{}},
   generations:{},processed:{}});
 assert.equal(check(f,gate).reason,'PF88_ACTOR_CLAIMS_CORRUPT');
 assert.ok(noMutation(f));
}));
test('PF88 missing atomic getter or mutator cannot authorize stock write',()=>{
 const gate=createReciprocalWriterFence({pf52:F.pf52});
 for(const tx of [null,{get:()=>null},{put:()=>null}]){
  const result=gate.inTransaction({tx,writer:'PLAYER',shipItemID:ship});
  assert.equal(result.mayCommit,false);
  assert.equal(result.reason,'PF88_WRITER_TRANSACTION_REQUIRED');
 }
});
test('PF88 invalid writer or ID cannot authorize a stock mutation',()=>run(({f,gate})=>{
 for(const request of [
  {writer:'PERSONAL_FLEET',shipItemID:ship},
  {writer:'PLAYER',shipItemID:0},
  {writer:'PLAYER',shipItemID:'2001'},
  {writer:'PLAYER'},
  {writer:'PLAYER',affectedItemID:0},
 ]){
  const result=f.gameStore.coopAtomicNativeRows.transact([T,ITEMS],
   tx=>gate.inTransaction({tx,...request}));
  assert.equal(result.mayCommit,false,JSON.stringify(request));
 }
}));
test('PF88 rejects direct ship ID that does not identify original stock ship',()=>run(({f,gate})=>{
 const result=check(f,gate,{shipItemID:ship+88});
 assert.equal(result.reason,'PF88_SHIP_ID_NOT_ORIGINAL_STOCK');
}));
test('PF88 guard covers fitted modules/cargo nested in reserved hull',()=>run(({f,gate,seeded})=>{
 seeded();
 const root=f.get(ITEMS,'items');
 root['5000']={itemID:5000,ownerID:owner,categoryID:7,typeID:34,
  locationID:ship,flagID:11,quantity:-1,singleton:1,stacksize:1};
 root['5001']={itemID:5001,ownerID:owner,categoryID:8,typeID:35,
  locationID:5000,flagID:5,quantity:1,singleton:0,stacksize:1};
 f.put(ITEMS,'items',root);
 for(const id of [5000,5001]){
  const result=f.gameStore.coopAtomicNativeRows.transact([T,ITEMS],tx=>
   gate.inTransaction({tx,writer:'PLAYER',affectedItemID:id}));
  assert.equal(result.reason,'PF88_PF52_SHIP_RESERVED');
 }
}));
test('PF88 insertion into reserved hull blocks even if original cargo is elsewhere',()=>run(({f,gate,seeded})=>{
 seeded();
 const result=f.gameStore.coopAtomicNativeRows.transact([T,ITEMS],tx=>
  gate.inTransaction({tx,writer:'PLAYER',destinationLocationID:ship}));
 assert.equal(result.reason,'PF88_PF52_SHIP_RESERVED');
}));
test('PF88 no original ship parent allows unrelated hangar item changes in same transaction',()=>run(({f,gate,seeded})=>{
 seeded();
 const root=f.get(ITEMS,'items');
 root['8001']={itemID:8001,ownerID:owner,typeID:34,categoryID:7,
  locationID:F.STATION,flagID:4,quantity:1,singleton:0,stacksize:1};
 f.put(ITEMS,'items',root);
 const result=f.gameStore.coopAtomicNativeRows.transact([T,ITEMS],tx=>
  gate.inTransaction({tx,writer:'PLAYER',affectedItemID:8001}));
 assert.equal(result.status,'CLEAR_IN_SAME_TRANSACTION');
 assert.deepEqual(result.originalShipIDs,[]);
}));
test('PF88 missing source item is not silently treated as a station destination',()=>run(({f,gate})=>{
 const result=f.gameStore.coopAtomicNativeRows.transact([T,ITEMS],tx=>
  gate.inTransaction({tx,writer:'PLAYER',affectedItemID:8000088}));
 assert.equal(result.reason,'PF88_PARENT_CHAIN_UNVERIFIED');
 const station=f.gameStore.coopAtomicNativeRows.transact([T,ITEMS],tx=>
  gate.inTransaction({tx,writer:'PLAYER',destinationLocationID:F.STATION}));
 assert.equal(station.status,'CLEAR_IN_SAME_TRANSACTION');
}));
test('PF88 cyclic item parent chain never counts as a proven empty custody path',()=>run(({f,gate})=>{
 const root=f.get(ITEMS,'items');
 root['8001']={itemID:8001,ownerID:owner,typeID:34,categoryID:7,
  locationID:8002,flagID:11,quantity:1,singleton:0,stacksize:1};
 root['8002']={itemID:8002,ownerID:owner,typeID:34,categoryID:7,
  locationID:8001,flagID:11,quantity:1,singleton:0,stacksize:1};
 f.put(ITEMS,'items',root);
 const result=f.gameStore.coopAtomicNativeRows.transact([T,ITEMS],tx=>
  gate.inTransaction({tx,writer:'PLAYER',affectedItemID:8001}));
 assert.equal(result.reason,'PF88_PARENT_CHAIN_UNVERIFIED');
}));
test('PF88 undefined original claim read fails closed rather than accepting absence',()=>{
 const gate=createReciprocalWriterFence({pf52:F.pf52});
 const items={[String(ship)]:{itemID:ship,ownerID:owner,locationID:F.STATION,categoryID:6}};
 let reads=0;
 const tx={get(table,key){
  if(table==='items')return items;
  if(key===indexKey)return undefined;
  reads++;
  return null;
 },put(){}};
 const outcome=gate.inTransaction({tx,writer:'PLAYER',shipItemID:ship});
 assert.equal(outcome.reason,'PF88_ORIGINAL_CUSTODY_READ_UNCERTAIN');
});
