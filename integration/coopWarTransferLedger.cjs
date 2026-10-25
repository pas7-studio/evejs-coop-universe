"use strict";
// FW-007B: one durable military handoff ledger in the EXISTING fleet SQL row.
// The scene + native entity, JSON pilot link and SQLite fleet row are not
// a single ACID transaction. Fence intermediate states, do not infer success.
const crypto=require("node:crypto");
const fleet=require("./coopWarFleetRegistry"+(__filename.endsWith(".js")?"":".cjs"));
const warStore=require("./coopFactionWarStore"+(__filename.endsWith(".js")?"":".cjs"));
const treasury=require("./coopWarTreasury"+(__filename.endsWith(".js")?"":".cjs"));
const pos=x=>Number.isSafeInteger(x)&&x>0;
const owns=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const key=x=>typeof x==="string"&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const phase=new Set(["PREPARED","NATIVE_COMMITTED","COMPLETE","ABORTED"]);
function fingerprint(rows,idKey){
 if(!Array.isArray(rows)||rows.length>2048)return null;
 const seen=new Set();
 const sorted=[];
 for(const v of rows){
  const id=v?.[idKey];
  if(!pos(id)||seen.has(id)||v?.transient===true)return null;
  seen.add(id);sorted.push(v);
 }
 sorted.sort((a,b)=>a[idKey]-b[idKey]);
 return crypto.createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}
function createWarTransferLedger({gameStore,identityRegistry,sceneForSystem,
 nativeStore,getController,clock=()=>Date.now(),env=process.env}={}){
 if(typeof gameStore?.coopAtomicNativeRows?.transact!=="function"||
  typeof identityRegistry?.snapshot!=="function"||
  [sceneForSystem,getController,clock].some(x=>typeof x!=="function")||
  !nativeStore||["getNativeEntity","listNativeModulesForEntity",
   "listNativeCargoForEntity"].some(x=>typeof nativeStore[x]!=="function"))
  throw Error("WAR_HANDOFF_NATIVE_AUTHORITIES_REQUIRED");
 const enabled=()=>env.EVEJS_COOP_FACTION_WAR==="1"&&
  env.EVEJS_COOP_FACTION_WAR_FLEETS==="1"&&
  env.EVEJS_COOP_FACTION_WAR_NATIVE_TRANSFER==="1"&&
  env.EVEJS_COOP_NATIVE_ATOMIC_ROWS==="1";
 const transact=fn=>gameStore.coopAtomicNativeRows.transact([fleet.TABLE],fn);
 function inspect(row,systemID,physical){
  try{
   const scene=sceneForSystem(systemID);
   if(scene?.systemID!==systemID||typeof scene.getEntityByID!=="function")
    return null;
   const ship=scene.getEntityByID(row.entityID);
   const native=nativeStore.getNativeEntity(row.entityID),
    c=getController(row.entityID);
   if(physical===true){
    if(ship?.kind!=="ship"||ship.nativeNpc!==true||
     ship.itemID!==row.entityID||ship.session?.characterID||
     ship.corporationID!==row.corporationID||
     native?.entityID!==row.entityID||native.systemID!==systemID||
     native.corporationID!==row.corporationID||
     c?.entityID!==row.entityID||c.systemID!==systemID)return null;
   }else{
    if(ship||native?.systemID===systemID||c?.systemID===systemID)return null;
   }
   return {ship,native,controller:c};
  }catch{return null}
 }
 function identity(row,systemID){
  try{
   const links=identityRegistry.snapshot()?.links;
   const link=links?.[row.pilotID];
   if(!link||link.entityID!==row.entityID||link.systemID!==systemID)
    return false;
   return Object.values(links).filter(x=>x?.entityID===row.entityID||
    x?.pilotID===row.pilotID).length===1;
  }catch{return false}
 }
 function digests(row){
  try{
   const modules=nativeStore.listNativeModulesForEntity(row.entityID),
    cargo=nativeStore.listNativeCargoForEntity(row.entityID);
   return {modules:fingerprint(modules,"moduleID"),
    cargo:fingerprint(cargo,"cargoID")};
  }catch{return {modules:null,cargo:null}}
 }
 function validate(row,entry){
  if(!row||!entry||!key(entry.transferID)||!phase.has(entry.phase)||
   !pos(entry.entityID)||!pos(entry.sourceSystemID)||
   !pos(entry.destinationSystemID)||entry.sourceSystemID===entry.destinationSystemID||
   !key(entry.campaignID)||!key(entry.warID)||!key(entry.pilotID.replace(/^coop-pilot-/,"p"))||
   !/^[a-f0-9]{64}$/.test(entry.modulesHash)||!/^[a-f0-9]{64}$/.test(entry.cargoHash)||
   row.entityID!==entry.entityID||row.pilotID!==entry.pilotID||
   row.campaignID!==entry.campaignID||row.warID!==entry.warID)
   throw Error("WAR_HANDOFF_RECORD_CORRUPT");
 }
 function operation(type,req){
  if(!enabled())return {status:"DISABLED"};
  const id=req?.entityID,transferID=req?.transferID;
  if(!pos(id)||!key(transferID)||!["BEGIN","NATIVE_COMMIT","FINISH","ABORT","RESTORE"].includes(type))
   return {status:"BLOCKED",reason:"INVALID_WAR_HANDOFF_COMMAND"};
  return transact(tx=>{
   const s=fleet.validate(tx.get(fleet.TABLE,fleet.KEY));
   const row=s.ships[String(id)];
   if(!row)return {status:"BLOCKED",reason:"WAR_HULL_NOT_REGISTERED"};
   if(!s.transfers)s.transfers={};
   if(Object.keys(s.transfers).length>128)
    return {status:"BLOCKED",reason:"WAR_HANDOFF_LEDGER_CAP"};
   const prior=s.transfers[String(id)];
   const timestamp=clock();
   if(!pos(timestamp))throw Error("WAR_HANDOFF_CLOCK_INVALID");
   let entry;
   if(type==="BEGIN"){
    if(prior)return {status:"BLOCKED",reason:"WAR_HANDOFF_ALREADY_RECORDED"};
    const {sourceSystemID:from,destinationSystemID:to}=req;
    if(!pos(from)||!pos(to)||from===to||row.systemID!==from||
     !identity(row,from)||!inspect(row,from,true)||!inspect(row,to,false))
     return {status:"BLOCKED",reason:"WAR_HANDOFF_SOURCE_UNVERIFIED"};
    const w=tx.get(fleet.TABLE,warStore.KEY),
     t=tx.get(fleet.TABLE,treasury.KEY),
     campaign=w?.campaigns?.[row.campaignID],war=w?.wars?.[row.warID],
     funds=t?.reservations?.[campaign?.supplyReservationID];
    if(w?.version!==1||t?.version!==1||
     war?.state!=="ACTIVE"||campaign?.state!=="PREPARING"||
     campaign.sourceSystemID!==from||campaign.targetSystemID!==to||
     row.factionID!==war.attackerFactionID||
     funds?.status!=="HELD"||funds.warID!==row.warID||
     funds.campaignID!==row.campaignID||
     funds.factionID!==row.factionID||!pos(funds.cents))
     return {status:"BLOCKED",reason:"WAR_HANDOFF_CAMPAIGN_OR_FUNDS_UNVERIFIED"};
    const hashes=digests(row);
    if(!hashes.modules||!hashes.cargo)
     return {status:"BLOCKED",reason:"WAR_HANDOFF_CUSTODY_UNVERIFIED"};
    entry={transferID,entityID:id,pilotID:row.pilotID,
     warID:row.warID,campaignID:row.campaignID,
     sourceSystemID:from,destinationSystemID:to,
     modulesHash:hashes.modules,cargoHash:hashes.cargo,
     phase:"PREPARED",createdAt:timestamp,updatedAt:timestamp};
   }else{
    if(!prior||prior.transferID!==transferID)
     return {status:"BLOCKED",reason:"WAR_HANDOFF_RECEIPT_MISSING"};
    validate(row,prior);
    if(type==="NATIVE_COMMIT"){
     if(prior.phase!=="PREPARED"||row.systemID!==prior.sourceSystemID||
      !identity(row,prior.sourceSystemID)||
      !inspect(row,prior.sourceSystemID,false)||
      !inspect(row,prior.destinationSystemID,true))
      return {status:"BLOCKED",reason:"WAR_HANDOFF_NATIVE_DESTINATION_UNVERIFIED"};
     const hashes=digests(row);
     if(hashes.modules!==prior.modulesHash||hashes.cargo!==prior.cargoHash)
      return {status:"BLOCKED",reason:"WAR_HANDOFF_CUSTODY_CHANGED"};
     row.systemID=prior.destinationSystemID;
     entry={...prior,phase:"NATIVE_COMMITTED",updatedAt:timestamp};
    }else if(type==="FINISH"){
     if(prior.phase!=="NATIVE_COMMITTED"||
      row.systemID!==prior.destinationSystemID||
      !identity(row,prior.destinationSystemID)||
      !inspect(row,prior.destinationSystemID,true)||
      !inspect(row,prior.sourceSystemID,false))
      return {status:"BLOCKED",reason:"WAR_HANDOFF_IDENTITY_NOT_COMMITTED"};
     const hashes=digests(row);
     if(hashes.modules!==prior.modulesHash||hashes.cargo!==prior.cargoHash)
      return {status:"BLOCKED",reason:"WAR_HANDOFF_CUSTODY_CHANGED"};
     entry={...prior,phase:"COMPLETE",updatedAt:timestamp};
    }else if(type==="ABORT"||type==="RESTORE"){
     const expected=type==="ABORT"?"PREPARED":"NATIVE_COMMITTED";
     if(prior.phase!==expected||
      row.systemID!==(type==="ABORT"?prior.sourceSystemID:prior.destinationSystemID)||
      !identity(row,prior.sourceSystemID)||
      !inspect(row,prior.sourceSystemID,true)||
      !inspect(row,prior.destinationSystemID,false))
      return {status:"BLOCKED",reason:"WAR_HANDOFF_SOURCE_NOT_RESTORED"};
     const hashes=digests(row);
     if(hashes.modules!==prior.modulesHash||hashes.cargo!==prior.cargoHash)
      return {status:"BLOCKED",reason:"WAR_HANDOFF_CUSTODY_CHANGED"};
     if(type==="RESTORE")row.systemID=prior.sourceSystemID;
     entry={...prior,phase:"ABORTED",updatedAt:timestamp};
    }
   }
   s.transfers[String(id)]=entry;
   fleet.validate(s);
   tx.put(fleet.TABLE,fleet.KEY,s);
   return {status:entry.phase,transferID,entityID:id,
    sourceSystemID:entry.sourceSystemID,
    destinationSystemID:entry.destinationSystemID};
  });
 }
 function auditPersisted(){
  if(!enabled())return {status:"DISABLED",problems:[]};
  let state;
  try{state=transact(tx=>fleet.validate(tx.get(fleet.TABLE,fleet.KEY)))}
  catch{return {status:"NEEDS_OPERATOR_REPAIR",problems:[{reason:"SQL_FLEET_NOT_READABLE"}]}}
  const problems=[];
  for(const flight of Object.values(state.transfers||{})){
   const ship=state.ships[String(flight.entityID)];
   if(!ship||!["COMPLETE","ABORTED"].includes(flight.phase)){
    problems.push({entityID:flight.entityID,reason:"TRANSFER_IN_FLIGHT"});continue;
   }
   const system=flight.phase==="COMPLETE"?
    flight.destinationSystemID:flight.sourceSystemID;
   const hashes=digests(ship);
   let native,controller;
   try{
    native=nativeStore.getNativeEntity(ship.entityID);
    controller=nativeStore.getNativeController(ship.entityID);
   }catch{}
   if(typeof nativeStore.getNativeController!=="function"||
    ship.systemID!==system||!identity(ship,system)||
    native?.entityID!==ship.entityID||native.systemID!==system||
    native.corporationID!==ship.corporationID||
    controller?.entityID!==ship.entityID||controller.systemID!==system||
    hashes.modules!==flight.modulesHash||
    hashes.cargo!==flight.cargoHash)
    problems.push({entityID:ship.entityID,reason:"COMPLETED_NATIVE_CUSTODY_DRIFT"});
  }
  return {status:problems.length?"NEEDS_OPERATOR_REPAIR":"CLEAN",
   problems:problems.slice(0,50)};
 }
 // Source-backed read-only witness. A witnessed native row is evidence
 // only when BOTH physical scenes are currently loaded; missing scenes are
 // never treated as an absent ship.
 function witness(entityID){
  if(!enabled())return {status:"DISABLED"};
  if(!pos(entityID))return {status:"INVALID_ENTITY"};
  let state;
  try{state=transact(tx=>structuredClone(fleet.validate(tx.get(fleet.TABLE,fleet.KEY))))}
  catch{return {status:"UNAVAILABLE",reason:"FLEET_SQL_READ_FAILED"}}
  const row=state.ships[String(entityID)],
   flight=state.transfers?.[String(entityID)];
  if(!row||!flight)return {status:"NO_ACTIVE_TRANSFER"};
  try{validate(row,flight)}catch{return {status:"UNSAFE",reason:"CORRUPT_TRANSFER"}}
  const from=flight.sourceSystemID,to=flight.destinationSystemID;
  let fromScene,toScene,entity,controller,links;
  try{
   fromScene=sceneForSystem(from);toScene=sceneForSystem(to);
   entity=nativeStore.getNativeEntity(entityID);
   controller=getController(entityID);
   links=identityRegistry.snapshot()?.links;
  }catch{return {status:"UNSAFE",reason:"NATIVE_READ_FAILED"}}
  if(fromScene?.systemID!==from||toScene?.systemID!==to||
   typeof fromScene.getEntityByID!=="function"||
   typeof toScene.getEntityByID!=="function")
   return {status:"UNSAFE",reason:"PHYSICAL_SCENE_NOT_LOADED"};
  let sourceShip,destinationShip;
  try{
   sourceShip=fromScene.getEntityByID(entityID);
   destinationShip=toScene.getEntityByID(entityID);
  }catch{return {status:"UNSAFE",reason:"SCENE_LOOKUP_FAILED"}}
  if(Boolean(sourceShip)===Boolean(destinationShip))
   return {status:"UNSAFE",reason:sourceShip?"DUPLICATE_PHYSICAL_HULL":"NO_PHYSICAL_HULL"};
  const physicalSystemID=sourceShip?from:to,ship=sourceShip||destinationShip,
   nativeID=entity?.entityID,controllerID=controller?.entityID;
  if(ship?.kind!=="ship"||ship.nativeNpc!==true||
   ship.itemID!==entityID||ship.session?.characterID||
   ship.corporationID!==row.corporationID||
   nativeID!==entityID||controllerID!==entityID||
   entity.systemID!==physicalSystemID||controller.systemID!==physicalSystemID||
   entity.corporationID!==row.corporationID)
   return {status:"UNSAFE",reason:"NATIVE_ENTITY_OR_CONTROLLER_MISMATCH"};
  const link=links?.[flight.pilotID];
  if(!link||link.entityID!==entityID||
   ![from,to].includes(link.systemID)||
   Object.values(links).filter(v=>v?.entityID===entityID||
    v?.pilotID===flight.pilotID).length!==1)
   return {status:"UNSAFE",reason:"PILOT_IDENTITY_CONFLICT"};
  const hashes=digests(row);
  if(hashes.modules!==flight.modulesHash||hashes.cargo!==flight.cargoHash)
   return {status:"UNSAFE",reason:"MODULE_OR_CARGO_FINGERPRINT_CHANGED"};
  let action=null;
  if(flight.phase==="PREPARED"&&row.systemID===from){
   if(physicalSystemID===from&&link.systemID===from)action="ABORT";
   else if(physicalSystemID===to&&link.systemID===from)action="NATIVE_COMMIT";
  }else if(flight.phase==="NATIVE_COMMITTED"&&row.systemID===to){
   if(physicalSystemID===to&&link.systemID===from)action="RELOCATE_PILOT";
   else if(physicalSystemID===to&&link.systemID===to)action="FINISH";
   else if(physicalSystemID===from&&link.systemID===from)action="RESTORE";
  }else if(flight.phase==="COMPLETE"&&row.systemID===to&&
   physicalSystemID===to&&link.systemID===to)action="CLEANUP_JOURNAL";
  else if(flight.phase==="ABORTED"&&row.systemID===from&&
   physicalSystemID===from&&link.systemID===from)action="CLEANUP_JOURNAL";
  if(!action)return {status:"UNSAFE",reason:"UNSUPPORTED_CROSS_STORE_CONFIGURATION"};
  return {status:"VERIFIED",action,entityID,
   transferID:flight.transferID,pilotID:flight.pilotID,
   phase:flight.phase,rowSystemID:row.systemID,
   physicalSystemID,pilotSystemID:link.systemID,
   sourceSystemID:from,destinationSystemID:to,
   modulesHash:hashes.modules,cargoHash:hashes.cargo,
   updatedAt:flight.updatedAt};
 }
 // Explicit administrative intent is recorded BEFORE the authorized
 // action, inside the same durable fleet SQL row. It is an attempted action,
 // not a false claim of completion after a crash between durable owners.
 function recordRecoveryAttempt({entityID,transferID,action,
  witnessHash,principalID,reason}={}){
  if(!enabled())return {status:"DISABLED"};
  if(!pos(entityID)||!key(transferID)||
   !["ABORT","NATIVE_COMMIT","RELOCATE_PILOT","FINISH",
    "RESTORE","CLEANUP_JOURNAL"].includes(action)||
   typeof principalID!=="string"||
   !/^[A-Za-z0-9_.:@-]{3,100}$/.test(principalID)||
   typeof reason!=="string"||reason.trim().length<12||
   reason.length>240||!/^[a-f0-9]{64}$/.test(witnessHash))
   return {status:"INVALID_ADMIN_AUDIT"};
  const auditID=crypto.createHash("sha256").update(
   [transferID,action,witnessHash].join("|")).digest("hex");
  return transact(tx=>{
   const state=fleet.validate(tx.get(fleet.TABLE,fleet.KEY)),
    row=state.ships[String(entityID)],
    flight=state.transfers?.[String(entityID)];
   if(!row||!flight||flight.transferID!==transferID)
    return {status:"BLOCKED",reason:"TRANSFER_NO_LONGER_PRESENT"};
   if(!Array.isArray(state.recoveryAudit))state.recoveryAudit=[];
   const previous=state.recoveryAudit.find(x=>x.id===auditID);
   if(previous)return {status:"ALREADY_RECORDED",auditID};
   const at=clock();
   if(!pos(at))throw Error("WAR_RECOVERY_AUDIT_CLOCK_UNSAFE");
   state.recoveryAudit.push({id:auditID,entityID,transferID,
    action,witnessHash,principalID,reason:reason.trim(),at,
    phaseWhenRequested:flight.phase});
   if(state.recoveryAudit.length>128)
    state.recoveryAudit.splice(0,state.recoveryAudit.length-128);
   fleet.validate(state);
   tx.put(fleet.TABLE,fleet.KEY,state);
   return {status:"RECORDED",auditID};
  });
 }
 function pending(){
  if(!enabled())return {status:"DISABLED",pending:[]};
  const state=transact(tx=>fleet.validate(tx.get(fleet.TABLE,fleet.KEY)));
  const entries=Object.values(state.transfers||{});
  return {status:entries.some(x=>!["COMPLETE","ABORTED"].includes(x.phase))?
   "NEEDS_OPERATOR_REPAIR":"CLEAN",
   pending:entries.filter(x=>!["COMPLETE","ABORTED"].includes(x.phase))
    .map(x=>({transferID:x.transferID,entityID:x.entityID,phase:x.phase,
     sourceSystemID:x.sourceSystemID,destinationSystemID:x.destinationSystemID}))};
 }
 return Object.freeze({
  begin:request=>operation("BEGIN",request),
  nativeCommit:request=>operation("NATIVE_COMMIT",request),
  finish:request=>operation("FINISH",request),
  abort:request=>operation("ABORT",request),
  restore:request=>operation("RESTORE",request),
  auditPersisted,
  witness,
  recordRecoveryAttempt,
  pending
 });
}
module.exports={createWarTransferLedger,fingerprint};
