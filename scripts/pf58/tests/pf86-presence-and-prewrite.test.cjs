'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createOriginalPresenceReaders,createNativeBootstrap,createSourceBoundNativeBootstrap}=
 require('../native/coopPersonalFleetNativeBootstrap.cjs');
const {setup,F}=require('./fixture.cjs');
const {validStockHangar}=require('../native/coopPersonalFleetOriginalShipHandoff.cjs');
const row={shipItemID:2001,ownerCharacterID:9001,systemID:30000142};
function presence(){
 const state={sessions:[],gameScene:null,foreignScene:null,
  inProcess:null,storedEntity:null,storedController:null,modules:[],cargo:[],
  throwRead:false};
 const scene={systemID:row.systemID,getEntityByID:()=>state.gameScene};
 const foreign={systemID:row.systemID+1,getEntityByID:()=>state.foreignScene};
 const scenes=new Map([[row.systemID,scene],[row.systemID+1,foreign]]);
 const deps={
  sessionRegistry:{getSessions(){if(state.throwRead)throw Error('registry');return state.sessions;}},
  npcRegistry:{getControllerByEntityID(){if(state.throwRead)throw Error('controller');return state.inProcess;}},
  nativeNpcStore:{
   getNativeEntity(){return state.storedEntity;},
   getNativeController(){return state.storedController;},
   listNativeModulesForEntity(){return state.modules;},
   listNativeCargoForEntity(){return state.cargo;}},
  spaceRuntime:{scenes}
 };
 return {state,deps,scenes,readers:createOriginalPresenceReaders(deps)};
}
test('PF86 requires all four original source authorities and a scene registry',()=>{
 assert.throws(()=>createOriginalPresenceReaders(),/AUTHORITIES_REQUIRED/);
 assert.throws(()=>createSourceBoundNativeBootstrap(),/AUTHORITIES_REQUIRED/);
 const f=presence();
 assert.throws(()=>createOriginalPresenceReaders({...f.deps,sessionRegistry:{}}),/AUTHORITIES_REQUIRED/);
 assert.throws(()=>createOriginalPresenceReaders({...f.deps,npcRegistry:{}}),/AUTHORITIES_REQUIRED/);
});
test('PF86 no session and no original physical controller/entity permits read-only admission',()=>{
 const f=presence();
 assert.equal(f.readers.noActivePlayerSession(row),true);
 assert.equal(f.readers.noExistingPhysicalActor(row),true);
});
test('PF86 cannot adopt a hull while player or other character session occupies it',()=>{
 for(const entry of [
  {characterID:9001,_space:{shipID:2001,systemID:row.systemID}},
  {characterID:9002,_space:{shipID:2001,systemID:row.systemID}},
  {characterID:9002,activeShipID:2001},
  {characterID:9002,shipID:2001},
  {characterID:9002,shipID:'2001'}
 ]){
  const f=presence();f.state.sessions=[entry];
  assert.equal(f.readers.noActivePlayerSession(row),false);
 }
});
test('PF86 owner may be online in a different ship; unknown in-space owner ship blocks',()=>{
 const f=presence();
 f.state.sessions=[{characterID:9001,_space:{shipID:3003,systemID:row.systemID}}];
 assert.equal(f.readers.noActivePlayerSession(row),true);
 f.state.sessions=[{characterID:9001,_space:{shipID:undefined,systemID:row.systemID}}];
 assert.equal(f.readers.noActivePlayerSession(row),false);
});
test('PF86 reads fail closed, never interpret unavailable original state as empty',()=>{
 const f=presence();
 f.state.throwRead=true;
 assert.equal(f.readers.noActivePlayerSession(row),false);
 assert.equal(f.readers.noExistingPhysicalActor(row),false);
 f.state.throwRead=false;
 f.state.sessions=null;
 assert.equal(f.readers.noActivePlayerSession(row),false);
 f.state.sessions=[];
 f.state.inProcess=undefined;
 assert.equal(f.readers.noExistingPhysicalActor(row),false,'undefined persistent read is not null');
});
test('PF86 physical scene collision in any loaded system blocks',()=>{
 const f=presence();
 f.state.gameScene={itemID:2001};
 assert.equal(f.readers.noExistingPhysicalActor(row),false);
 f.state.gameScene=null;
 f.state.foreignScene={itemID:2001};
 assert.equal(f.readers.noExistingPhysicalActor(row),false);
 f.state.foreignScene=null;
 f.scenes.delete(row.systemID);
 assert.equal(f.readers.noExistingPhysicalActor(row),false,'no mounted scene is not proof');
});
test('PF86 native registry, controller, orphan module and cargo block',()=>{
 for(const [key,value] of [
  ['inProcess',{entityID:2001}],['storedEntity',{entityID:2001}],
  ['storedController',{entityID:2001}],['modules',[{entityID:2001}]],
  ['cargo',[{entityID:2001}]]
 ]){
  const f=presence();f.state[key]=value;
  assert.equal(f.readers.noExistingPhysicalActor(row),false,key);
 }
});
test('PF86 unknown original module/cargo reads fail closed',()=>{
 const f=presence();
 f.state.modules=null;
 assert.equal(f.readers.noExistingPhysicalActor(row),false);
 f.state.modules=[];
 f.state.cargo=undefined;
 assert.equal(f.readers.noExistingPhysicalActor(row),false);
});
test('PF86 bootstrap rechecks original session AFTER consuming permit and BEFORE ItemStore write',()=>{
 const tmp=F.tempDb(),f=setup(tmp.file);
 try {
  f.prepare();
  const mounted={systemID:F.SYSTEM,getEntityByID:()=>null};
  const runtime={scenes:new Map([[F.SYSTEM,mounted]])};
  let moveCalls=0,sessionChecks=0;
  const items={
   findItemById:id=>f.get('items','items')?.[String(id)]||null,
   moveShipToSpace(){moveCalls++;throw Error('PF86_SHOULD_NOT_WRITE');}
  };
  const store={
   getNativeEntity:()=>null,getNativeController:()=>null,
   listNativeModulesForEntity:()=>[],listNativeCargoForEntity:()=>[],
   upsertNativeEntity:()=>({success:true}),upsertNativeController:()=>({success:true})
  };
  const nativeNpcService={PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1:true,
   materializeStoredNativeController:()=>({success:false})};
  const boot=createNativeBootstrap({gameStore:f.gameStore,pf52:F.pf52,
   originalItemStore:items,nativeNpcStore:store,
   nativeNpcService,spaceRuntime:runtime,
   resolveNativeProfile:()=>({profile:{shipTypeID:606,profileID:'stock'},
    loadout:{loadoutID:'stock'},behaviorProfile:{behaviorProfileID:'safe'}}),
   resolveOwnerCorporation:()=>F.EMPLOYER,
   originalStationUndockPoint:r=>({stationID:r.stationID,systemID:r.systemID,
    position:{x:10,y:20,z:30},direction:{x:1,y:0,z:0},sessionless:true}),
   originalNoActiveSession:()=>++sessionChecks===1,
   originalNoPhysicalActor:()=>true,
   originalEquipmentWitness:()=>({fittingHash:F.FIT,cargoHash:F.CARGO}),
   originalOwnershipWitness:()=>true,
   independentOriginalActorWitness:()=>null,
   allWritersFenced:()=>f.shared.writers,enabled:()=>f.shared.enabled});
  f.shared.onHandoff=boot.executeOriginalHandoff;
  const outcome=f.pending();
  assert.equal(outcome.executorStatus,'UNVERIFIED');
  assert.equal(sessionChecks,2,'second live session check must be at the ItemStore boundary');
  assert.equal(moveCalls,0,'no original item mutation after session became occupied');
  assert.equal(boot.inspectHandoff({assignmentID:F.ASSIGNMENT}).status,'CONSUMED',
   'durable one-shot permit cannot be silently recycled');
  const ship=f.get('items','items')[F.SHIP];
  assert.equal(validStockHangar(ship,{
   shipItemID:F.SHIP,ownerCharacterID:F.OWNER,typeID:606,stationID:F.STATION}),true);
  assert.equal(f.pending().status,'BLOCKED','no second native dispatch after uncertainty');
 }finally {f.close();tmp.cleanup();}
});
