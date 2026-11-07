'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,F}=require('./fixture.cjs');
const {createNativeBootstrap}=require('../native/coopPersonalFleetNativeBootstrap.cjs');
const bindings=require('../native/coopPersonalFleetNativeBindings.cjs');
test('PF58 boot refuses missing native source patch before installing bindings',()=>{
 assert.throws(()=>createNativeBootstrap({}),/AUTHORITIES_REQUIRED/);
 assert.equal(bindings.isInstalled(),false);
});
test('PF58 original bootstrap wires PF54 one-shot handoff through original ItemStore, NPC service and independent proof',()=>{
 const tmp=F.tempDb(),f=setup(tmp.file);try{
  f.prepare();
  const entities=new Map();let nativeEntity=null,nativeController=null;
  const mounted={systemID:F.SYSTEM,getEntityByID:id=>entities.get(id)||null};
  const spaceRuntime={scenes:new Map([[F.SYSTEM,mounted]])};
  const store={
   getNativeEntity:()=>nativeEntity,getNativeController:()=>nativeController,
   listNativeModulesForEntity:()=>[],listNativeCargoForEntity:()=>[],
   upsertNativeEntity:v=>{nativeEntity=structuredClone(v);return {success:true}},
   upsertNativeController:v=>{nativeController=structuredClone(v);return {success:true}}
  };
  const npcService={PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1:true,
   materializeStoredNativeController(scene,id,options){
    assert.equal(options.personalFleetIssuing,true);
    assert.equal(bindings.authorize(nativeEntity,{allowIssuing:true}),true);
    assert.equal(nativeEntity.entityID,id);
    const item={itemID:id,nativeNpc:true,ownerID:F.OWNER,kind:'ship'};
    entities.set(id,item);
    f.shared.scene={nativeNpc:true,shipItemID:id,entityID:id,controllerEntityID:id,
     ownerCharacterID:F.OWNER,pilotID:F.PILOT,systemID:F.SYSTEM,
     assignmentID:F.ASSIGNMENT,generation:1,alive:true,
     noDuplicatePhysicalEntity:true,fittingHash:F.FIT,cargoHash:F.CARGO};
    return {success:true,data:{entity:item,controller:nativeController}};
   }};
  const originalItemStore={
   findItemById:id=>f.get('items','items')?.[String(id)]||null,
   moveShipToSpace(id,systemID,spaceState){
    return f.gameStore.coopAtomicNativeRows.transact(['items'],tx=>{
     const items=tx.get('items','items'),s=items?.[String(id)];
     if(!s||s.flagID!==4)return {success:false};
     tx.put('items','items',{...items,[String(id)]:{...s,locationID:systemID,
       flagID:0,spaceState}});
     return {success:true};
    });
   }
  };
  const adapter=createNativeBootstrap({gameStore:f.gameStore,pf52:F.pf52,
   originalItemStore,nativeNpcStore:store,nativeNpcService:npcService,
   spaceRuntime,
   resolveNativeProfile:()=>({profile:{shipTypeID:606,profileID:'mine'},
    loadout:{loadoutID:'stock'},behaviorProfile:{behaviorProfileID:'safe'}}),
   resolveOwnerCorporation:()=>F.EMPLOYER,
   originalStationUndockPoint:row=>({stationID:row.stationID,systemID:row.systemID,
    position:{x:10,y:20,z:30},direction:{x:1,y:0,z:0},sessionless:true}),
   originalNoActiveSession:()=>true,
   originalNoPhysicalActor:()=>entities.size===0,
   originalEquipmentWitness:()=>({fittingHash:F.FIT,cargoHash:F.CARGO}),
   originalOwnershipWitness:()=>true,
   independentOriginalActorWitness:f.native.inspectOriginalActor,
   allWritersFenced:()=>f.shared.writers,
   enabled:()=>f.shared.enabled});
  f.shared.onHandoff=adapter.executeOriginalHandoff;
  const dispatch=f.pending();assert.equal(dispatch.executorStatus,'REPORTED_COMPLETED');
  assert.equal(nativeEntity.entityID,F.SHIP);
  assert.equal(nativeController.entityID,F.SHIP);
  assert.equal(f.get('items','items')[F.SHIP].flagID,0);
  assert.equal(f.bridge.reconcile(f.c).status,'ACTIVE');
  assert.equal(adapter.verifyNativePermit({entityRecord:nativeEntity}),true);
  assert.equal(adapter.inspectHandoff({assignmentID:F.ASSIGNMENT}).status,'CONSUMED');
  assert.equal(bindings.authorize(nativeEntity),true);
  assert.equal(f.pending().status,'BLOCKED');
 }finally{f.close();tmp.cleanup();}
});
