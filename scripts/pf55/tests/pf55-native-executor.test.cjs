'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createNpcRuntimeExecutor}=require('../native/coopPersonalFleetNpcRuntimeExecutor.cjs');
const F=require('./fixture.cjs');
function setup(action='FOLLOW',override={}){
 const c=F.command({action,operationID:'pf55-native-1',...override});
 const row={...c,session:undefined};
 if(action==='HOLD')row.followRangeMeters=null;
 if(action==='ATTACK'||action==='WARP')row.followRangeMeters=null;
 const scene={systemID:F.SYSTEM,getEntityByID(id){return id===F.SHIP?entity:
  id===F.TARGET?target:null;}};
 const entity={kind:'ship',nativeNpc:true,nativeNpcOccupied:true,
  npcEntityType:'personalFleet',operatorKind:'PERSONAL_FLEET',
  selectionKind:'PERSONAL_FLEET',selectionID:F.ASSIGNMENT,
  ownerID:F.OWNER,characterID:0,pilotCharacterID:0,
  itemID:F.SHIP,mode:'STOP',session:null};
 const controller={entityID:F.SHIP,systemID:F.SYSTEM,manualOrder:null,
  personalFleetOriginal:true,operatorKind:'PERSONAL_FLEET',entityType:'personalFleet',
  selectionKind:'PERSONAL_FLEET',selectionID:F.ASSIGNMENT,
  personalFleetAssignmentID:F.ASSIGNMENT,personalFleetPilotID:F.PILOT,
  personalFleetGeneration:1,runtimeKind:'nativeAmbient'};
 const target={itemID:F.TARGET,kind:'ship',ownerID:F.OWNER,position:{x:100,y:0,z:0}};
 const nativeCalls=[];const bridgeCalls=[];
 const npcRuntime={issueOrder(...a){nativeCalls.push(['issueOrder',...a]);return {success:true}},
  follow(...a){nativeCalls.push(['follow',...a]);return {success:true}}, 
  issueAttackOrder(...a){nativeCalls.push(['attack',...a]);return {success:true}},
  stop(...a){nativeCalls.push(['stop',...a]);return {success:true}},
  warpToEntity(...a){nativeCalls.push(['warp',...a]);return {success:true}}};
 const bridge={issue(opts){bridgeCalls.push(opts);return opts.execute()}};
 let trusted=true,allowed=true,enabled=true;
 const executor=createNpcRuntimeExecutor({npcRuntime,orderBridge:bridge,
  sceneForSystem:()=>scene,getController:()=>controller,
  verifyPersonalClaim:()=>trusted,authorizeTarget:()=>allowed,enabled:()=>enabled});
 return {row,scene,entity,controller,target,nativeCalls,bridgeCalls,npcRuntime,bridge,
  executor,setTrusted:v=>trusted=v,setAllowed:v=>allowed=v,setEnabled:v=>enabled=v};
}
test('PF82 FOLLOW uses original physics follow, not hostile-only manual combat follow',()=>{
 const f=setup(),result=f.executor.execute(f.row);
 assert.equal(result.success,true);assert.equal(f.bridgeCalls.length,1);
 assert.equal(f.bridgeCalls[0].owner,'PERSONAL_FLEET');
 assert.equal(f.bridgeCalls[0].action,'pf-follow');
 assert.equal(f.target.ownerID,F.OWNER,'friendly target has the owner of the PF ship');
 assert.deepEqual(f.nativeCalls[0],['follow',F.SHIP,F.TARGET,1500,
  {wakeController:false,allowWeapons:false}]);
 assert.equal(f.nativeCalls.some(call=>call[0]==='issueOrder'),false);
});
test('ATTACK uses original issueAttackOrder, never allows pod-kill',()=>{
 const f=setup('ATTACK');assert.equal(f.executor.execute(f.row).success,true);
 assert.deepEqual(f.nativeCalls[0],['attack',F.SHIP,F.TARGET,
  {allowWeapons:true,keepLock:true,allowPodKill:false}]);
});
test('HOLD uses original stop with no sessionless warp-abort',()=>{
 const f=setup('HOLD');assert.equal(f.executor.execute(f.row).success,true);
 assert.deepEqual(f.nativeCalls[0],['stop',F.SHIP,{reason:'pf55-personal-fleet',
  allowSessionlessWarpAbort:false,issueStopOrder:true}]);
});
test('WARP uses native warpToEntity with warp notification',()=>{
 const f=setup('WARP');assert.equal(f.executor.execute(f.row).success,true);
 assert.deepEqual(f.nativeCalls[0],['warp',F.SHIP,F.TARGET,
  {forceImmediateStart:true,broadcastWarpStartToVisibleSessions:true}]);
});
test('DEFEND fails closed unless native defensive combat policy is integrated',()=>{
 const f=setup('DEFEND');const result=f.executor.execute(f.row);
 assert.equal(result.success,false);assert.equal(result.errorMsg,'PF55_DEFEND_COMBAT_POLICY_NOT_WIRED');
 assert.equal(f.nativeCalls.length,0);
});
test('DEFEND calls explicit verified native combat policy when provided',()=>{
 const f=setup('DEFEND');let invoked=0;
 const ex=createNpcRuntimeExecutor({npcRuntime:f.npcRuntime,orderBridge:f.bridge,
  sceneForSystem:()=>f.scene,getController:()=>f.controller,
  verifyPersonalClaim:()=>true,authorizeTarget:()=>true,enabled:()=>true,
  defensiveEscort(row,{target,npcRuntime}){invoked++;assert.equal(target.itemID,F.TARGET);
   return npcRuntime.issueOrder(row.shipItemID,{type:'follow',targetID:row.targetEntityID,
    allowWeapons:false,keepLock:false});}});
 assert.equal(ex.execute(f.row).success,true);assert.equal(invoked,1);
});
test('untrusted PF claim blocks before arbiter',()=>{
 const f=setup();f.setTrusted(false);const r=f.executor.execute(f.row);
 assert.equal(r.errorMsg,'PF55_NATIVE_ACTOR_OR_TARGET_UNVERIFIED');
 assert.equal(f.bridgeCalls.length,0);
});
test('unknown target blocks',()=>{
 const f=setup('ATTACK');f.setAllowed(false);
 assert.equal(f.executor.execute(f.row).success,false);assert.equal(f.bridgeCalls.length,0);
});
test('real original entityID mismatch blocks',()=>{
 const f=setup();f.entity.itemID++;
 assert.equal(f.executor.execute(f.row).success,false);
});
test('controller mismatch blocks',()=>{
 const f=setup();f.controller.entityID++;
 assert.equal(f.executor.execute(f.row).success,false);
});
test('logged-in player ship cannot be used as sessionless NPC',()=>{
 const f=setup();f.entity.session={characterID:F.OWNER};
 assert.equal(f.executor.execute(f.row).success,false);
});
test('in-flight warp cannot be overridden',()=>{
 for(const v of ['WARP','STOP']){
 const f=setup();if(v==='WARP')f.entity.mode='WARP';else f.entity.pendingWarp={};
 assert.equal(f.executor.execute(f.row).success,false);
 }
});
test('disabling before execution blocks native and bridge',()=>{
 const f=setup();f.setEnabled(false);assert.equal(f.executor.execute(f.row).success,false);
 assert.equal(f.bridgeCalls.length,0);
});
test('bridge failure is not magically elevated to success',()=>{
 const f=setup();f.bridge.issue=()=>({success:false,errorMsg:'ORIGINAL_ARBITER_REFUSED'});
 const r=f.executor.execute(f.row);
 assert.equal(r.success,false);assert.equal(r.errorMsg,'ORIGINAL_ARBITER_REFUSED');
 assert.equal(f.nativeCalls.length,0);
});
test('native identity is revalidated inside arbiter execute callback',()=>{
 const f=setup();f.bridge.issue=opts=>{f.entity.itemID=9999;return opts.execute()};
 const r=f.executor.execute(f.row);assert.equal(r.success,false);
 assert.equal(r.errorMsg,'PF55_NATIVE_SOURCE_CHANGED');assert.equal(f.nativeCalls.length,0);
});

test('PF78 rejects foreign physical actor metadata before PF55 order bridge',()=>{
 for(const [field,value] of [
  ['ownerID',F.OWNER+1],['selectionID','foreign'],
  ['operatorKind','WAR'],['nativeNpcOccupied',false],
  ['npcEntityType','war'],['characterID',F.OWNER],
  ['session',{socket:{}}]]){
  const f=setup();f.entity[field]=value;
  assert.equal(f.executor.execute(f.row).errorMsg,'PF55_NATIVE_ACTOR_OR_TARGET_UNVERIFIED',field);
  assert.equal(f.bridgeCalls.length,0,field);
  assert.equal(f.nativeCalls.length,0,field);
 }
});
test('PF78 rejects foreign live NPC controller metadata before PF55 native effect',()=>{
 for(const [field,value] of [
  ['personalFleetPilotID','coop-pilot-999'],
  ['personalFleetAssignmentID','foreign'],
  ['personalFleetOriginal',false],
  ['operatorKind','RAID'],
  ['selectionID','foreign'],
  ['runtimeKind','nativeWander']]){
  const f=setup();f.controller[field]=value;
  assert.equal(f.executor.execute(f.row).success,false,field);
  assert.equal(f.bridgeCalls.length,0,field);
 }
});

test('PF82 HOLD remains permitted after native stock ATTACK switches runtimeKind to nativeCombat',()=>{
 const f=setup('HOLD');f.controller.runtimeKind='nativeCombat';
 const out=f.executor.execute(f.row);
 assert.equal(out.success,true);
 assert.equal(f.nativeCalls.length,1);
 assert.equal(f.nativeCalls[0][0],'stop');
});
test('PF82 FOLLOW refuses an active combat controller rather than silently competing with ATTACK',()=>{
 const f=setup();f.controller.runtimeKind='nativeCombat';
 const out=f.executor.execute(f.row);
 assert.equal(out.success,false);
 assert.equal(out.errorMsg,'PF82_FOLLOW_COMBAT_CONTROLLER_NOT_QUIESCED');
 assert.equal(f.nativeCalls.length,0);
});
test('PF82 fails at composition if native physics follow capability is not wired',()=>{
 const f=setup();delete f.npcRuntime.follow;
 assert.throws(()=>createNpcRuntimeExecutor({npcRuntime:f.npcRuntime,
  orderBridge:f.bridge,sceneForSystem:()=>f.scene,
  getController:()=>f.controller,verifyPersonalClaim:()=>true,
  authorizeTarget:()=>true,enabled:()=>true}),/PF55_ORIGINAL_NPC_RUNTIME_DEPENDENCIES_REQUIRED/);
});
