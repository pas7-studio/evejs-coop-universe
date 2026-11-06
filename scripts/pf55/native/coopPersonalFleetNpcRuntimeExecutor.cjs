'use strict';
/**
 * PF-55 native API adapter: uses original npcRuntime and original arbiter/bridge.
 * Integration requires patched arbiter owner and original PF claim reader.
 * This module does not fabricate a controller, warp, ship, or proof receipt.
 */
const {valid}=require('./coopPersonalFleetNativeOrders.cjs');
const {matchesOriginalPersonalFleetActor}=require('./coopPersonalFleetNativeActorProof.cjs');
const deny=errorMsg=>({success:false,errorMsg});
function createNpcRuntimeExecutor({npcRuntime,orderBridge,sceneForSystem,getController,
 verifyPersonalClaim,authorizeTarget,defensiveEscort=null,enabled=()=>false}={}){
 if(!npcRuntime||!orderBridge||typeof orderBridge.issue!=='function'||
  !['issueOrder','stop','follow','issueAttackOrder','warpToEntity'].every(k=>typeof npcRuntime[k]==='function')||
  [sceneForSystem,getController,verifyPersonalClaim,authorizeTarget,enabled].some(x=>typeof x!=='function')||
  (defensiveEscort!==null&&typeof defensiveEscort!=='function'))
  throw Error('PF55_ORIGINAL_NPC_RUNTIME_DEPENDENCIES_REQUIRED');
 function proof(row){
  if(enabled()!==true||!valid({...row,session:{characterID:row.ownerCharacterID,userid:1}}))return null;
  if(verifyPersonalClaim(row)!==true)return null;
  const scene=sceneForSystem(row.systemID);
  if(!scene||scene.systemID!==row.systemID||typeof scene.getEntityByID!=='function')return null;
  const entity=scene.getEntityByID(row.shipItemID),controller=getController(row.shipItemID);
  // PF78: match the ORIGINAL PF58 physical actor and live controller, not
  // only a reused numeric itemID. PF54 claims are separately checked above.
  if(!matchesOriginalPersonalFleetActor(row,entity,controller))return null;
  const mode=String(entity.mode||'').toUpperCase();
  if(mode==='WARP'||entity.warpState||entity.pendingWarp||entity.isWarping===true)return null;
  let target=null;
  if(row.targetEntityID!=null){
   target=scene.getEntityByID(row.targetEntityID);
   if(!target||target.itemID!==row.targetEntityID||
      authorizeTarget(row,{scene,entity,controller,target})!==true)return null;
  }
  return {scene,entity,controller,target};
 }
 function execute(row){
  const pre=proof(row);
  if(!pre)return deny('PF55_NATIVE_ACTOR_OR_TARGET_UNVERIFIED');
  const action='pf-'+row.action.toLowerCase();
  return orderBridge.issue({entityID:row.shipItemID,systemID:row.systemID,
   owner:'PERSONAL_FLEET',action,holdMs:120000,
   execute(){
    const ready=proof(row);if(!ready)return deny('PF55_NATIVE_SOURCE_CHANGED');
    switch(row.action){
     case 'FOLLOW':
      // PF82: stock NPC manual FOLLOW is not appropriate for an ally's ship:
      // npcBehaviorLoop.resolveDesiredTarget() requires isValidCombatTarget()
      // for ALL ship targets, which rejects friendly players. Use the native
      // physics follow API; it accepts actual movement targets independent
      // of hostility, without manufacturing any combat order or ship/item.
      // An already nativeCombat controller may retain a previous ATTACK
      // manualOrder that could compete with physics; fail closed until a
      // separately fenced combat quiescence protocol is implemented.
      if(ready.controller.runtimeKind!=='nativeAmbient')
       return deny('PF82_FOLLOW_COMBAT_CONTROLLER_NOT_QUIESCED');
      return npcRuntime.follow(row.shipItemID,row.targetEntityID,
       row.followRangeMeters,{wakeController:false,allowWeapons:false});
     case 'HOLD':
      return npcRuntime.stop(row.shipItemID,{reason:'pf55-personal-fleet',
       allowSessionlessWarpAbort:false,issueStopOrder:true});
     case 'ATTACK':
      return npcRuntime.issueAttackOrder(row.shipItemID,row.targetEntityID,{
       allowWeapons:true,keepLock:true,allowPodKill:false});
     case 'WARP':
      return npcRuntime.warpToEntity(row.shipItemID,row.targetEntityID,{
       forceImmediateStart:true,broadcastWarpStartToVisibleSessions:true});
     case 'DEFEND':
      // Original follow() treats a friendly target as movement only; it does
      // not defend that target. A verified combat policy executor is required.
      if(!defensiveEscort)return deny('PF55_DEFEND_COMBAT_POLICY_NOT_WIRED');
      return defensiveEscort(row,{scene:ready.scene,entity:ready.entity,
       controller:ready.controller,target:ready.target,npcRuntime});
     default:return deny('PF55_UNKNOWN_NATIVE_ACTION');
    }
   }});
 }
 return Object.freeze({execute,probe:proof,
  supports:action=>enabled()===true&&(
   ['FOLLOW','HOLD','ATTACK','WARP'].includes(action)||
   (action==='DEFEND'&&defensiveEscort!==null))});
}
module.exports={createNpcRuntimeExecutor};