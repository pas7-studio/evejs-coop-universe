'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,F}=require('./fixture.cjs');
const {createNativeShipAdoption}=require('../native/coopPersonalFleetNativeShipAdoption.cjs');
function harness(callback){const tmp=F.tempDb(),f=setup(tmp.file);try{
 f.prepare();const state={engineFlag:true,permit:true,corp:F.EMPLOYER,
  profileType:606,scene:true,moduleRows:[],cargoRows:[],entityWrite:true,
  controllerWrite:true,materialize:true};
 const sceneEntities=new Map();
 const scene={systemID:F.SYSTEM,getEntityByID(id){return sceneEntities.get(id)||null}};
 const nativeRows={entity:null,controller:null};
 const store={
  getNativeEntity(){return nativeRows.entity;},getNativeController(){return nativeRows.controller;},
  listNativeModulesForEntity(){return state.moduleRows;},
  listNativeCargoForEntity(){return state.cargoRows;},
  upsertNativeEntity(record){nativeRows.entity=structuredClone(record);return {success:state.entityWrite}},
  upsertNativeController(record){nativeRows.controller=structuredClone(record);return {success:state.controllerWrite}}
 };
 const npcService={PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1:true,
  materializeStoredNativeController(_,shipID){
   if(!state.materialize)return {success:false};
   const record=nativeRows.entity;
   sceneEntities.set(shipID,{itemID:record.entityID,nativeNpc:true,ownerID:record.ownerID,
    fittedItems:[],nativeCargoItems:[]});
   return {success:true,data:{entity:sceneEntities.get(shipID),controller:nativeRows.controller}};
  }};
 const nativeScene={scenes:new Map([[F.SYSTEM,scene]])};
 const stockItems={findItemById:id=>f.get('items','items')?.[String(id)]||null};
 const adopt=createNativeShipAdoption({nativeStore:store,stockItems,npcService,
  spaceRuntime:nativeScene,
  resolveNativeProfile:()=>({profile:{shipTypeID:state.profileType,profileID:'stock-mine'},
   loadout:{loadoutID:'stock-itemstore'},behaviorProfile:{behaviorProfileID:'personal-safe'}}),
  resolveOwnerCorporation:()=>state.corp,
  verifyCommittedPermit:()=>state.permit&&f.handoff.inspect({assignmentID:F.ASSIGNMENT}).status==='CONSUMED',
  allWritersFenced:()=>f.shared.writers,enabled:()=>f.shared.enabled});
 f.native.adoptOriginalShipAsNpc=(row,ship)=>{
  const res=adopt.adoptOriginalShipAsNpc(row,ship);
  if(res.success){f.shared.scene={nativeNpc:true,shipItemID:row.shipItemID,entityID:row.shipItemID,
   controllerEntityID:row.shipItemID,ownerCharacterID:row.ownerCharacterID,
   pilotID:row.pilotID,systemID:row.systemID,assignmentID:row.assignmentID,
   generation:row.generation,alive:true,noDuplicatePhysicalEntity:true,
   fittingHash:row.fittingHash,cargoHash:row.cargoHash};}
  return res;
 };
 return callback({f,state,adopt,store,nativeRows,sceneEntities,npcService,nativeScene});
}finally{f.close();tmp.cleanup();}}
test('adopts exact existing physical original ship with zero new modules, cargo or entity IDs',()=>harness(({f,nativeRows,sceneEntities})=>{
 const result=f.pending();assert.equal(result.executorStatus,'REPORTED_COMPLETED');
 assert.equal(nativeRows.entity.entityID,F.SHIP);assert.equal(nativeRows.entity.ownerID,F.OWNER);
 assert.equal(nativeRows.entity.personalFleetOriginal,true);
 assert.equal(nativeRows.entity.selectionKind,'PERSONAL_FLEET');
 assert.equal(nativeRows.entity.selectionID,F.ASSIGNMENT);
 assert.equal(nativeRows.controller.selectionKind,'PERSONAL_FLEET');
 assert.equal(nativeRows.controller.selectionID,F.ASSIGNMENT);
 assert.equal(nativeRows.entity.selectionID,nativeRows.controller.selectionID);
 assert.equal(nativeRows.controller.runtimeKind,'nativeAmbient');
 assert.equal(nativeRows.controller.behaviorOverrides.allowWeapons,false);
 assert.deepEqual([...sceneEntities.keys()],[F.SHIP]);
 assert.equal(Object.keys(f.get('items','items')).length,1);
 assert.equal(f.bridge.reconcile(f.c).status,'ACTIVE');
}));
test('unpatched native engine fails before writing a native entity',()=>harness(({f,npcService,nativeRows})=>{
 npcService.PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1=false;
 assert.equal(f.pending().executorStatus,'UNVERIFIED');assert.equal(nativeRows.entity,null);
}));
test('native adoption refuses wrong ship profile to prevent hull substitution',()=>harness(({f,state,nativeRows})=>{
 state.profileType=607;f.pending();assert.equal(nativeRows.entity,null);
}));
test('native adoption refuses missing trusted permit',()=>harness(({f,state,nativeRows})=>{
 state.permit=false;f.pending();assert.equal(nativeRows.entity,null);
}));
test('native adoption refuses existing original entity',()=>harness(({f,nativeRows})=>{
 nativeRows.entity={entityID:F.SHIP};f.pending();assert.equal(nativeRows.entity.personalFleetOriginal,undefined);
}));
test('native adoption refuses existing controller',()=>harness(({f,nativeRows})=>{
 nativeRows.controller={entityID:F.SHIP};f.pending();assert.equal(nativeRows.entity,null);
}));
test('native adoption refuses native cargo collision',()=>harness(({f,state,nativeRows})=>{
 state.cargoRows=[{cargoID:1,entityID:F.SHIP}];f.pending();assert.equal(nativeRows.entity,null);
}));
test('native adoption refuses native module collision',()=>harness(({f,state,nativeRows})=>{
 state.moduleRows=[{moduleID:1,entityID:F.SHIP}];f.pending();assert.equal(nativeRows.entity,null);
}));
test('native adoption refuses unverified owner corporation',()=>harness(({f,state,nativeRows})=>{
 state.corp=null;f.pending();assert.equal(nativeRows.entity,null);
}));
test('native adoption refuses pre-existing live scene entity',()=>harness(({f,sceneEntities,nativeRows})=>{
 sceneEntities.set(F.SHIP,{itemID:F.SHIP});f.pending();assert.equal(nativeRows.entity,null);
}));
test('native adoption refuses engine writer fencing revoked after stock move',()=>harness(({f,nativeRows})=>{
 f.state.afterMove=()=>{f.shared.writers=false;};
 assert.equal(f.pending().executorStatus,'UNVERIFIED');assert.equal(nativeRows.entity,null);
}));
test('entity write accepted but controller write failed requires operator (no cascade)',()=>harness(({f,state,nativeRows})=>{
 state.controllerWrite=false;assert.equal(f.pending().executorStatus,'UNVERIFIED');
 assert.equal(nativeRows.entity.entityID,F.SHIP);assert.equal(f.state.attempts,1);
 assert.equal(f.handoff.inspect({assignmentID:F.ASSIGNMENT}).status,'CONSUMED');
}));
test('runtime materialization failure retains durable rows for manual recovery',()=>harness(({f,state,nativeRows,sceneEntities})=>{
 state.materialize=false;assert.equal(f.pending().executorStatus,'UNVERIFIED');
 assert.equal(nativeRows.entity.entityID,F.SHIP);assert.equal(nativeRows.controller.entityID,F.SHIP);
 assert.equal(sceneEntities.size,0);
}));
test('native adoption cannot operate on missing scene',()=>harness(({f,nativeScene,nativeRows})=>{
 nativeScene.scenes.clear();f.pending();assert.equal(nativeRows.entity,null);
}));
test('native adoption rejects malformed constructor',()=>{
 assert.throws(()=>createNativeShipAdoption({}),/DEPENDENCIES_REQUIRED/);
});
