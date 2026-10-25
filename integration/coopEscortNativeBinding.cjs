"use strict";
// Stage E: stable, one-shot authoritative bridge from native station route
// to native-funded escort. No automatic wallet or client override.
const flags=["EVEJS_COOP_ESCORT_CONTRACTS","EVEJS_COOP_ESCORT_ROUTE_GATE",
 "EVEJS_COOP_NATIVE_ATOMIC_ROWS","EVEJS_COOP_NATIVE_ESCORT_WALLET",
 "EVEJS_COOP_NATIVE_HAUL_MANIFEST"];
const pos=x=>Number.isSafeInteger(x)&&x>0;
let installed=null;
const deny=status=>({status});
const enabled=()=>flags.every(k=>process.env[k]==="1");
function makeBinding({runtime,readNativeIncident,recordTerminal=null}={}){
 if(recordTerminal!==null&&typeof recordTerminal!=="function")
  throw Error("ESCORT_REPUTATION_SOURCE_INVALID");
 if(!runtime||typeof readNativeIncident!=="function"||
  ["fundBeforeWarp","recordDelivery","finishAfterRaid","refundProvenLoss",
   "readFlight","inspectRefundRecovery","refundWreckedFlight"].some(k=>typeof runtime[k]!=="function")||
  runtime.nativeFunds?.capabilities?.().nativeDurable!==true||
  runtime.nativeFunds?.capabilities?.().atomicDualCredit!==true)
  throw Error("ESCORT_NATIVE_BINDING_AUTHORITIES_REQUIRED");
 return Object.freeze({
  fundBeforeWarp(route){
   if(!enabled())return deny("DISABLED");
   if(!route||![route.systemID,route.fleetID,route.stationID,route.corporationID].every(pos)||
    !Array.isArray(route.haulerIDs)||route.haulerIDs.length!==1||
    !pos(route.haulerIDs[0]))return deny("NATIVE_PREWARP_ROUTE_UNVERIFIED");
   try{return runtime.fundBeforeWarp(route)}
   catch{return deny("NATIVE_PREWARP_FUNDING_UNCERTAIN_REPAIR_REQUIRED")}
  },
  recordDelivered(args){
   if(!enabled())return deny("DISABLED");
   const trip=args?.trip;
   if(!trip||![trip.systemID,trip.fleetID,trip.stationID,trip.corporationID].every(pos)||
    typeof trip.manifestID!=="string"||args?.manifestKey!==trip.manifestID||
    args?.terminalProof?.status!=="DELIVERED"||
    args?.terminalProof?.terminal!==true)
    return deny("NATIVE_TERMINAL_ROUTE_UNVERIFIED");
   try{return runtime.recordDelivery(args)}
   catch{return deny("NATIVE_TERMINAL_WRITE_UNCERTAIN_REPAIR_REQUIRED")}
  },
  settleVerifiedNativeRaid(manifestKey){
   if(!enabled())return deny("DISABLED");
   if(typeof manifestKey!=="string"||!/^\d+-\d+-\d+$/.test(manifestKey))
    return deny("NATIVE_SETTLEMENT_MANIFEST_INVALID");
   let flight;try{flight=runtime.readFlight(manifestKey)}
   catch{return deny("NATIVE_FLIGHT_JOURNAL_UNAVAILABLE")}
   if(flight?.status!=="READY"||flight.phase!=="DELIVERED")
    return deny("NATIVE_FLIGHT_DELIVERY_NOT_RECORDED");
   const b=flight.booking;
   let incidents;try{incidents=readNativeIncident()}
   catch{return deny("NATIVE_INCIDENTS_UNAVAILABLE")}
   if(incidents?.status!=="READY"||!Array.isArray(incidents.incidents))
    return deny("NATIVE_INCIDENTS_UNVERIFIED");
   const matches=incidents.incidents.filter(i=>i.systemID===b.systemID&&
    i.targetID===b.haulerID&&i.targetRole==="hauler"&&
    i.status==="PIRATE_WRECK_CONFIRMED"&&i.closed===true&&
    pos(i.pirateID)&&pos(i.nativeWreckID)&&pos(i.duoFleetID)&&
    Array.isArray(i.characters)&&i.characters.length===2&&
    i.characters[0]===b.characters[0]&&i.characters[1]===b.characters[1]&&
    i.key===String(b.systemID)+":"+i.pirateID+":"+b.haulerID);
   if(matches.length!==1)return deny(matches.length?
    "NATIVE_INCIDENT_AMBIGUOUS":"NO_VERIFIED_NATIVE_RAID_TO_SETTLE");
   const i=matches[0];
   const contract={contractID:b.contractID,manifestKey:b.manifestKey,
    systemID:b.systemID,fleetID:b.fleetID,haulerID:b.haulerID,
    stationID:b.stationID,corporationID:b.corporationID,
    pirateID:i.pirateID,incidentKey:i.key,fleetDuoID:i.duoFleetID,
    characters:b.characters.slice(),amountISK:b.amountISK};
   let result;try{result=runtime.finishAfterRaid(contract)}
   catch{return deny("NATIVE_SETTLEMENT_UNCERTAIN_REPAIR_REQUIRED")}
   if(result?.status==="SETTLED"&&recordTerminal){
    let history;try{history=recordTerminal(contract.contractID)}
    catch{history={status:"NATIVE_HISTORY_WRITE_UNAVAILABLE"}}
    return {...result,historyStatus:history?.status||"NATIVE_HISTORY_WRITE_UNAVAILABLE"};
   }
   return result;
  },
  refundNativeWreck:manifestKey=>{
   if(!enabled()||process.env.EVEJS_COOP_ESCORT_REFUNDS!=="1")
    return deny("DISABLED");
   if(typeof manifestKey!=="string"||!/^\d+-\d+-\d+$/.test(manifestKey))
    return deny("NATIVE_REFUND_MANIFEST_KEY_INVALID");
   let result;try{result=runtime.refundWreckedFlight(manifestKey)}
   catch{return deny("NATIVE_REFUND_OUTCOME_UNCERTAIN_REPAIR_REQUIRED")}
   if(result?.status==="REFUNDED"&&recordTerminal){
    let history;try{history=recordTerminal(result.contractID)}
    catch{history={status:"NATIVE_HISTORY_WRITE_UNAVAILABLE"}}
    return {...result,historyStatus:history?.status||"NATIVE_HISTORY_WRITE_UNAVAILABLE"};
   }
   return result;
  },
  readFlight:key=>runtime.readFlight(key),
  inspectRefundRecovery:id=>runtime.inspectRefundRecovery(id)
 });
}
const forwarding=Object.freeze({
 fundBeforeWarp:route=>enabled()?(installed?installed.fundBeforeWarp(route):
  deny("ESCORT_NATIVE_RUNTIME_NOT_INSTALLED")):deny("DISABLED"),
 recordDelivered:args=>enabled()?(installed?installed.recordDelivered(args):
  deny("ESCORT_NATIVE_RUNTIME_NOT_INSTALLED")):deny("DISABLED"),
 settleVerifiedNativeRaid:key=>enabled()?(installed?installed.settleVerifiedNativeRaid(key):
  deny("ESCORT_NATIVE_RUNTIME_NOT_INSTALLED")):deny("DISABLED"),
 refundNativeWreck:key=>enabled()?(installed?installed.refundNativeWreck(key):
  deny("ESCORT_NATIVE_RUNTIME_NOT_INSTALLED")):deny("DISABLED"),
 readFlight:key=>enabled()?(installed?installed.readFlight(key):
  deny("ESCORT_NATIVE_RUNTIME_NOT_INSTALLED")):deny("DISABLED")
});
function routeGate(){return forwarding}
function installServerAuthority({runtime,readNativeIncident,recordTerminal=null}={}){
 if(!enabled())return deny("DISABLED");
 if(installed)return deny("ESCORT_RUNTIME_ALREADY_BOUND");
 try{installed=makeBinding({runtime,readNativeIncident,recordTerminal})}
 catch{return deny("ESCORT_NATIVE_BINDING_AUTHORITIES_REQUIRED")}
 return {status:"ESCORT_NATIVE_RUNTIME_BOUND"};
}
function settlement(manifestKey){
 if(!enabled())return deny("DISABLED");
 return installed?installed.settleVerifiedNativeRaid(manifestKey):
  deny("ESCORT_NATIVE_RUNTIME_NOT_INSTALLED");
}
function inspect(){return {status:installed?"ESCORT_NATIVE_RUNTIME_BOUND":
 "ESCORT_NATIVE_RUNTIME_NOT_INSTALLED",enabled:enabled(),
 backend:installed?"IN_PROCESS_NATIVE_ONLY":null}}
module.exports={makeBinding,routeGate,installServerAuthority,settlement,inspect};
