'use strict';
/**
 * Original EveJS physical FOLLOW/HOLD executor. Uses the ORIGINAL common
 * coopNpcOrderBridge with the SAME arbiter object as other NPC directors,
 * original native npcRuntime and PF52/PF54/ItemStore witnesses. No fake NPC,
 * independent parallel arbiter or client-provided target/ship authority.
 * PF55 retains the durable one-shot ISSUE and original order ACK writer.
 */
const gameStore=require('../gameStore');
const runtime=require('./runtime');
const npcRuntime=require('./npc/npcRuntime');
const registry=require('./npc/npcRegistry');
const worldData=require('./worldData');
const {createOriginalReturnExecutor}=require('./coopPersonalFleetNativeReturnExecutor');
const pf52=require('./coopPersonalFleetHangarBridge');
const pf55=require('./coopPersonalFleetNativeOrders');
const {createOrderBridge}=require('./coopNpcOrderBridge');
const {createNpcRuntimeExecutor}=require('./coopPersonalFleetNpcRuntimeExecutor');
const F='coop-personal-fleet\u001f',T='corporationRuntime';
const positive=x=>Number.isSafeInteger(x)&&x>0;
function createOriginalOrderExecutor({sharedOriginalArbiter,readOriginalWarShipClaim,
 orderWitness,orderReceipt,combatAuthority=null,combatReceipt=null,
 enabled=()=>false,allWritersFenced=()=>false}={}){
 const a=gameStore.coopAtomicNativeRows;
 if(a?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof a.transact!=='function'||
    typeof a.isPoisoned!=='function'||typeof runtime.scenes?.get!=='function'||
    typeof registry.getControllerByEntityID!=='function'||
    !['follow','stop','issueOrder','issueAttackOrder','warpToEntity','warpToPoint'].every(k=>typeof npcRuntime[k]==='function')||
    typeof worldData.getStationByID!=='function'||typeof createOriginalReturnExecutor!=='function'||
    typeof pf52.validateIndex!=='function'||typeof pf52.validateRoster!=='function'||
    !sharedOriginalArbiter||!['issue','blocked','snapshot','retainWithNativeProof','blocksForSystem'].every(k=>
     typeof sharedOriginalArbiter[k]==='function')||
    !orderWitness||!['verifyNativeActor','verifyTarget','verifyPersonalClaim','verifyOriginalControl'].every(k=>
     typeof orderWitness[k]==='function')||
  typeof orderReceipt?.recordAfterNativeEffect!=='function'||
  typeof orderReceipt?.recordAfterNativeReturnEffect!=='function'||
    [readOriginalWarShipClaim,enabled,allWritersFenced].some(f=>typeof f!=='function'))
  throw Error('PF_FIRSTPLAY_ORIGINAL_SHARED_ORDER_RUNTIME_REQUIRED');
 const live=()=>enabled()===true&&allWritersFenced()===true&&a.isPoisoned()===false;
 const sceneForSystem=systemID=>positive(systemID)?runtime.scenes.get(systemID)||null:null;
 const getController=id=>positive(id)?registry.getControllerByEntityID(id):null;
 function assignments(){
  if(!live())return [];
  try{return a.transact([T,'items'],tx=>{
   const raw=tx.get(T,pf52.REGISTRY_KEY);
   if(!raw||typeof raw!=='object')return [];
   const idx=pf52.validateIndex(raw);
   const result=[];
   if(Object.keys(idx.ships).length>256)return [];
   for(const [key,ship] of Object.entries(idx.ships)){
    const id=Number(key);
    if(!positive(id)||ship.shipItemID!==id||!positive(ship.ownerCharacterID)||
       !positive(ship.generation)||typeof ship.assignmentID!=='string')return [];
    const dep=tx.get(T,F+'deploy-v1:'+ship.assignmentID);
    if(!dep||dep.phase!=='ACTIVE'||!positive(dep.actorGeneration))continue;
    const row={ownerCharacterID:ship.ownerCharacterID,pilotID:ship.pilotID,
     shipItemID:id,systemID:dep.systemID,assignmentID:ship.assignmentID,
     actorGeneration:dep.actorGeneration};
    if(orderWitness.verifyNativeActor(row,tx)!==true)return [];
    result.push({pilotID:ship.pilotID,entityID:id,systemID:dep.systemID});
   }
   // Repeated pilots or ship IDs are ambiguity, not multiple actors.
   if(new Set(result.map(x=>x.entityID)).size!==result.length||
      new Set(result.map(x=>x.pilotID)).size!==result.length)return [];
   return result;
  });}catch{return [];} // Never turn unreadable SQLite into a stock order claim.
 }
 const orderBridge=createOrderBridge({arbiter:sharedOriginalArbiter,
  assignments,sceneForSystem,getController,
  warShipClaim:link=>{
   if(!live())return 'UNKNOWN';
   try{
    const x=readOriginalWarShipClaim(link);
    return ['UNASSIGNED','ASSIGNED'].includes(x)?x:'UNKNOWN';
   }catch{return 'UNKNOWN';}
  }});
 if(!orderBridge||typeof orderBridge.issue!=='function')
  throw Error('PF_FIRSTPLAY_ORIGINAL_SHARED_ORDER_BRIDGE_UNAVAILABLE');
 const base=createNpcRuntimeExecutor({npcRuntime,orderBridge,
  sceneForSystem,getController,
  verifyPersonalClaim:row=>live()&&orderWitness.verifyPersonalClaim(row)===true,
  authorizeTarget:row=>{
   if(!live()||row?.action!=='FOLLOW')return false;
   try{return a.transact([T,'items','characters'],tx=>
    orderWitness.verifyTarget(row,tx)===true)===true;
   }catch{return false;}
  },enabled:live});
 if(!base||typeof base.execute!=='function'||typeof base.supports!=='function')
  throw Error('PF_FIRSTPLAY_ORIGINAL_ORDER_EXECUTOR_UNAVAILABLE');
 // PF56 returns use the EXACT SAME shared order bridge and arbiter as PF55.
 // Stock worldData plus the live original station ball are both required:
 // arbitrary client-provided coordinates can never initiate native warp.
 function originalStation(stationID){
  if(!positive(stationID)||!live())return null;
  const source=worldData.getStationByID(stationID);
  if(source?.stationID!==stationID||!positive(source.solarSystemID)||
     !source.position||!['x','y','z'].every(k=>Number.isFinite(source.position[k])))return null;
  const scene=sceneForSystem(source.solarSystemID);
  const ball=scene?.getEntityByID?.(stationID);
  if(scene?.systemID!==source.solarSystemID||ball?.kind!=='station'||ball?.itemID!==stationID||
     (ball.entityID!==undefined&&ball.entityID!==stationID)||
     !ball.position||!['x','y','z'].every(k=>Number.isFinite(ball.position[k]))||
     !Number.isFinite(ball.radius)||ball.radius<1||
     Math.hypot(source.position.x-ball.position.x,
       source.position.y-ball.position.y,
       source.position.z-ball.position.z)>100)return null;
  return {stationID,systemID:source.solarSystemID,position:{...source.position},
    radius:ball.radius};
 }
 const nativeReturn=createOriginalReturnExecutor({npcRuntime,orderBridge,
  sceneForSystem,getController,getCanonicalStation:originalStation,
  verifyPersonalClaim:row=>live()&&orderWitness.verifyPersonalClaim(row)===true,
  enabled:live});
 if(typeof nativeReturn?.execute!=='function')
  throw Error('PF_FIRSTPLAY_ORIGINAL_NATIVE_RETURN_BRIDGE_MISSING');
 const combatReady=()=>combatAuthority&&combatReceipt&&
    typeof combatAuthority.verify==='function'&&
    typeof combatReceipt.recordAfterEffect==='function';
 function supports(action){
  if(!live())return false;
  if(['ATTACK','DEFEND'].includes(action))return Boolean(combatReady());
  return ['FOLLOW','HOLD'].includes(action)&&base.supports(action)===true;
 }
 function combatEffect(row){
  const permitted=()=>{
   if(!live())return false;
   try{return a.transact([T,'items','characters'],tx=>
    orderWitness.verifyNativeActor(row,tx)===true&&
    combatAuthority.verify(row,tx)===true)===true;
   }catch{return false;}
  };
  if(!permitted())return {success:false,errorMsg:'PF95_COMBAT_ORIGINAL_TARGET_NOT_AUTHORIZED'};
  return orderBridge.issue({
   entityID:row.shipItemID,systemID:row.systemID,
   owner:'PERSONAL_FLEET',action:row.action==='ATTACK'?'pf-attack':'pf-guard',
   holdMs:120000,
   execute(){
    if(!permitted())return {success:false,errorMsg:'PF95_COMBAT_TARGET_REVOKED'};
    if(row.action==='ATTACK')
     return npcRuntime.issueAttackOrder(row.shipItemID,row.targetEntityID,
      {allowWeapons:true,keepLock:true,allowPodKill:false});
    // Disable hostile modules FIRST. If physical FOLLOW then fails,
    // the guard can never retain an ambient auto-aggro fire permit
    // against the protected owner while PF55 is still ISSUING.
    const disarm=npcRuntime.issueOrder(row.shipItemID,{
     type:'follow',targetID:row.targetEntityID,
     followRangeMeters:row.followRangeMeters,
     allowWeapons:false,keepLock:false,allowPodKill:false});
    if(disarm?.success!==true)return disarm;
    return npcRuntime.follow(row.shipItemID,row.targetEntityID,
      row.followRangeMeters,{wakeController:true});
   }
  });
 }
 function execute(row){
  if(!row||!supports(row.action))
   return {success:false,errorMsg:'PF_FIRSTPLAY_PHYSICAL_ORDER_NOT_AUTHORIZED'};
  const physical=['ATTACK','DEFEND'].includes(row.action)?combatEffect(row):base.execute(row);
  // Original bridge/runtime returned physical success. Post-effect native
  // movement + PF55 receipt MUST commit together in original SQLite. If this
  // fails, PF55 keeps ISSUING and NEVER redispatches the movement.
  if(physical?.success!==true||physical?.then)return physical;
  const persisted=['ATTACK','DEFEND'].includes(row.action)?
   combatReceipt.recordAfterEffect(row):orderReceipt.recordAfterNativeEffect(row);
  if(persisted?.success!==true)return {
   success:false,errorMsg:'PF55_NATIVE_EFFECT_OUTCOME_UNKNOWN_NO_RETRY'};
  return {success:true,data:{operationID:row.operationID,
   durability:'ORIGINAL_NPC_ENTITIES_AND_PF55_RECEIPT_COMMITTED'}};
 }
 function resumeCommitted(row){
  if(!live()||!combatReady()||!row||
     row.phase!=='ACKED'||!['ATTACK','DEFEND'].includes(row.action)||
     !positive(row.shipItemID)||!positive(row.systemID))
   return {success:false,errorMsg:'PF96_COMBAT_RESUME_NOT_AUTHORIZED'};
  let proven=false;
  // This is a READ-BACK of the committed original order, never a second
  // PF55 ISSUING or a second native receipt. The bridge's shared lease
  // remains the exclusive gate for any physical re-adoption.
  try{proven=a.transact([T,'items','characters','npcEntities','npcRuntimeControllers'],tx=>{
   const ledger=tx.get(T,pf55.key(row.shipItemID));
   const ix=tx.get(T,pf55.OP_INDEX);
   return ledger?.phase==='ACKED'&&ledger.operationID===row.operationID&&
     ledger.signature===row.signature&&
     row.signature===pf55.signature(row)&&
     ix?.operations?.[row.operationID]?.phase==='ACKED'&&
     ix.operations[row.operationID].signature===row.signature&&
     orderWitness.verifyNativeActor(row,tx)===true&&
     combatReceipt.verifyPersisted(row,tx)?.orderApplied===true&&
     combatAuthority.verify(row,tx)===true;
  })===true;}catch{proven=false;}
  if(!proven)return {success:false,errorMsg:'PF96_ORIGINAL_ACKED_COMBAT_SOURCE_NOT_PROVEN'};
  return combatEffect(row);
 }
 function canIssuePersonalCombat(row){
  if(!live()||!combatReady()||!row||
     !['ATTACK','DEFEND'].includes(row.action)||
     !positive(row.shipItemID)||!positive(row.systemID)||
     typeof orderBridge.diagnose!=='function')return false;
  try{return orderBridge.diagnose({entityID:row.shipItemID,
   systemID:row.systemID,owner:'PERSONAL_FLEET'}).status==='PERMITTED';}
  catch{return false;}
 }
 return Object.freeze({supports,execute,resumeCommitted,canIssuePersonalCombat,
  executeNativeReturn(row){
   if(!live()||!row||!positive(row.shipItemID)||!positive(row.stationID)||
      !positive(row.systemID)||!positive(row.actorGeneration))
    return {success:false,errorMsg:'PF56_RETURN_NATIVE_SOURCE_UNAVAILABLE'};
   const physical=nativeReturn.execute(row);
   if(physical?.success!==true||physical?.then)return physical;
   // Original stock native warp has begun. Only now store its source-bound
   // acceptance receipt in original npcEntities + PF56 SQLite, atomically.
   // Unknown commit leaves RETURN_ISSUING for explicit reconciliation;
   // never dispatch a second warp from the return scheduler.
   const durable=orderReceipt.recordAfterNativeReturnEffect(row);
   if(durable?.success!==true)return {
    success:false,errorMsg:'PF56_NATIVE_RETURN_EFFECT_OUTCOME_UNKNOWN_NO_RETRY'};
   return {success:true,data:{operationID:row.operationID,
    durability:'ORIGINAL_NPC_ENTITIES_AND_PF56_RETURN_RECEIPT_COMMITTED'}};
  },
  // Read-only; useful to diagnose a missing native assignment on WORK.
  inspectAssignments:()=>assignments().map(x=>Object.freeze({...x}))});
}
module.exports=Object.freeze({createOriginalOrderExecutor});
