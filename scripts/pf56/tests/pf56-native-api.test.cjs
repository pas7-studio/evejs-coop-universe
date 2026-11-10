'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createOriginalReturnExecutor,createNativeStationArrivalReader}=
 require('../native/coopPersonalFleetNativeReturnExecutor.cjs');
const pf56=require('../native/coopPersonalFleetReturnDock.cjs');
const row={operationID:'return-1',assignmentID:'assign-1',shipItemID:2001,
 ownerCharacterID:9001,pilotID:'coop-pilot-123',actorGeneration:1,reservationGeneration:3,
 systemID:30000142,stationID:6001};
function fixture(){
 const station={stationID:row.stationID,systemID:row.systemID,
  position:{x:1000,y:0,z:0},radius:200,canDockPersonalNpc:true};
 const entity={kind:'ship',nativeNpc:true,nativeNpcOccupied:true,
  npcEntityType:'personalFleet',operatorKind:'PERSONAL_FLEET',
  selectionKind:'PERSONAL_FLEET',selectionID:row.assignmentID,
  ownerID:row.ownerCharacterID,characterID:0,pilotCharacterID:0,
  itemID:row.shipItemID,
  position:{x:1300,y:0,z:0},velocity:{x:0,y:0,z:0},radius:100,
  mode:'STOP',session:null,warpState:null,pendingWarp:null};
 const controller={entityID:row.shipItemID,systemID:row.systemID,
  personalFleetOriginal:true,operatorKind:'PERSONAL_FLEET',entityType:'personalFleet',
  selectionKind:'PERSONAL_FLEET',selectionID:row.assignmentID,
  personalFleetAssignmentID:row.assignmentID,personalFleetPilotID:row.pilotID,
  personalFleetGeneration:row.reservationGeneration,runtimeKind:'nativeAmbient'};
 const scene={systemID:row.systemID,getEntityByID(id){return id===row.shipItemID?entity:null;}};
 const calls=[],state={claim:true,enabled:true};
 const orderBridge={issue(c){calls.push(c);return c.execute();}};
 const npcRuntime={
  stop(...args){calls.push(['stop',...args]);controller.manualOrder={type:'stop'};
   controller.currentTargetID=0;return {success:true};},
  warpToPoint(...args){calls.push(['warp',...args]);return {success:true};}
 };
 const deps={npcRuntime,orderBridge,sceneForSystem:()=>scene,
  getController:()=>controller,getCanonicalStation:()=>station,
  verifyPersonalClaim:()=>state.claim,enabled:()=>state.enabled};
 return {station,entity,controller,scene,calls,state,deps};
}

test('PF56 original Return uses canonical npcRuntime.warpToPoint under PERSONAL_FLEET ownership',()=>{
 const f=fixture(),exec=createOriginalReturnExecutor(f.deps);
 assert.equal(exec.execute(row).success,true);
 assert.equal(f.calls[0].owner,'PERSONAL_FLEET');
 assert.equal(f.calls[0].action,'pf-return-base');
 assert.equal(f.calls[1][0],'warp');
 assert.equal(f.calls[1][1],row.shipItemID);
 assert.deepEqual(f.calls[1][2],{x:1950,y:0,z:0});
 assert.equal(f.calls[1][3].forceImmediateStart,true);
});

test('original Return rechecks native actor immediately before warp effect',()=>{
 const f=fixture();f.deps.orderBridge.issue=c=>{f.state.claim=false;return c.execute();};
 const exec=createOriginalReturnExecutor(f.deps);
 assert.equal(exec.execute(row).errorMsg,'PF56_NATIVE_SOURCE_CHANGED');
 assert.equal(f.calls.length,0);
});

test('wrong ship ID, controller, station or missing claim blocks native effect',()=>{
 for(const bad of ['claim','controller','ship','station','enabled']){
  const f=fixture();
  if(bad==='claim')f.state.claim=false;
  if(bad==='enabled')f.state.enabled=false;
  if(bad==='controller')f.controller.entityID=9999;
  if(bad==='ship')f.entity.itemID=9999;
  if(bad==='station')f.station.stationID=9999;
  assert.equal(createOriginalReturnExecutor(f.deps).execute(row).success,false,bad);
  assert.equal(f.calls.length,0,bad);
 }
});

test('arrival reader requires same original NPC, exact station, no warp and near-zero speed',()=>{
 const f=fixture(),reader=createNativeStationArrivalReader({...f.deps,getSceneEpoch:()=> 'boot-19'});
 const got=reader(row);
 assert.equal(got.source,'ORIGINAL_EVEJS_SCENE_STATION_V1');
 assert.equal(got.stationDockAccess,true);
 assert.equal(pf56.arrivalValid(got,row),true);
 f.entity.mode='WARP';f.entity.isWarping=true;
 assert.equal(reader(row).warpInactive,false);
 assert.equal(pf56.arrivalValid(reader(row),row),false);
 f.entity.mode='STOP';f.entity.isWarping=false;f.entity.velocity.x=8;
 assert.equal(reader(row).shipStopped,false);
 assert.equal(pf56.arrivalValid(reader(row),row),false);
});

test('missing original stock authorities never fake a verified arrival',()=>{
 for(const field of ['station','scene','claim','controller','epoch']){
  const f=fixture();let deps={...f.deps,getSceneEpoch:()=> 'boot-19'};
  if(field==='station')f.station.stationID=7002;
  if(field==='scene')f.scene.systemID=42;
  if(field==='claim')f.state.claim=false;
  if(field==='controller')f.controller.systemID=42;
  if(field==='epoch')deps.getSceneEpoch=()=> 'not valid epoch';
  assert.equal(createNativeStationArrivalReader(deps)(row),null,field);
 }
});

test('injected sessionless docking is mandatory: this module never calls session acceptDocking',()=>{
 const f=fixture();
 assert.throws(()=>createOriginalReturnExecutor({...f.deps,npcRuntime:{}}),/REQUIRED/);
 assert.throws(()=>createNativeStationArrivalReader({...f.deps,getSceneEpoch:null}),/REQUIRED/);
});

test('PF78 Return denies foreign runtime actor or controller before order bridge',()=>{
 for(const [which,field,value] of [
  ['entity','ownerID',row.ownerCharacterID+1],
  ['entity','selectionID','foreign'],['entity','npcEntityType','war'],
  ['entity','session',{socket:{}}],
  ['controller','personalFleetPilotID','coop-pilot-999'],
  ['controller','personalFleetGeneration',row.reservationGeneration+1],
  ['controller','selectionKind','WAR'],
  ['controller','personalFleetOriginal',false]]){
  const f=fixture();f[which][field]=value;
  assert.equal(createOriginalReturnExecutor(f.deps).execute(row).success,false,field);
  assert.equal(f.calls.length,0,field);
  const read=createNativeStationArrivalReader({...f.deps,getSceneEpoch:()=> 'boot-19'});
  assert.equal(read(row),null,field);
 }
});

test('PF83 Return uses current canonical station coordinates after arbiter admission',()=>{
 const f=fixture();
 f.deps.orderBridge.issue=opts=>{f.calls.push(opts);
   f.station.position.x=8000;return opts.execute();};
 const ex=createOriginalReturnExecutor(f.deps);
 assert.equal(ex.execute(row).success,true);
 assert.equal(f.calls[0].owner,'PERSONAL_FLEET');
 assert.deepEqual(f.calls[1][2],{x:8950,y:0,z:0});
 assert.equal(f.calls[1][0],'warp');
 assert.equal(f.calls[1][1],row.shipItemID);
});

test('PF83 Return denies overflowed physics coordinates without native warp',()=>{
 const f=fixture();
 f.station.position.x=Number.MAX_VALUE;
 f.station.radius=Number.MAX_VALUE;
 const r=createOriginalReturnExecutor(f.deps).execute(row);
 assert.equal(r.success,false);
 assert.equal(r.errorMsg,'PF83_NATIVE_RETURN_DESTINATION_INVALID');
 assert.equal(f.calls.length,1,'only the bridge was called');
});

test('PF83 Return rechecks canonical station identity inside arbiter callback',()=>{
 const f=fixture();
 f.deps.orderBridge.issue=opts=>{
   f.station.stationID=row.stationID+1;return opts.execute();};
 const r=createOriginalReturnExecutor(f.deps).execute(row);
 assert.equal(r.success,false);
 assert.equal(r.errorMsg,'PF56_NATIVE_SOURCE_CHANGED');
 assert.equal(f.calls.length,0);
});

test('PF83-B live nativeCombat ATTACK must be STOPped and witnessed before Return warp',()=>{
 const f=fixture();f.controller.runtimeKind='nativeCombat';
 f.controller.currentTargetID=777;
 f.controller.manualOrder={type:'attack',targetID:777,allowWeapons:true};
 const out=createOriginalReturnExecutor(f.deps).execute(row);
 assert.equal(out.success,true);
 assert.equal(f.calls[0].owner,'PERSONAL_FLEET');
 assert.deepEqual(f.calls[1],['stop',row.shipItemID,{
  reason:'pf83-return-base',allowSessionlessWarpAbort:false,
  issueStopOrder:true}]);
 assert.equal(f.controller.manualOrder.type,'stop');
 assert.equal(f.controller.currentTargetID,0);
 assert.equal(f.calls[2][0],'warp');
 assert.equal(f.calls[2][1],row.shipItemID);
});
test('PF83-B failed original STOP never starts return warp',()=>{
 const f=fixture();f.controller.runtimeKind='nativeCombat';
 f.controller.manualOrder={type:'attack',targetID:777};
 f.deps.npcRuntime.stop=(...args)=>{f.calls.push(['stop',...args]);
  return {success:false,errorMsg:'NPC_STOP_FAILED'};};
 const out=createOriginalReturnExecutor(f.deps).execute(row);
 assert.equal(out.success,false);
 assert.equal(out.errorMsg,'PF83_NATIVE_COMBAT_STOP_UNVERIFIED');
 assert.equal(f.calls.length,2);
 assert.equal(f.calls.some(x=>Array.isArray(x)&&x[0]==='warp'),false);
});
test('PF83-B successful STOP ACK without controller change cannot authorize warp',()=>{
 const f=fixture();f.controller.runtimeKind='nativeCombat';
 f.controller.manualOrder={type:'attack',targetID:777};
 f.controller.currentTargetID=777;
 f.deps.npcRuntime.stop=(...args)=>{f.calls.push(['stop',...args]);
  return {success:true};};
 const out=createOriginalReturnExecutor(f.deps).execute(row);
 assert.equal(out.success,false);
 assert.equal(out.errorMsg,'PF83_NATIVE_COMBAT_QUIESCENCE_UNVERIFIED');
 assert.equal(f.calls.length,2);
 assert.equal(f.calls.some(x=>Array.isArray(x)&&x[0]==='warp'),false);
});
