"use strict";
// FW-003: durable exclusive native ship assignment, NOT a ship factory.
// One SQLite atomic row in the same authoritative GameStore as FW-001.
const TABLE="corporationRuntime",KEY="coop-faction-war\u001ffleet-registry-v1",VERSION=1;
const pos=x=>Number.isSafeInteger(x)&&x>0;
const valid=x=>typeof x==="string"&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const pilot=x=>typeof x==="string"&&/^coop-pilot-[0-9]{3,}$/.test(x);
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const empty=()=>({version:VERSION,ships:{},processed:{},history:[]});
function validate(s){
 if(!s||s.version!==VERSION||!s.ships||typeof s.ships!=="object"||
  Array.isArray(s.ships)||!s.processed||typeof s.processed!=="object"||
  Array.isArray(s.processed)||!Array.isArray(s.history)||
  Object.keys(s.ships).length>256||Object.keys(s.processed).length>2048||
  s.history.length>128)throw Error("FW_FLEET_REGISTRY_INVALID");
 const pilots=new Set();
 for(const [key,v] of Object.entries(s.ships)){
  if(!pos(Number(key))||String(Number(key))!==key||!pos(v?.entityID)||
   String(v.entityID)!==key||!pos(v.systemID)||!pos(v.corporationID)||
   !pos(v.factionID)||!valid(v.fleetID)||!valid(v.warID)||
   !valid(v.campaignID)||!pilot(v.pilotID)||pilots.has(v.pilotID))
    throw Error("FW_FLEET_REGISTRY_CORRUPT_SHIP");
  pilots.add(v.pilotID);
 }
 return s;
}
function createWarFleetRegistry({gameStore,verifyNativeShip,verifyCampaign,
 verifyRelease,clock=()=>Date.now(),env=process.env}={}){
 if(typeof gameStore?.coopAtomicNativeRows?.transact!=="function"||
  [verifyNativeShip,verifyCampaign,verifyRelease,clock].some(x=>typeof x!=="function"))
   throw Error("FW_FLEET_NATIVE_AUTHORITIES_REQUIRED");
 const enabled=()=>env.EVEJS_COOP_FACTION_WAR==="1"&&
  env.EVEJS_COOP_FACTION_WAR_FLEETS==="1"&&env.EVEJS_COOP_NATIVE_ATOMIC_ROWS==="1";
 const transact=fn=>gameStore.coopAtomicNativeRows.transact([TABLE],fn);
 let inWrite=false;
 function snapshot(){
  if(!enabled())return {status:"DISABLED"};
  return transact(tx=>structuredClone(validate(tx.get(TABLE,KEY)||empty())));
 }
 function claim(link){
  if(!enabled())return "DISABLED";
  try{
   const state=snapshot(),v=state.ships[String(link?.entityID)];
   if(!v)return "UNASSIGNED";
   return v.entityID===link.entityID&&v.pilotID===link.pilotID&&
    v.systemID===link.systemID?"ASSIGNED":"UNKNOWN";
  }catch{return "UNKNOWN"}
 }
 function execute(command){
  if(!enabled())return {status:"DISABLED"};
  if(inWrite)return {status:"BLOCKED",reason:"FW_FLEET_REENTRANT"};
  if(!command||!valid(command.eventID)||!["ASSIGN","RELEASE"].includes(command.type))
   return {status:"BLOCKED",reason:"INVALID_COMMAND"};
  inWrite=true;
  try{
   return transact(tx=>{
    const s=validate(tx.get(TABLE,KEY)||empty());
    const signature=JSON.stringify(command),prior=own(s.processed,command.eventID)?
     s.processed[command.eventID]:null;
    if(prior)return prior.signature===signature?{status:"DUPLICATE",receipt:prior.receipt}:
     {status:"BLOCKED",reason:"EVENT_REPLAY_CONFLICT"};
    if(Object.keys(s.processed).length>=2048)return {status:"BLOCKED",reason:"FLEET_EVENT_CAP"};
    const id=String(command.entityID),priorShip=s.ships[id];
    let receipt;
    if(command.type==="ASSIGN"){
     const {entityID,systemID,pilotID,corporationID,factionID,fleetID,warID,campaignID,proofID}=command;
     if(!pos(entityID)||!pos(systemID)||!pilot(pilotID)||!pos(corporationID)||
      !pos(factionID)||!valid(fleetID)||!valid(warID)||!valid(campaignID)||
      !valid(proofID)||priorShip||
      Object.values(s.ships).some(v=>v.pilotID===pilotID)||
      Object.keys(s.ships).length>=256)return {status:"BLOCKED",reason:"FLEET_IDENTITY_OR_CAP_CONFLICT"};
     const details={entityID,systemID,pilotID,corporationID,factionID,fleetID,warID,campaignID,proofID};
     let ok=false;try{ok=verifyNativeShip(details)===true&&verifyCampaign(details,tx)===true}catch{}
     if(!ok)return {status:"BLOCKED",reason:"NATIVE_SHIP_OR_CAMPAIGN_UNVERIFIED"};
     s.ships[id]={...details,assignedAt:clock()};
     receipt={type:"ASSIGN",entityID,pilotID,systemID,fleetID,warID,campaignID};
    }else{
     if(!priorShip||!valid(command.proofID)||command.pilotID!==priorShip.pilotID||
      command.fleetID!==priorShip.fleetID)return {status:"BLOCKED",reason:"SHIP_NOT_IN_FLEET"};
     let ok=false;try{ok=verifyRelease({...priorShip,proofID:command.proofID})===true}catch{}
     if(!ok)return {status:"BLOCKED",reason:"NATIVE_RELEASE_UNVERIFIED"};
     delete s.ships[id];
     receipt={type:"RELEASE",entityID:priorShip.entityID,fleetID:priorShip.fleetID};
    }
    const at=clock();
    if(!pos(at))throw Error("FW_FLEET_CLOCK_INVALID");
    s.processed[command.eventID]={signature,receipt};
    s.history.push({eventID:command.eventID,at,...receipt});
    if(s.history.length>128)s.history.splice(0,s.history.length-128);
    validate(s);tx.put(TABLE,KEY,s);
    return {status:"APPLIED",receipt};
   });
  }finally{inWrite=false}
 }
 return Object.freeze({snapshot,claim,execute});
}
module.exports={TABLE,KEY,empty,validate,createWarFleetRegistry};
