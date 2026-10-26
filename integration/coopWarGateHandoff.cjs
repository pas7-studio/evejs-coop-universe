"use strict";
// FW-007B: conservative multi-durable-owner military transfer saga.
// EveJS scene/nativeStore, JSON pilot registry, and SQLite warship registry
// cannot commit atomically. An unresolved phase ALWAYS blocks further travel.
const {createWarTransferLedger}=require("./coopWarTransferLedger"+
 (__filename.endsWith(".js")?"":".cjs"));
const {createNativeGateTransfer}=require("./coopNativeGateTransfer"+
 (__filename.endsWith(".js")?"":".cjs"));
const pos=x=>Number.isSafeInteger(x)&&x>0;
const flag=env=>env.EVEJS_COOP_FACTION_WAR_NATIVE_TRANSFER==="1"&&
 env.EVEJS_COOP_FACTION_WAR_GATE_APPROACH==="1"&&
 env.EVEJS_COOP_FACTION_WAR==="1"&&
 env.EVEJS_COOP_FACTION_WAR_FLEETS==="1"&&
 env.EVEJS_COOP_WAR_TREASURY==="1"&&
 env.EVEJS_COOP_NATIVE_ATOMIC_ROWS==="1"&&
 env.EVEJS_COOP_DURABLE_NPC_SHIPS==="1"&&
 env.EVEJS_COOP_NATIVE_GATE_APPROACH==="1"&&
 env.EVEJS_COOP_NATIVE_GATE_TRANSFER==="1"&&
 (env.EVEJS_COOP_ALIFE==="1"||env.EVEJS_COOP_NPC_ORDER_ARBITER==="1");
function createWarGateHandoff({gameStore,identityRegistry,sceneForSystem,
 getGate,nativeStore,service,getController,isScrambled,clock=()=>Date.now(),
 journalDir="/var/lib/evejs/coop-war-native-transfers",env=process.env,
 nativeTransferFactory=createNativeGateTransfer}={}){
 if(typeof identityRegistry?.relocate!=="function"||
  typeof identityRegistry.snapshot!=="function"||
  [sceneForSystem,getGate,getController,isScrambled,clock]
   .some(x=>typeof x!=="function")||
  typeof nativeTransferFactory!=="function"||
  !service||!nativeStore)throw Error("WAR_NATIVE_TRANSFER_AUTHORITIES_REQUIRED");
 const ledger=createWarTransferLedger({
  gameStore,identityRegistry,sceneForSystem,nativeStore,getController,clock,env
 });
 let active=null;
 const facade={
  snapshot:()=>identityRegistry.snapshot(),
  relocate(pilotID,from,entityID,to){
   if(!active||active.pilotID!==pilotID||
    active.entityID!==entityID||active.sourceSystemID!==from||
    active.destinationSystemID!==to)
    return {status:"WAR_HANDOFF_NOT_PREPARED"};
   const receipt={transferID:active.transferID,entityID};
   const commit=ledger.nativeCommit(receipt);
   if(commit.status!=="NATIVE_COMMITTED")
    throw Error("WAR_FLEET_SQL_RELOCATION_UNVERIFIED");
   const linked=identityRegistry.relocate(pilotID,from,entityID,to);
   if(linked?.status!=="RELOCATED")
    throw Error("WAR_PILOT_JSON_RELOCATION_UNVERIFIED");
   const complete=ledger.finish(receipt);
   if(complete.status!=="COMPLETE")
    throw Error("WAR_HANDOFF_COMPLETE_UNVERIFIED");
   return linked;
  }
 };
 const nativeTransfer=nativeTransferFactory({
  sceneForSystem,getGate,store:nativeStore,service,getController,
  registry:facade,journalDir,clock,isScrambled
 });
 function auditStartup(){
  if(!flag(env))return {status:"DISABLED"};
  // Never let the stock recovery roll back a ship whose military fleet
  // ledger may already have committed its destination. Require inspected
  // operator recovery rather than guessing a physical path after a crash.
  const pending=ledger.pending();
  if(pending.status!=="CLEAN")return pending;
  // COMPLETE in the SQL ledger is not enough to accept a crash recovery.
  // Verify persisted native controller, ship, cargo and pilot location first.
  const audit=ledger.auditPersisted();
  if(audit.status!=="CLEAN")return audit;
  // On startup the physical scenes may not yet have been restored.
  // Running stock rollback here could remove a correctly committed
  // destination hull. Audit the fsynced journal without mutating it.
  // Operator recovery must separately reconcile scene/SQL/JSON first.
  let names=[];
  try{names=require("node:fs").readdirSync(journalDir)}
  catch(e){if(e?.code!=="ENOENT")
   return {status:"NEEDS_OPERATOR_REPAIR",problems:["TRANSFER_JOURNAL_NOT_READABLE"]}}
  if(names.length)return {status:"NEEDS_OPERATOR_REPAIR",
   problems:["UNRESOLVED_NATIVE_TRANSFER_FILES"],count:names.length};
  return {status:"CLEAN"};
 }
 function transfer({pilotID,entityID,gate,sourceScene,ship,controller}={}){
  if(!flag(env))return {success:false,errorMsg:"WAR_HANDOFF_DISABLED"};
  if(active)return {success:false,errorMsg:"WAR_HANDOFF_ACTIVE"};
  const from=gate?.sourceSystemID,to=gate?.destinationSystemID;
  if(!pos(entityID)||!pos(from)||!pos(to)||from===to||
   !/^coop-pilot-[0-9]{3,}$/.test(String(pilotID))||
   sourceScene?.systemID!==from||ship?.itemID!==entityID||
   controller?.entityID!==entityID)
   return {success:false,errorMsg:"WAR_HANDOFF_INVALID_REQUEST"};
  const transferID="fw:"+entityID+":"+from+":"+to;
  const start=ledger.begin({transferID,entityID,
   sourceSystemID:from,destinationSystemID:to});
  if(start.status!=="PREPARED")
   return {success:false,errorMsg:start.reason||"WAR_HANDOFF_PREPARE_FAILED"};
  active={transferID,entityID,sourceSystemID:from,
   destinationSystemID:to,pilotID};
  let answer;
  try{answer=nativeTransfer.transfer({pilotID,entityID,gate,
   sourceScene,ship,controller});}
  catch{return {success:false,errorMsg:"WAR_NATIVE_TRANSFER_OUTCOME_UNKNOWN"}}
  finally{active=null}
  // All downstream acknowledgements must agree with the persisted SQL.
  if(answer?.success===true){
   try{
    const remains=ledger.pending();
    if(remains.status!=="CLEAN"||answer.entityID!==entityID||
     answer.systemID!==to||answer.verifiedSourceAbsent!==true||
     answer.verifiedDestinationPresent!==true||
     answer.preservedCargo!==true||answer.preservedModules!==true)
     return {success:false,errorMsg:"WAR_HANDOFF_COMPLETE_NOT_CONFIRMED"};
   }catch{return {success:false,errorMsg:"WAR_HANDOFF_STATE_UNAVAILABLE"}}
   return answer;
  }
  // Native transfer could have rolled back, or failed at preflight.
  // Only exact source physical + cargo + pilot proof can release a pending
  // fleet transfer. Else its SQL state remains a durable quarantine.
  try{
   const aborted=ledger.abort({transferID,entityID});
   if(aborted.status!=="ABORTED"){
    const restored=ledger.restore({transferID,entityID});
    if(restored.status!=="ABORTED")
     return {success:false,errorMsg:"WAR_HANDOFF_NEEDS_OPERATOR_REPAIR"};
   }
  }catch{return {success:false,errorMsg:"WAR_HANDOFF_NEEDS_OPERATOR_REPAIR"}}
  return {success:false,errorMsg:answer?.errorMsg||"WAR_NATIVE_TRANSFER_NOT_APPLIED"};
 }
 function recovery({authorizeOperator,io}={}){
  if(typeof authorizeOperator!=="function")
   throw Error("WAR_RECOVERY_TRUSTED_OPERATOR_AUTH_REQUIRED");
  return require("./coopWarRecoveryConsole"+
   (__filename.endsWith(".js")?"":".cjs")).createWarRecoveryConsole({
    ledger,identityRegistry,authorizeOperator,journalDir,env,
    ...(io?{io}:{})
   });
 }
 return Object.freeze({transfer,auditStartup,pending:ledger.pending,recovery});
}
module.exports={createWarGateHandoff,flag};
