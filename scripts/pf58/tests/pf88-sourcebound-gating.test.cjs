'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('./pf54-fixture.cjs');
const {createSourceBoundNativeBootstrap}=
 require('../native/coopPersonalFleetNativeBootstrap.cjs');
const T='corporationRuntime';
test('PF88 genuine source-bound bootstrap remains DISABLED without independent original writer hook attestation',()=>{
 const tmp=F.tempDb(),f=F.open(tmp.file);
 try{
  f.seed();f.onboard();
  const command=F.command();
  assert.equal(f.bridge.prepare(command).status,'PREPARED');
  let stockMoves=0,originalHookReads=0;
  const nativeStore={
   getNativeEntity:()=>null,getNativeController:()=>null,
   listNativeModulesForEntity:()=>[],listNativeCargoForEntity:()=>[],
   upsertNativeEntity:()=>{throw Error('PF88_NO_NATIVE_ENTITY_WRITE')},
   upsertNativeController:()=>{throw Error('PF88_NO_NATIVE_CONTROLLER_WRITE')}
  };
  const scene={systemID:F.SYSTEM,getEntityByID:()=>null};
  const bootstrap=createSourceBoundNativeBootstrap({
   gameStore:f.gameStore,pf52:F.pf52,
   sessionRegistry:{getSessions:()=>[]},
   npcRegistry:{getControllerByEntityID:()=>null},
   originalItemStore:{
    findItemById:id=>f.get('items','items')?.[String(id)]||null,
    moveShipToSpace:()=>{stockMoves++;throw Error('PF88_LEGACY_MOVE_FORBIDDEN')}
   },
   nativeNpcStore:nativeStore,
   nativeNpcService:{PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1:true,
    materializeStoredNativeController:()=>{throw Error('PF88_NO_MATERIALIZATION')}},
   spaceRuntime:{scenes:new Map([[F.SYSTEM,scene]])},
   resolveNativeProfile:()=>({profile:{shipTypeID:606,profileID:'stock'},
    loadout:{loadoutID:'stock'},behaviorProfile:{behaviorProfileID:'safe'}}),
   resolveOwnerCorporation:()=>F.EMPLOYER,
   originalStationUndockPoint:r=>({stationID:r.stationID,systemID:r.systemID,
    position:{x:10,y:20,z:30},direction:{x:1,y:0,z:0},sessionless:true}),
   originalEquipmentWitness:()=>({fittingHash:F.FIT,cargoHash:F.CARGO}),
   originalOwnershipWitness:()=>true,
   independentOriginalActorWitness:()=>null,
   allWritersFenced:()=>true,
   verifyOriginalWriterHooks:()=>{originalHookReads++;return false},
   enabled:()=>true});
  assert.equal(typeof bootstrap.checkForeignWriterWithinTransaction,'function');
  assert.equal(typeof bootstrap.commitStockCharacterRecordWithinOriginalTransaction,'function');
  const blockedCharacterOwner=bootstrap.commitStockCharacterRecordWithinOriginalTransaction({
   tx:{get:()=>null,put:()=>{throw Error('PF92_DISABLED_OWNER_WRITE_ATTEMPT')}},
   characterID:F.OWNER,expectedBefore:{characterID:F.OWNER},
   nextRecord:{characterID:F.OWNER,balance:0}});
  assert.equal(blockedCharacterOwner.reason,'PF92_NATIVE_CHARACTER_OWNER_GATE_DISABLED');
  assert.equal(blockedCharacterOwner.mayCommit,false);
  f.shared.onHandoff=bootstrap.executeOriginalHandoff;
  const result=f.bridge.dispatch(command);
  assert.equal(result.executorStatus,'UNVERIFIED');
  assert.equal(stockMoves,0);
  assert.ok(originalHookReads>=1,'source-bound writer hook witness must be checked');
  assert.equal(f.get('items','items')[String(F.SHIP)].flagID,4);
  assert.equal(f.get(T,'coop-personal-fleet\u001fhandoff-v1:'+F.ASSIGNMENT),null);
  assert.equal(f.bridge.dispatch(command).status,'BLOCKED','PF54 attempt is never replayed');
 }finally{f.close();tmp.cleanup();}
});
