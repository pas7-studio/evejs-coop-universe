'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalPhysicalRecovery.js'),'utf8');
const SEP='\u001f',P='coop-personal-fleet'+SEP,SHIP=2301,SYSTEM=30000142,OWNER=500;
function f(){
 let enabled=true,fenced=true,poisoned=false,physicalCount=0,
  materializeFailure=false,mode='STOP',liveOwner=OWNER,saveMissing=false;
 const assignmentID='as-123',pilotID='coop-pilot-123';
 const row={shipItemID:SHIP,ownerCharacterID:OWNER,systemID:SYSTEM,
  assignmentID,pilotID,generation:1,actorGeneration:1,typeID:606};
 const ship={...row,nativeNpc:true,entityID:SHIP,ownerID:OWNER,
  typeID:606,personalFleetOriginal:true,
  personalFleetAssignmentID:assignmentID,personalFleetPilotID:pilotID,
  personalFleetGeneration:1,transient:false};
 const controller={...ship,runtimeKind:'nativeAmbient'};
 const item={itemID:SHIP,ownerID:OWNER,categoryID:6,flagID:0,
  typeID:606,locationID:SYSTEM,spaceState:{systemID:SYSTEM}};
 const index={version:1,ships:{[SHIP]:{shipItemID:SHIP,
  ownerCharacterID:OWNER,pilotID,assignmentID,generation:1}}};
 const claims={claims:{[SHIP]:{ownerType:'PERSONAL_FLEET',entityID:SHIP,
  ownerCharacterID:OWNER,pilotID,assignmentID,systemID:SYSTEM,generation:1}}};
 const roster={pilots:{[pilotID]:{pilotID,status:'HANGAR_RESERVED',
  assignmentID,shipItemID:SHIP,generation:1}}};
 const dep={phase:'ACTIVE',...row,actorGeneration:1};
 const tables={
  'corporationRuntime':{[P+'hangar-reservations-v1']:index,
   [P+'actor-claims-v1']:claims,[P+'hangar-roster-v1:'+OWNER]:roster,
   [P+'deploy-v1:'+assignmentID]:dep},
  items:{items:{[SHIP]:item}}};
 const scenes=new Map(),controllers=new Map(),sessions=[];
 const scene={systemID:SYSTEM,entities:new Map(),getEntityByID(x){return this.entities.get(x)||null}};
 let originalEntity={...ship,mode},originalController={...controller};
 const deps={
  '../gameStore':{coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',
   isPoisoned:()=>poisoned,
   transact:(scope,fn)=>fn({get:(t,k)=>{
    if(!scope.includes(t))throw Error('UNDECLARED');return tables[t]?.[k]??null;}})}},
  './npc/nativeNpcStore':{
   getNativeEntity:id=>saveMissing?null:id===SHIP?originalEntity:null,
   getNativeController:id=>id===SHIP?originalController:null},
  './npc/nativeNpcService':{materializeStoredNativeController(scene,id){
    physicalCount++;
    if(materializeFailure)return {success:false,errorMsg:'UNKNOWN'};
    scene.entities.set(id,{kind:'ship',itemID:id,nativeNpc:true,ownerID:liveOwner});
    controllers.set(id,{entityID:id,systemID:SYSTEM});
    return {success:true};
  }},
  './runtime':{scenes},'./npc/npcRegistry':{getControllerByEntityID:id=>controllers.get(id)||null},
  '../services/chat/sessionRegistry':{getSessions:()=>sessions},
  './coopPersonalFleetHangarBridge':{REGISTRY_KEY:P+'hangar-reservations-v1',
    ROSTER_PREFIX:P+'hangar-roster-v1:',validateIndex:x=>x,
    validateRoster:x=>x}
 };
 const m={exports:{}};
 vm.runInNewContext(source,{require:x=>{
  if(!Object.hasOwn(deps,x))throw Error('UNKNOWN_IMPORT:'+x);
  return deps[x];
 },module:m,exports:m.exports,Object,Number,Map,Set,Date,
 structuredClone},{filename:'pf90.js'});
 const recovery=m.exports.createOriginalPhysicalRecovery({
  enabled:()=>enabled,allWritersFenced:()=>fenced});
 return {recovery,row,ship,scene,scenes,controllers,tables,index,claims,roster,dep,
  sessions,getMaterializations:()=>physicalCount,
  mount:()=>scenes.set(SYSTEM,scene),disable:()=>enabled=false,
  unfence:()=>fenced=false,poison:()=>poisoned=true,
  changeMode:x=>originalEntity.mode=x,
  changeSavedOwner:x=>originalEntity.ownerID=x,
  failService:()=>materializeFailure=true,
  missingSaved:()=>saveMissing=true,
  setLiveOwner:x=>liveOwner=x};
}
test('PF90 does not create scenes or ships until genuine original scene loaded',()=>{
 const x=f(),a=x.recovery.recover();
 assert.equal(a.pending,1);assert.equal(x.getMaterializations(),0);
 assert.equal(x.scenes.size,0);
});
test('PF90 restores same original itemID once and never creates an ItemStore title',()=>{
 const x=f();x.mount();const before=structuredClone(x.tables.items);
 const r=x.recovery.recover();
 assert.equal(r.status,'RECOVERY_RECONCILED');
 assert.equal(r.restored,1);assert.equal(x.getMaterializations(),1);
 assert.equal(x.scene.getEntityByID(SHIP).itemID,SHIP);
 assert.deepEqual(x.tables.items,before);
 const twice=x.recovery.recover();
 assert.equal(twice.already,1);assert.equal(x.getMaterializations(),1);
});
test('PF90 refuses original controller row absent after restart',()=>{
 const x=f();x.mount();x.missingSaved();
 assert.equal(x.recovery.recover().blocked,1);
 assert.equal(x.getMaterializations(),0);
});
test('PF90 original stored owner conflict is not an NPC respawn permit',()=>{
 const x=f();x.mount();x.changeSavedOwner(444);
 assert.equal(x.recovery.recover().status,'NEEDS_OPERATOR_RECONCILIATION');
 assert.equal(x.getMaterializations(),0);
});
test('PF90 stored in-flight warp requires source recovery, not blind resend',()=>{
 const x=f();x.mount();x.changeMode('WARP');
 assert.equal(x.recovery.recover().issues[0].reason,'PF90_IN_FLIGHT_WARP_NEEDS_SOURCE_RECOVERY');
 assert.equal(x.getMaterializations(),0);
});
test('PF90 refuses foreign scene occupant for reserved item',()=>{
 const x=f();x.mount();x.scene.entities.set(SHIP,{kind:'ship',itemID:SHIP,ownerID:999});
 assert.equal(x.recovery.recover().issues[0].reason,'PF90_EXISTING_SCENE_OR_CONTROLLER_CONFLICT');
 assert.equal(x.getMaterializations(),0);
});
test('PF90 refuses actor present in a different original scene',()=>{
 const x=f();x.mount();
 x.scenes.set(30000143,{systemID:30000143,getEntityByID:id=>
   id===SHIP?{kind:'ship',itemID:SHIP,nativeNpc:true}:null});
 assert.equal(x.recovery.recover().issues[0].reason,'PF90_SHIP_ALREADY_IN_ANOTHER_SCENE');
});
test('PF90 refuses client-owned physical ship session',()=>{
 const x=f();x.mount();x.sessions.push({shipID:SHIP,socket:{destroyed:false}});
 assert.equal(x.recovery.recover().issues[0].reason,'PF90_PHYSICAL_PLAYER_SHIP_CONFLICT');
});
test('PF90 cannot misreport failed original native materialization as success',()=>{
 const x=f();x.mount();x.failService();
 assert.equal(x.recovery.recover().blocked,1);
 assert.equal(x.getMaterializations(),1);
 assert.equal(x.recovery.recover().issues[0].reason,'PF90_UNKNOWN_PRIOR_MATERIALIZATION_OUTCOME');
 assert.equal(x.getMaterializations(),1);
});
test('PF90 does not claim physical recovery when stock service returns foreign owner',()=>{
 const x=f();x.mount();x.setLiveOwner(888);
 assert.equal(x.recovery.recover().blocked,1);
 assert.equal(x.getMaterializations(),1);
});
test('PF90 cannot restore when original PF54 deploy phase is not ACTIVE',()=>{
 const x=f();x.mount();x.dep.phase='ISSUING';
 assert.equal(x.recovery.recover().active,0);
 assert.equal(x.getMaterializations(),0);
});
test('PF90 ItemStore owner change aborts before restoring physical NPC',()=>{
 const x=f();x.mount();x.tables.items.items[SHIP].ownerID=999;
 assert.equal(x.recovery.recover().reason,'PF90_ORIGINAL_ROSTER_SNAPSHOT_FAILED');
 assert.equal(x.getMaterializations(),0);
});
test('PF90 impossible actor-claim change aborts physical work',()=>{
 const x=f();x.mount();x.claims.claims[SHIP].ownerType='WAR';
 assert.equal(x.recovery.recover().reason,'PF90_ORIGINAL_ROSTER_SNAPSHOT_FAILED');
 assert.equal(x.getMaterializations(),0);
});
test('PF90 feature or writer fence revocation blocks recovery',()=>{
 const x=f();x.mount();x.unfence();
 assert.equal(x.recovery.recover().reason,'PF90_RECOVERY_DISABLED');
 assert.equal(x.getMaterializations(),0);
});
test('PF90 poisoned original GameStore blocks all recovery',()=>{
 const x=f();x.mount();x.poison();
 assert.equal(x.recovery.recover().reason,'PF90_RECOVERY_DISABLED');
 assert.equal(x.getMaterializations(),0);
});
