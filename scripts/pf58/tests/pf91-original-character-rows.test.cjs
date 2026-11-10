'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('./pf54-fixture.cjs');
const {inspectOriginalCharacterShipRows,createOriginalPlayerShipActivation}=
 require('../native/coopPersonalFleetOriginalNativePermit.cjs');

const T='corporationRuntime',C='characters',ITEMS='items';
const another=90000002,secondShip=2002;
function withNativeCharacters(callback,{reserve=false}={}){
 const tmp=F.tempDb(),f=F.open(tmp.file);
 try{
  f.seed();
  if(reserve)f.onboard();
  // Real PF53/PF54 fixture already uses the native per-character SQL row.
  if(f.get(C,String(F.OWNER))?.characterID!==F.OWNER)
   throw Error('PF91_NATIVE_CHARACTER_FIXTURE_MISSING');
  return callback(f);
 }finally{f.close();tmp.cleanup();}
}
function inspected(f,owner=F.OWNER,ship=F.SHIP){
 return f.gameStore.coopAtomicNativeRows.transact([C],tx=>
  inspectOriginalCharacterShipRows(tx,{
   ownerCharacterID:owner,shipItemID:ship}));
}
test('PF91 native per-character SQLite rowset admits genuinely free original hull',()=>withNativeCharacters(f=>{
 const out=inspected(f);
 assert.equal(out.verified,true);
 assert.equal(out.checkedRows,1);
 assert.equal(out.status,'CLEAR_IN_SAME_TRANSACTION');
}));
test('PF91 old synthetic characters aggregate is never accepted as native evidence',()=>{
 const tmp=F.tempDb(),f=F.open(tmp.file);
 try{
   f.seed();
   const owner=f.get(C,String(F.OWNER));
   f.db.prepare('DELETE FROM "characters" WHERE key=?').run(String(F.OWNER));
   f.put(C,C,{[F.OWNER]:owner});
   assert.equal(inspected(f).reason,'PF91_ORIGINAL_CHARACTER_ROW_INVALID');
  }
 finally{f.close();tmp.cleanup();}
});
test('PF91 owner original active hull is rejected under same SQLite transaction',()=>withNativeCharacters(f=>{
 const c=f.get(C,String(F.OWNER));
 f.put(C,String(F.OWNER),{...c,shipID:F.SHIP});
 assert.equal(inspected(f).reason,'PF91_ORIGINAL_SHIP_ACTIVE_FOR_CHARACTER');
}));
test('PF91 foreign original character holding hull is rejected',()=>withNativeCharacters(f=>{
 f.put(C,String(another),{characterID:another,shipID:String(F.SHIP)});
 assert.equal(inspected(f).reason,'PF91_ORIGINAL_SHIP_ACTIVE_FOR_CHARACTER');
}));
test('PF91 unrelated foreign active hull does not block an available original hull',()=>withNativeCharacters(f=>{
 f.put(C,String(another),{characterID:another,shipID:secondShip});
 assert.equal(inspected(f).checkedRows,2);
}));
test('PF91 absent owner original row is an explicit blocker',()=>withNativeCharacters(f=>{
 f.db.prepare('DELETE FROM "characters" WHERE key=?').run(String(F.OWNER));
 assert.equal(inspected(f).reason,'PF91_ORIGINAL_CHARACTER_OWNER_MISSING');
}));
test('PF91 noncanonical SQLite character key is a blocker',()=>withNativeCharacters(f=>{
 f.put(C,'0002',{characterID:2,shipID:secondShip});
 assert.equal(inspected(f).reason,'PF91_ORIGINAL_CHARACTER_ROW_INVALID');
}));
test('PF91 mismatching original ID and row key is a blocker',()=>withNativeCharacters(f=>{
 f.put(C,String(another),{characterID:another+1,shipID:secondShip});
 assert.equal(inspected(f).reason,'PF91_ORIGINAL_CHARACTER_ROW_INVALID');
}));
test('PF91 unavailable scan and missing scan method are denied',()=>{
 for(const tx of [{get:()=>null},{get:()=>null,scan:()=>null},
  {get:()=>null,scan:()=>{throw Error('unreadable')}}]){
  const out=inspectOriginalCharacterShipRows(tx,{
   ownerCharacterID:F.OWNER,shipItemID:F.SHIP});
  assert.equal(out.verified,false);
 }
});
test('PF91 duplicate SQLite key from untrusted scan is not accepted',()=>{
 const c={characterID:F.OWNER,shipID:secondShip};
 const tx={get:()=>c,scan:()=>[
  {key:String(F.OWNER),value:c},{key:String(F.OWNER),value:c}]};
 assert.equal(inspectOriginalCharacterShipRows(tx,{
  ownerCharacterID:F.OWNER,shipItemID:F.SHIP}).reason,
  'PF91_ORIGINAL_CHARACTER_ROW_INVALID');
});
test('PF91 concurrent original owner changes after scan are detected',()=>{
 const a={characterID:F.OWNER,shipID:secondShip};
 const b={...a,shipName:'concurrent'};
 const tx={get:()=>b,scan:()=>[{key:String(F.OWNER),value:a}]};
 assert.equal(inspectOriginalCharacterShipRows(tx,{
  ownerCharacterID:F.OWNER,shipItemID:F.SHIP}).reason,
  'PF91_ORIGINAL_CHARACTER_OWNER_DRIFT');
});
function activate(f,{shipID=F.SHIP,stationID=F.STATION,expectedBefore=null,
                    live=()=>true, enabled=()=>true,writers=()=>true,
                    session={characterID:F.OWNER,stationID:F.STATION}}={}){
 const gate=createOriginalPlayerShipActivation({gameStore:f.gameStore,pf52:F.pf52,
  enabled,allWritersFenced:writers,
  verifyOriginalDockedPlayerSession:live});
 return gate.activate({characterID:F.OWNER,targetShipItemID:shipID,stationID,
  expectedBefore:expectedBefore||f.get(C,String(F.OWNER)),session});
}
test('PF91 original player activation updates only the one existing character row',()=>withNativeCharacters(f=>{
 const prior=f.get(C,String(F.OWNER)),beforeItems=f.scan(ITEMS);
 const result=activate(f);
 assert.equal(result.status,'APPLIED_IN_ORIGINAL_SQLITE_TRANSACTION');
 const updated=f.get(C,String(F.OWNER));
 assert.equal(updated.shipID,F.SHIP);
 assert.equal(updated.shipTypeID,606);
 assert.equal(updated.balance,prior.balance);
 assert.deepEqual(f.scan(ITEMS),beforeItems);
 assert.deepEqual(f.scan(C).map(x=>x.key),[String(F.OWNER)]);
}));
test('PF91 reserved original hull refuses stock player activation',()=>withNativeCharacters(f=>{
 const result=activate(f);
 assert.equal(result.reason,'PF88_PF52_SHIP_RESERVED');
 assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
},{reserve:true}));
test('PF91 native session witness absent by default denies stock player activation',()=>withNativeCharacters(f=>{
 const result=activate(f,{live:()=>false});
 assert.equal(result.reason,'PF91_ORIGINAL_PLAYER_SESSION_UNVERIFIED');
 assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
}));
test('PF91 late native player session revocation denies before active ship commit',()=>withNativeCharacters(f=>{
 let reads=0;
 const result=activate(f,{live:()=>++reads===1});
 assert.equal(result.reason,'PF91_ORIGINAL_PLAYER_SESSION_REVOKED');
 assert.equal(reads,2);
 assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
}));
test('PF91 wrong original station prevents activation',()=>withNativeCharacters(f=>{
 assert.equal(activate(f,{stationID:F.STATION+1}).reason,
  'PF91_PLAYER_TARGET_NOT_ORIGINAL_HANGAR');
}));
test('PF91 stale original character snapshot prevents activation',()=>withNativeCharacters(f=>{
 const stale=f.get(C,String(F.OWNER));
 f.put(C,String(F.OWNER),{...stale,shipName:'updated by someone else'});
 assert.equal(activate(f,{expectedBefore:stale}).reason,'PF91_CHARACTER_OWNER_SNAPSHOT_STALE');
 assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
}));
test('PF91 claimed target by unrelated original character prevents activation',()=>withNativeCharacters(f=>{
 f.put(C,String(another),{characterID:another,shipID:F.SHIP});
 assert.equal(activate(f).reason,'PF91_ORIGINAL_SHIP_ACTIVE_FOR_CHARACTER');
}));
test('PF91 original player activation must not mint a ship or change stock inventory',()=>withNativeCharacters(f=>{
 const keys=f.scan(ITEMS).map(x=>x.key);
 const out=activate(f);
 assert.equal(out.mayCommit,true);
 assert.deepEqual(f.scan(ITEMS).map(x=>x.key),keys);
}));
test('PF91 default-disabled source-bound guards forbid original character changes',()=>withNativeCharacters(f=>{
 assert.equal(activate(f,{enabled:()=>false}).reason,'PF91_PLAYER_ACTIVATION_DISABLED');
 assert.equal(activate(f,{writers:()=>false}).reason,'PF91_PLAYER_ACTIVATION_DISABLED');
}));
test('PF91 original SQLite fault after character put rolls back the entire ship switch',()=>withNativeCharacters(f=>{
 const before=f.get(C,String(F.OWNER));
 f.shared.failAfterPut=1;
 const outcome=activate(f);
 assert.equal(outcome.reason,'PF91_ORIGINAL_CHARACTER_TRANSACTION_FAILED');
 assert.deepEqual(f.get(C,String(F.OWNER)),before);
}));
test('PF91 previous active original stock ship is also fenced before switching',()=>withNativeCharacters(f=>{
 const original=f.get(ITEMS,String(F.SHIP));
 const next={...original,itemID:secondShip,locationID:F.STATION,flagID:4};
 f.put(ITEMS,String(secondShip),next);
 f.put(C,String(F.OWNER),{...f.get(C,String(F.OWNER)),shipID:F.SHIP});
 const out=activate(f,{shipID:secondShip});
 assert.equal(out.status,'APPLIED_IN_ORIGINAL_SQLITE_TRANSACTION');
 assert.equal(f.get(C,String(F.OWNER)).shipID,secondShip);
}));
