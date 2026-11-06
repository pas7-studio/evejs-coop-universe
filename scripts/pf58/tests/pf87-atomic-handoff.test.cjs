'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,F}=require('./fixture.cjs');
const {createOriginalShipHandoff,validStockSpace}=require('../native/coopPersonalFleetOriginalShipHandoff.cjs');
const {moveOriginalShipToSpaceAtomically}=require('../native/coopPersonalFleetNativeBootstrap.cjs');

function fixture(action){
 const tmp=F.tempDb(),f=setup(tmp.file);
 try{
  f.prepare();
  let postCommitMoves=0,atomicMoves=0;
  const state={falseAck:false,throwAfterWrite:false,denyAtomic:false,
   sessionChecks:0,sessionOccupiedOnSecondRead:false};
  const native={
   ...f.native,
   noActivePlayerSession:()=>{
    state.sessionChecks++;
    return !(state.sessionOccupiedOnSecondRead&&state.sessionChecks>=2);
   },
   moveOriginalShipToSpace(){
    postCommitMoves++;
    throw Error('PF87_LEGACY_MOVE_FORBIDDEN');
   },
   moveOriginalShipToSpaceAtomically(row,spawn,tx){
    atomicMoves++;
    if(state.denyAtomic)return {success:false,errorMsg:'STOCK_WRITER_REFUSED'};
    const result=moveOriginalShipToSpaceAtomically(row,spawn,tx);
    if(state.throwAfterWrite)throw Error('PF87_INJECTED_ROLLBACK');
    if(state.falseAck)return {success:false,errorMsg:'PF87_INJECTED_FALSE_ACK'};
    return result;
   }
  };
  const handoff=createOriginalShipHandoff({gameStore:f.gameStore,
   pf52:F.pf52,native,requireAtomicOriginalTransfer:true,
   enabled:()=>f.shared.enabled,allWritersFenced:()=>f.shared.writers,
   verifyExclusive:()=>f.shared.exclusive,
   verifyOriginalEquipment:()=>({fittingHash:F.FIT,cargoHash:F.CARGO}),
   clock:()=>f.shared.clock});
  f.shared.onHandoff=row=>handoff.execute(row);
  return action({f,state,native,handoff,get postCommitMoves(){return postCommitMoves;},
   get atomicMoves(){return atomicMoves;}});
 }finally{f.close();tmp.cleanup();}
}
const originalShip=f=>f.get('items','items')?.[String(F.SHIP)];
const permit=f=>f.get('corporationRuntime',
 'coop-personal-fleet\u001fhandoff-v1:'+F.ASSIGNMENT);

test('PF87 atomic transfer commits permit and exact original ship in one SQLite transaction',()=>fixture(h=>{
 const beforeKeys=Object.keys(h.f.get('items','items')).sort();
 const beforeAccount=h.f.get('characters','characters')[String(F.OWNER)];
 const result=h.f.pending();
 assert.equal(result.executorStatus,'REPORTED_COMPLETED');
 assert.equal(h.atomicMoves,1);
 assert.equal(h.postCommitMoves,0);
 const row=h.f.get('corporationRuntime',
  'coop-personal-fleet\u001fdeploy-v1:'+F.ASSIGNMENT);
 assert.equal(validStockSpace(originalShip(h.f),row),true);
 assert.equal(permit(h.f).status,'CONSUMED');
 assert.deepEqual(Object.keys(h.f.get('items','items')).sort(),beforeKeys,
  'only original item ID may exist');
 assert.deepEqual(h.f.get('characters','characters')[String(F.OWNER)],beforeAccount,
  'title transfer must never debit wallet or silently reassign active ship');
 assert.equal(h.f.bridge.reconcile(h.f.c).status,'ACTIVE');
 assert.equal(h.f.pending().status,'BLOCKED');
 assert.equal(h.atomicMoves,1,'no replay or duplicate native stock move');
}));
test('PF87 false acknowledgment AFTER a stock row write rolls back whole SQLite transaction',()=>fixture(h=>{
 h.state.falseAck=true;
 assert.equal(h.f.pending().executorStatus,'UNVERIFIED');
 assert.equal(h.atomicMoves,1);
 assert.equal(h.postCommitMoves,0);
 assert.equal(permit(h.f),null,'consumed permit must roll back with original stock title');
 assert.equal(originalShip(h.f).locationID,F.STATION);
 assert.equal(originalShip(h.f).flagID,4);
 assert.equal(h.f.pending().status,'BLOCKED','PF54 ISSUING still prevents retry');
}));
test('PF87 thrown error AFTER stock write rolls back original title and permit',()=>fixture(h=>{
 h.state.throwAfterWrite=true;
 assert.equal(h.f.pending().executorStatus,'UNVERIFIED');
 assert.equal(permit(h.f),null);
 assert.equal(originalShip(h.f).locationID,F.STATION);
 assert.equal(h.postCommitMoves,0);
}));
test('PF87 reject callback before any mutation does not create permit or original stock change',()=>fixture(h=>{
 h.state.denyAtomic=true;
 assert.equal(h.f.pending().executorStatus,'UNVERIFIED');
 assert.equal(permit(h.f),null);
 assert.equal(originalShip(h.f).flagID,4);
 assert.equal(h.postCommitMoves,0);
}));
test('PF87 rejects the reserved original hull already active for its owner',()=>fixture(h=>{
 const users=h.f.get('characters','characters');
 users[String(F.OWNER)].shipID=F.SHIP;
 h.f.put('characters','characters',users);
 assert.equal(h.f.pending().executorStatus,'UNVERIFIED');
 assert.equal(h.atomicMoves,0);
 assert.equal(permit(h.f),null);
 assert.equal(originalShip(h.f).flagID,4);
}));
test('PF87 rejects a hull active for another original character',()=>fixture(h=>{
 const chars=h.f.get('characters','characters');
 chars['90000002']={characterID:90000002,shipID:String(F.SHIP)};
 h.f.put('characters','characters',chars);
 assert.equal(h.f.pending().executorStatus,'UNVERIFIED');
 assert.equal(h.atomicMoves,0);
 assert.equal(originalShip(h.f).locationID,F.STATION);
}));
test('PF87 rechecks session within SQLite transaction before touching original item',()=>fixture(h=>{
 h.state.sessionOccupiedOnSecondRead=true;
 assert.equal(h.f.pending().executorStatus,'UNVERIFIED');
 assert.equal(h.atomicMoves,0);
 assert.equal(permit(h.f),null);
 assert.equal(originalShip(h.f).locationID,F.STATION);
 assert.equal(h.postCommitMoves,0);
}));
test('PF87 atomic title writer rejects mismatched original source without tx.put',()=>{
 const source={itemID:F.SHIP,typeID:606,ownerID:F.OWNER,
  locationID:F.STATION,flagID:4,categoryID:6,singleton:1,stacksize:1,quantity:-1};
 const row={shipItemID:F.SHIP,typeID:606,ownerCharacterID:F.OWNER,
  stationID:F.STATION,systemID:F.SYSTEM};
 const spawn={stationID:F.STATION,systemID:F.SYSTEM,sessionless:true,
  position:{x:10,y:20,z:30},direction:{x:1,y:0,z:0}};
 let writes=0,items={[String(F.SHIP)]:{...source,spaceState:null}};
 const tx={get:()=>items,put(_table,_key,next){writes++;items=next;}};
 assert.equal(moveOriginalShipToSpaceAtomically(row,spawn,tx).success,true);
 assert.equal(writes,1);
 assert.equal(items[String(F.SHIP)].itemID,F.SHIP);
 assert.equal(items[String(F.SHIP)].locationID,F.SYSTEM);
 assert.equal(items[String(F.SHIP)].spaceState.mode,'STOP');
 assert.equal(items[String(F.SHIP)].spaceState.warpState,null);
 writes=0;
 const wrongStation={...spawn,stationID:F.STATION+1};
 assert.equal(moveOriginalShipToSpaceAtomically(row,wrongStation,tx).success,false);
 assert.equal(writes,0);
 items={[String(F.SHIP)]:{...source,spaceState:null,ownerID:F.OWNER+1}};
 assert.equal(moveOriginalShipToSpaceAtomically(row,spawn,tx).success,false);
 assert.equal(writes,0);
});
test('PF87 strict handoff refuses missing atomic original item authority',()=>fixture(h=>{
 assert.throws(()=>createOriginalShipHandoff({
  gameStore:h.f.gameStore,pf52:F.pf52,
  native:{...h.native,moveOriginalShipToSpaceAtomically:null},
  requireAtomicOriginalTransfer:true,
  verifyOriginalEquipment:()=>null}),/PF58_NATIVE_AUTHORITIES_REQUIRED/);
}));
