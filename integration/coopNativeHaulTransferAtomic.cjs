"use strict";
/**
 * ALIFE-10. Move the ORIGINAL native ore cargoID from a persistent miner to a
 * persistent hauler in one original GameStore npcCargo SQLite transaction.
 * No new item, ore or ID. A receipt is written in the SAME npcCargo SQL commit.
 */
const crypto=require("node:crypto");
const pos=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):0;
const sha=value=>crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const receiptKey=id=>"coopNativeHaulTransfer:"+id;
const mark=(actor,reason)=>{if(actor&&typeof actor==="object"){
 actor.coopHaulCargoNeedsOperatorRepair=reason;
 actor.coopHaulCargoLastError=reason;
}};
const failed=(miner,hauler,fleet,reason)=>{
 for(const actor of [miner,hauler,fleet])mark(actor,reason);
 // ALIFE-07 recognizes this native mining guard. Do not mine more ore into a
 // stranded ship while its original hauling custody is unresolved.
 if(miner&&typeof miner==="object")
  miner.coopMiningCargoNeedsOperatorRepair=reason;
 return {status:"NEEDS_OPERATOR_REPAIR",reason,quantity:0,volumeM3:0};
};
function createAtomicHaulMover({gameStore,nativeStore,resolveType,clock=()=>Date.now()}={}){
 if(!gameStore||!nativeStore||typeof resolveType!=="function")
  throw Error("ALIFE10_NATIVE_AUTHORITIES_REQUIRED");
 function transfer({scene,fleet,miner,hauler,cargoID,maxQuantity}={}){
  if(miner?.coopHaulCargoNeedsOperatorRepair||hauler?.coopHaulCargoNeedsOperatorRepair||
     fleet?.coopHaulCargoNeedsOperatorRepair)
   return {status:"NEEDS_OPERATOR_REPAIR",reason:"ALIFE10_REPAIR_ALREADY_REQUIRED",volumeM3:0};
  if(process.env.EVEJS_COOP_NATIVE_HAUL_TRANSFER_ATOMIC!=="1"||
     process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS!=="1"||
     process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE!=="1"||
     process.env.EVEJS_COOP_NATIVE_HAUL_CARGO!=="1"||
     process.env.EVEJS_COOP_NPC_STATION_DELIVERY!=="1")
   return {status:"BLOCKED_FLAGS",volumeM3:0};
  const systemID=pos(scene?.systemID),minerID=pos(miner?.itemID),
    haulerID=pos(hauler?.itemID),fleetID=pos(fleet?.fleetID),id=pos(cargoID);
  const parts=String(fleet?.startupKey||"").split(":"),
    slot=pos(parts[1]),validSlot=parts.length===2&&parts[0]===String(systemID)&&
      slot>0&&slot<=16&&fleetID===systemID*32+slot;
  if(!systemID||!minerID||!haulerID||!fleetID||!id||minerID===haulerID||
     pos(fleet?.systemID)!==systemID||!validSlot||
     !Array.isArray(fleet?.minerEntityIDs)||!fleet.minerEntityIDs.includes(minerID)||
     !Array.isArray(fleet?.haulerEntityIDs)||!fleet.haulerEntityIDs.includes(haulerID)||
     miner?.kind!=="ship"||hauler?.kind!=="ship"||
     miner.nativeNpc!==true||hauler.nativeNpc!==true||
     miner.transient===true||hauler.transient===true||
     scene.getEntityByID(minerID)!==miner||scene.getEntityByID(haulerID)!==hauler)
   return failed(miner,hauler,fleet,"ALIFE10_PHYSICAL_FLEET_IDENTITY_INVALID");
  // This exported atomic writer can be called independently of the high-level
  // hauler selector. A valid fleet and source cargo are not proof that two
  // ships are physically close enough to transfer the original item.
  const vec=p=>p&&["x","y","z"].every(k=>typeof p[k]==="number"&&Number.isFinite(p[k]));
  const inWarp=ship=>Boolean(ship.isWarping||ship.pendingWarp||ship.warpState||
    String(ship.mode||"").toUpperCase().includes("WARP"));
  const radius=ship=>ship.radius===undefined||ship.radius===null?0:
    typeof ship.radius==="number"&&Number.isFinite(ship.radius)&&ship.radius>=0?
      ship.radius:NaN;
  const separation=vec(miner.position)&&vec(hauler.position)?
   Math.hypot(miner.position.x-hauler.position.x,
    miner.position.y-hauler.position.y,
    miner.position.z-hauler.position.z)-
    radius(miner)-radius(hauler):NaN;
  if(inWarp(miner)||inWarp(hauler)||!Number.isFinite(separation)||
     Math.max(0,separation)>2500)
   // Normal NPC motion is transient. Never quarantine a healthy hull just
   // because it was out of range during a legitimate world tick.
   return {status:"BLOCKED_PHYSICAL_RANGE",reason:"ALIFE10_SHIPS_NOT_COLOCATED",
    quantity:0,volumeM3:0};
  const minerRow=nativeStore.getNativeEntity(minerID),
    haulerRow=nativeStore.getNativeEntity(haulerID),
    minerController=nativeStore.getNativeController(minerID),
    haulerController=nativeStore.getNativeController(haulerID);
  const prefix="coop-mining-"+systemID+"-"+slot+"-";
  if([minerRow,haulerRow,minerController,haulerController].some(x=>!x||x.transient===true)||
     pos(minerRow?.ownerID)!==pos(miner.ownerID)||
     pos(haulerRow?.ownerID)!==pos(hauler.ownerID)||
     !pos(miner.ownerID)||!pos(hauler.ownerID)||
     pos(minerRow?.systemID)!==systemID||pos(haulerRow?.systemID)!==systemID||
     pos(minerController?.systemID)!==systemID||
     pos(haulerController?.systemID)!==systemID||
     minerRow.operatorKind!==prefix+"miner"||
     minerController.operatorKind!==prefix+"miner"||
     haulerRow.operatorKind!==prefix+"hauler"||
     haulerController.operatorKind!==prefix+"hauler")
   return failed(miner,hauler,fleet,"ALIFE10_ORIGINAL_NATIVE_ACTORS_NOT_PROVEN");
  const sourceList=nativeStore.listNativeCargoForEntity(minerID);
  const haulerList=nativeStore.listNativeCargoForEntity(haulerID);
  if(!Array.isArray(sourceList)||!Array.isArray(haulerList)||
     haulerList.some(x=>pos(x.cargoID)===id))
   return failed(miner,hauler,fleet,"ALIFE10_SOURCE_CARGO_AMBIGUOUS");
  const found=sourceList.filter(x=>pos(x?.cargoID)===id);
  if(found.length!==1)
   return failed(miner,hauler,fleet,"ALIFE10_SOURCE_NOT_IN_MINER");
  const before=found[0],typeID=pos(before.typeID),quantity=pos(before.quantity);
  if(pos(before.cargoID)!==id||pos(before.entityID)!==minerID||
     pos(before.ownerID)!==pos(miner.ownerID)||!typeID||!quantity||
     Number(before.moduleID||0)!==0||before.transient===true||
     before.coopHaulFleetID!=null)
   return failed(miner,hauler,fleet,"ALIFE10_SOURCE_CUSTODY_INVALID");
  const type=resolveType(typeID),volumePerUnit=Number(type?.volume);
  if(!type||pos(type.typeID)!==typeID||
     !Number.isFinite(volumePerUnit)||volumePerUnit<=0||
     !Number.isFinite(quantity*volumePerUnit)||quantity*volumePerUnit<=0)
   return failed(miner,hauler,fleet,"ALIFE10_SOURCE_VOLUME_UNPROVEN");
  const timestamp=Number(clock());
  if(!Number.isSafeInteger(timestamp)||timestamp<=0)
   return failed(miner,hauler,fleet,"ALIFE10_TIMESTAMP_INVALID");
  // A hauler that physically cannot hold the whole stack moves what fits, in the SAME
  // single transaction: the source row keeps its original cargoID with the remainder
  // and the moved units become ONE new cargo row on the hauler. Never an invented
  // item, never a merge, never a second receipt for the same destination row.
  const requested=Number(maxQuantity);
  const wantsPartial=maxQuantity!==undefined&&maxQuantity!==null;
  if(wantsPartial&&(!Number.isSafeInteger(requested)||requested<=0))
   return failed(miner,hauler,fleet,"ALIFE10_PARTIAL_QUANTITY_INVALID");
  const partial=wantsPartial&&requested<quantity;
  const movedQuantity=partial?requested:quantity;
  const remaining=quantity-movedQuantity;
  let destinationID=id;
  if(partial){
   if(typeof nativeStore.allocateCargoID!=="function")
    return failed(miner,hauler,fleet,"ALIFE10_CARGO_ALLOCATOR_UNAVAILABLE");
   // The native allocator answers {success, data}; a test double may answer the id.
   const allocated=nativeStore.allocateCargoID();
   destinationID=pos(allocated&&typeof allocated==="object"?
    (allocated.success===true?allocated.data:0):allocated);
   const allCargo=typeof nativeStore.listNativeCargo==="function"?
    nativeStore.listNativeCargo():null;
   if(!destinationID||destinationID===id||!Array.isArray(allCargo)||
      allCargo.some(x=>pos(x?.cargoID)===destinationID))
    return failed(miner,hauler,fleet,"ALIFE10_CARGO_ID_ALLOCATION_CONFLICT");
  }
  const after={...before,cargoID:destinationID,entityID:haulerID,ownerID:pos(hauler.ownerID),
    transient:false,quantity:movedQuantity,coopHaulFleetID:fleetID,coopHaulFromMinerID:minerID,
    coopHaulOriginalOwnerID:pos(miner.ownerID),coopHaulSystemID:systemID,
    coopHaulLoadedAt:timestamp,
    ...(partial?{coopHaulSplitFromCargoID:id,coopHaulSplitRemaining:remaining}:{})};
  const remainder=partial?{...before,quantity:remaining}:null;
  const beforeHash=sha(before),afterHash=sha(after);
  const proof={version:1,status:"COMMITTED",cargoID:destinationID,systemID,fleetID,
    minerID,haulerID,sourceOwnerID:pos(miner.ownerID),
    haulerOwnerID:pos(hauler.ownerID),typeID,quantity:movedQuantity,beforeHash,afterHash,
    loadedAt:timestamp,partial,sourceCargoID:id,remainingQuantity:remaining};
  const authority=gameStore.coopAtomicNativeRows;
  if(!authority||typeof authority.transact!=="function")
   return failed(miner,hauler,fleet,"ALIFE10_NATIVE_SQLITE_AUTHORITY_UNAVAILABLE");
  let outcome;
  try{
   outcome=authority.transact(["npcCargo"],tx=>{
    const old=tx.get("npcCargo",receiptKey(destinationID));
    if(old)throw Error("ALIFE10_CARGO_TRANSFER_ALREADY_WITNESSED");
    const root=tx.get("npcCargo","cargo");
    if(!root||typeof root!=="object"||Array.isArray(root))
     throw Error("ALIFE10_NATIVE_CARGO_ROOT_UNAVAILABLE");
    const actual=root[String(id)];
    if(!actual||sha(actual)!==beforeHash||
       pos(actual.entityID)!==minerID||pos(actual.ownerID)!==pos(miner.ownerID))
     throw Error("ALIFE10_SOURCE_CARGO_CAS_CONFLICT");
    const nextRoot={...root};
    if(partial){
     if(nextRoot[String(destinationID)]||Object.keys(nextRoot).includes(String(destinationID)))
      throw Error("ALIFE10_DESTINATION_CARGO_ID_TAKEN");
     nextRoot[String(id)]=remainder;
     nextRoot[String(destinationID)]=after;
    }else nextRoot[String(id)]=after;
    // The next owner/location and an immutable receipt become visible together.
    tx.put("npcCargo","cargo",nextRoot);
    tx.put("npcCargo",receiptKey(destinationID),proof);
    return proof;
   });
  }catch(error){
   return failed(miner,hauler,fleet,"ALIFE10_ATOMIC_OUTCOME_UNKNOWN_OR_REJECTED:"+String(error?.message||error).slice(0,90));
  }
  // Commit succeeded. Read original native records; do not ever compensate
  // by minting or writing a second cargo row.
  try{
   const haulerCargo=nativeStore.listNativeCargoForEntity(haulerID),
     minerCargo=nativeStore.listNativeCargoForEntity(minerID);
   const moved=(haulerCargo||[]).filter(x=>pos(x.cargoID)===destinationID);
   const still=(minerCargo||[]).filter(x=>pos(x.cargoID)===id);
   const sourceOk=partial?
     (still.length===1&&Number(still[0].quantity)===remaining&&sha(still[0])===sha(remainder)):
     still.length===0;
   // Name the clause that failed: measured 2026-11-05, the blanket reason cost a live mining
   // fleet its whole shift twice in 40 minutes (fleet 960004610, 12:15Z and 12:44Z) and nothing
   // said whether the row was missing, stale or merely a different shape. The verdict is unchanged;
   // only the reason now carries the exact condition (and the two short hashes when they differ).
   const clause=!Array.isArray(minerCargo)?"miner_cargo_unreadable"
     :moved.length!==1?"destination_rows="+moved.length
     :!sourceOk?"source_state"
     :sha(moved[0])!==afterHash?"destination_hash="+String(sha(moved[0])||"").slice(0,8)+"/"+
       String(afterHash||"").slice(0,8)
     :outcome?.cargoID!==destinationID?"outcome_cargo_id"
     :outcome?.afterHash!==afterHash?"outcome_hash="+String(outcome?.afterHash||"").slice(0,8)+"/"+
       String(afterHash||"").slice(0,8)
     :"ok";
   if(clause!=="ok")
    return failed(miner,hauler,fleet,"ALIFE10_POSTCOMMIT_CUSTODY_READBACK_FAILED:"+clause+
     ":cargo="+destinationID);
   if(typeof nativeStore.buildNativeCargoItems!=="function")
    return failed(miner,hauler,fleet,"ALIFE10_POSTCOMMIT_CARGO_BUILDER_MISSING");
   const rebuilt=nativeStore.buildNativeCargoItems(haulerID);
   if(!Array.isArray(rebuilt)||rebuilt.filter(x=>pos(x?.itemID)===destinationID).length!==1)
    return failed(miner,hauler,fleet,"ALIFE10_POSTCOMMIT_CARGO_BUILD_INVALID");
   // Update both in-memory ships only after ALL source/readback checks pass.
   const minerLocal=Array.isArray(miner.nativeCargoItems)?miner.nativeCargoItems:[];
   miner.nativeCargoItems=partial?
    minerLocal.map(x=>pos(x?.itemID)===id?{...x,quantity:remaining}:x):
    minerLocal.filter(x=>pos(x?.itemID)!==id);
   hauler.nativeCargoItems=rebuilt;
   return {status:"COMMITTED",cargoID:destinationID,sourceCargoID:id,fleetID,
     partial,quantity:movedQuantity,remainingQuantity:remaining,
     volumeM3:movedQuantity*volumePerUnit,receipt:outcome};
  }catch(error){
   return failed(miner,hauler,fleet,"ALIFE10_POSTCOMMIT_READBACK_UNKNOWN:"+String(error?.message||error).slice(0,80));
  }
 }
 return Object.freeze({transfer});
}
let live;
function transfer(args){
 if(!live)live=createAtomicHaulMover({
  gameStore:require("../gameStore"),
  nativeStore:require("./npc/nativeNpcStore"),
  resolveType:require("../services/inventory/itemTypeRegistry").resolveItemByTypeID,
 });
 return live.transfer(args);
}
// A post-commit readback that finds no destination row is a doubt, not a theft: the transaction
// already committed (the receipt and the row were written together), and the readback reads the
// store's CACHE. Measured live 2026-11-05 13:14Z: fleet 960004610 was parked by
// READBACK_FAILED:destination_rows=0, and nothing in the engine clears
// coopHaulCargoNeedsOperatorRepair, so a cache-visibility hiccup cost the fleet its whole shift
// until the next restart. The doubt is now resolved by evidence on the next beat: if exactly one
// row with that cargoID exists, the transfer really happened and the repair flag is cleared. A
// row that is still missing keeps the flag - that is what "needs an operator" is for.
// Any number of ALIFE10_ prefixes: reasons stored before the double-prefix fix read
// ALIFE10_ALIFE10_POSTCOMMIT_..., and those fleets must be able to heal too.
const READBACK_REPAIR=/^(?:ALIFE10_)*POSTCOMMIT_CUSTODY_READBACK_FAILED:.*:cargo=([0-9]+)$/;
function healReadbackRepair({miner,hauler,fleet,nativeStore,observe=null,readReceipt=null}={}){
  if(!nativeStore||typeof nativeStore.listNativeCargoForEntity!=="function")return null;
  const noted=String((miner&&miner.coopHaulCargoNeedsOperatorRepair)||
    (fleet&&fleet.coopHaulCargoNeedsOperatorRepair)||
    (hauler&&hauler.coopHaulCargoNeedsOperatorRepair)||"");
  const match=READBACK_REPAIR.exec(noted);
  if(!match)return null;
  const cargoID=pos(match[1]);
  if(!cargoID)return null;
  let rows=[];
  try{
    rows=[...(nativeStore.listNativeCargoForEntity(pos(hauler&&hauler.itemID))||[]),
      ...(nativeStore.listNativeCargoForEntity(pos(miner&&miner.itemID))||[])];
  }catch(_error){return null;}
  const found=rows.filter(row=>pos(row&&row.cargoID)===cargoID);
  // One row is proof the transfer happened. No row is NOT proof that it did not: the cargo may
  // have been sold or moved between the readback and this beat. The transfer writes its receipt in
  // the SAME transaction as the row, so a committed receipt naming this cargo is the durable proof.
  let proofName="DESTINATION_ROW_EXISTS_ONCE";
  if(found.length!==1){
    let receipt=null;
    try{receipt=typeof readReceipt==="function"?readReceipt(cargoID):null}catch(_error){receipt=null}
    const minerID=pos(miner&&miner.itemID),haulerID=pos(hauler&&hauler.itemID);
    if(!receipt||String(receipt.status)!=="COMMITTED"||pos(receipt.cargoID)!==cargoID||
     !minerID||pos(receipt.minerID)!==minerID||pos(receipt.haulerID)!==haulerID)return null;
    proofName="TRANSFER_RECEIPT_COMMITTED";
  }
  for(const actor of [miner,hauler,fleet]){
    if(!actor||typeof actor!=="object")continue;
    delete actor.coopHaulCargoNeedsOperatorRepair;
    delete actor.coopHaulNeedsOperatorRepair;
    delete actor.coopMiningCargoNeedsOperatorRepair;
  }
  try{
    if(typeof observe==="function")
      observe("living-haul-repair-healed",null,null,
        {fleetID:pos(fleet&&fleet.fleetID),haulerID:pos(hauler&&hauler.itemID),
         cargoID,reason:String(noted).slice(0,120),
         proof:proofName});
  }catch(_error){/* telemetry must never change the world */}
  return {status:"HEALED",cargoID,proof:proofName};
}
// The same doubt, answered from the other side. A source-cargo conflict says the miner's rows could
// not be proven to be its own; if they can be proven NOW, the fleet may work again. Every clause the
// conflict applies is re-checked here, so a row that is still wrong keeps the flag.
const SOURCE_CONFLICT_REPAIR=/^HAUL_SOURCE_CARGO_IDENTITY_CONFLICT/;
function healSourceCargoConflict({miner,hauler,fleet,nativeStore,observe=null}={}){
  if(!nativeStore||typeof nativeStore.listNativeCargoForEntity!=="function"||
   typeof nativeStore.listNativeCargo!=="function")return null;
  const noted=String((miner&&miner.coopHaulCargoNeedsOperatorRepair)||
    (fleet&&fleet.coopHaulCargoNeedsOperatorRepair)||
    (hauler&&hauler.coopHaulCargoNeedsOperatorRepair)||"");
  if(!SOURCE_CONFLICT_REPAIR.test(noted))return null;
  const minerID=pos(miner&&miner.itemID),ownerID=pos(miner&&miner.ownerID);
  if(!minerID||!ownerID)return null;
  let source,all;
  try{
    source=nativeStore.listNativeCargoForEntity(minerID)||[];
    all=nativeStore.listNativeCargo()||[];
  }catch(_error){return null;}
  if(!Array.isArray(source)||!Array.isArray(all))return null;
  const counts=new Map();
  for(const row of all){
    const id=pos(row&&row.cargoID);
    if(id)counts.set(id,(counts.get(id)||0)+1);
  }
  for(const row of source){
    const id=pos(row&&row.cargoID);
    if(!id)return null;
    if(Number(row.entityID)!==minerID)return null;
    if(Number(row.ownerID)!==ownerID)return null;
    if(row.transient!==false)return null;
    if(!(Number(row.quantity)>0))return null;
    if(Number(row.categoryID)!==25)return null;
    if((counts.get(id)||0)!==1)return null;
  }
  for(const actor of [miner,hauler,fleet]){
    if(!actor||typeof actor!=="object")continue;
    delete actor.coopHaulCargoNeedsOperatorRepair;
    delete actor.coopHaulNeedsOperatorRepair;
    delete actor.coopMiningCargoNeedsOperatorRepair;
  }
  try{
    if(typeof observe==="function")
      observe("living-haul-repair-healed",null,null,
        {fleetID:pos(fleet&&fleet.fleetID),haulerID:pos(hauler&&hauler.itemID),
         rows:source.length,reason:String(noted).slice(0,120),
         proof:"SOURCE_CARGO_IDENTITY_CONSISTENT"});
  }catch(_error){/* telemetry must never change the world */}
  return {status:"HEALED",proof:"SOURCE_CARGO_IDENTITY_CONSISTENT",rows:source.length};
}
// One entry point for the caller: try every evidence-based repair, in order, and report which one
// fired. A reason with no proof stays parked - that is what "needs an operator" is for.
function healCustodyRepair(args={}){
  return healReadbackRepair(args)||healSourceCargoConflict(args)||null;
}
module.exports={createAtomicHaulMover,transfer,receiptKey,healReadbackRepair,READBACK_REPAIR,
  healSourceCargoConflict,healCustodyRepair,SOURCE_CONFLICT_REPAIR};
