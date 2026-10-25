"use strict";
/**
 * ALIFE-07. One authoritative SQLite commit for the source asteroid and
 * original nativeNpcStore cargo. No second item/currency authority.
 * Strict opt-in; only persistent NPCs in a single GameStore owner process.
 */
const crypto = require("node:crypto");
const SEP = "\u001f";
const MAX_QTY = 1000000000;
const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const integer = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0;
const clone = value => JSON.parse(JSON.stringify(value));

function blocked(entity, reason) {
  if (entity && typeof entity === "object") {
    entity.coopMiningCargoNeedsOperatorRepair = reason;
    entity.coopMiningCargoLastError = reason;
  }
  return {success:false,stopReason:"cargo",reason};
}
function createAtomicMiningSettler({gameStore,nativeStore,resolveType}={}) {
  if (!gameStore || !nativeStore || typeof resolveType !== "function")
    throw Error("ALIFE07_NATIVE_AUTHORITIES_REQUIRED");

  function settle(input) {
    const {scene,entity,targetEntity,mineableState,miningResult,transferredQuantity,
      cycleBoundaryMs,moduleItem,commitScene,readState} = input || {};
    if (!entity || entity.coopMiningCargoNeedsOperatorRepair)
      return blocked(entity,"ALIFE07_REPAIR_REQUIRED");
    if (process.env.EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC !== "1" ||
        process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS !== "1" ||
        process.env.EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY !== "1" ||
        process.env.EVEJS_COOP_NATIVE_MINING_CYCLE_CONSERVATION !== "1")
      return blocked(entity,"ALIFE07_ATOMIC_FLAGS_REQUIRED");
    // The native fleet spawner currently creates transient ships by default.
    // A transient ship/cargo has no stable source after restart: reject it.
    if (entity.transient === true)
      return blocked(entity,"ALIFE07_PERSISTENT_NPC_REQUIRED");
    if (targetEntity && (targetEntity.dungeonMaterializedSiteContent === true ||
        targetEntity.dungeonSiteContentMissionObjectiveTarget === true ||
        Number(targetEntity.dungeonSiteInstanceID || 0) > 0))
      return blocked(entity,"ALIFE07_PERSISTENT_ROCK_REQUIRED");

    const systemID=Number(scene?.systemID), rockID=Number(targetEntity?.itemID);
    const shipID=Number(entity.itemID), ownerID=Number(entity.ownerID ??
      entity.pilotCharacterID ?? entity.characterID), oreTypeID=Number(mineableState?.yieldTypeID);
    const moduleID=Number(moduleItem?.itemID), before=Number(mineableState?.remainingQuantity);
    const normal=Number(miningResult?.normalQuantity), wasted=Number(miningResult?.wastedQuantity);
    const quantity=Number(transferredQuantity), consumed=normal+wasted;
    const cycle=Number(cycleBoundaryMs);
    if (![systemID,rockID,shipID,ownerID,oreTypeID,moduleID,cycle].every(positive) ||
        ![before,normal,wasted,quantity,consumed].every(integer) ||
        consumed<=0 || consumed>before || quantity>MAX_QTY || quantity<normal ||
        normal>MAX_QTY || wasted>MAX_QTY ||
        !scene || typeof scene.getEntityByID !== "function" ||
        scene.getEntityByID(rockID)!==targetEntity ||
        typeof commitScene!=="function" || typeof readState!=="function")
      return blocked(entity,"ALIFE07_YIELD_INVALID");
    const snapshot=readState();
    if (!snapshot || Number(snapshot.remainingQuantity)!==before ||
        Number(snapshot.yieldTypeID)!==oreTypeID)
      return blocked(entity,"ALIFE07_SCENE_PREIMAGE_CONFLICT");
    const type=resolveType(oreTypeID);
    if (!type || Number(type.typeID)!==oreTypeID)
      return blocked(entity,"ALIFE07_TYPE_UNRESOLVED");
    const cargoList=entity.nativeCargoItems;
    if (cargoList!=null && !Array.isArray(cargoList))
      return blocked(entity,"ALIFE07_LOCAL_CARGO_INVALID");
    const oreEntries=(cargoList||[]).filter(c=>Number(c?.typeID)===oreTypeID &&
      Number(c?.moduleID||0)===0);
    if (oreEntries.length>1) return blocked(entity,"ALIFE07_DUPLICATE_LOCAL");
    const local=oreEntries[0]||null;
    const cargoID=local?Number(local.itemID):0;
    if (local && (!positive(cargoID) ||
        Number(local.ownerID)!==ownerID || Number(local.locationID)!==shipID ||
        !integer(local.quantity) || Number(local.quantity)>MAX_QTY))
      return blocked(entity,"ALIFE07_LOCAL_IDENTITY_CONFLICT");

    const op=[systemID,rockID,shipID,moduleID,cycle].join(":");
    const fingerprint=crypto.createHash("sha256")
      .update(JSON.stringify([op,oreTypeID,before,normal,wasted,quantity])).digest("hex");
    const opKey="coopMiningCycle:"+crypto.createHash("sha256").update(op).digest("hex");
    const authority=gameStore.coopAtomicNativeRows;
    if (!authority || typeof authority.transact!=="function")
      return blocked(entity,"ALIFE07_GAMESTORE_BRIDGE_UNAVAILABLE");

    // Reserve the original native cargo ID via the ORIGINAL allocator, never a
    // second ID source. The reserved counter is flushed by the GameStore atomic
    // adapter before the two-table transaction. Unused gaps are harmless.
    let reservedID=0;
    if (!local) {
      try {
        const issued=nativeStore.allocateCargoID({transient:false});
        if (!issued?.success || !positive(issued.data))
          return blocked(entity,"ALIFE07_NATIVE_ALLOCATOR_REJECTED");
        reservedID=Number(issued.data);
      }catch(_){return blocked(entity,"ALIFE07_NATIVE_ALLOCATOR_UNKNOWN");}
    }

    let receipt;
    try {
      receipt=authority.transact(["miningRuntimeState","npcCargo"],tx=>{
        const prior=tx.get("miningRuntimeState",opKey);
        if (prior) {
          if (prior.fingerprint!==fingerprint || prior.status!=="COMMITTED")
            throw Error("ALIFE07_OPERATION_REPLAY_CONFLICT");
          const priorCargo=tx.get("npcCargo","cargo");
          if (!priorCargo || !priorCargo[String(prior.cargoID)] ||
              Number(priorCargo[String(prior.cargoID)].quantity)!==Number(prior.nextCargo))
            throw Error("ALIFE07_REPLAY_CARGO_MOVED_OR_DIVERGED");
          return {...prior,replayed:true};
        }
        const rockKey="systems"+SEP+systemID;
        const systemRow=tx.get("miningRuntimeState",rockKey);
        if (systemRow!==null &&
            (!systemRow || typeof systemRow!=="object" ||
             Array.isArray(systemRow) || (systemRow.entities!=null &&
             (typeof systemRow.entities!=="object" || Array.isArray(systemRow.entities)))))
          throw Error("ALIFE07_SOURCE_LAYOUT_INVALID");
        const current=systemRow?.entities?.[String(rockID)]||null;
        if (current && (!integer(current.remainingQuantity) ||
            Number(current.remainingQuantity)!==before ||
            Number(current.yieldTypeID)!==oreTypeID ||
            Number(current.entityID)!==rockID))
          throw Error("ALIFE07_SOURCE_CAS_CONFLICT");
        // A missing source record means a never-mined native asteroid baseline,
        // not permission to reset a previously depleted source.
        if (!current && (!positive(mineableState.originalQuantity) ||
            Number(mineableState.originalQuantity)!==before))
          throw Error("ALIFE07_UNPERSISTED_SOURCE_NOT_BASELINE");
        const cargoRoot=tx.get("npcCargo","cargo");
        if (!cargoRoot || typeof cargoRoot!=="object" || Array.isArray(cargoRoot))
          throw Error("ALIFE07_NATIVE_CARGO_LAYOUT_INVALID");
        const byType=Object.values(cargoRoot).filter(c=>c &&
          Number(c.entityID)===shipID && Number(c.moduleID||0)===0 &&
          Number(c.typeID)===oreTypeID);
        if (byType.length !== (local?1:0))
          throw Error("ALIFE07_CARGO_SOURCE_CAS_CONFLICT");
        const original=local?byType[0]:null;
        if (original && (Number(original.cargoID)!==cargoID ||
            Number(original.ownerID)!==ownerID ||
            Number(original.quantity)!==Number(local.quantity) ||
            original.transient===true))
          throw Error("ALIFE07_CARGO_OWNER_OR_QUANTITY_CONFLICT");
        const targetCargoID=original?cargoID:reservedID;
        if (!positive(targetCargoID) || (!original && cargoRoot[String(targetCargoID)]))
          throw Error("ALIFE07_CARGO_ID_COLLISION");
        const nextCargo=(original?Number(original.quantity):0)+quantity;
        if (!integer(nextCargo) || nextCargo>MAX_QTY)
          throw Error("ALIFE07_CARGO_OVERFLOW");
        const now=Number(cycleBoundaryMs);
        const nextRock={...(current||mineableState),entityID:rockID,
          yieldTypeID:oreTypeID,remainingQuantity:before-consumed,updatedAtMs:now};
        const nextCargoRow=original?
          {...original,quantity:nextCargo}:
          {cargoID:targetCargoID,entityID:shipID,ownerID,moduleID:0,
            typeID:oreTypeID,groupID:Number(type.groupID)||0,
            categoryID:Number(type.categoryID)||0,itemName:String(type.name||""),
            quantity:nextCargo,singleton:false,transient:false};
        const prepared={version:1,status:"COMMITTED",fingerprint,op,
          systemID,shipID,rockID,ownerID,oreTypeID,moduleID,
          beforeRock:before,afterRock:before-consumed,cargoID:targetCargoID,
          beforeCargo:original?Number(original.quantity):0,nextCargo,
          quantity,normal,wasted,cycleBoundaryMs:now};
        tx.put("miningRuntimeState",rockKey,{
          ...(systemRow||{}),entities:{...(systemRow?.entities||{}),[String(rockID)]:nextRock}});
        tx.put("npcCargo","cargo",{...cargoRoot,[String(targetCargoID)]:nextCargoRow});
        tx.put("miningRuntimeState",opKey,prepared);
        return prepared;
      });
    }catch(error){
      return blocked(entity,"ALIFE07_ATOMIC_COMMIT_UNKNOWN_OR_REJECTED:"+String(error?.message||error).slice(0,105));
    }

    // The SQLite transaction has committed. From now on *never* compensate
    // by minting/debiting again. Reconcile scene and local views only.
    try {
      const source=gameStore.read("miningRuntimeState",
        "/systems/"+systemID+"/entities/"+rockID);
      const cargo=nativeStore.listNativeCargoForEntity(shipID)
        .filter(c=>Number(c?.cargoID)===Number(receipt.cargoID));
      if (!source?.success || Number(source.data?.remainingQuantity)!==receipt.afterRock ||
          Number(source.data?.yieldTypeID)!==oreTypeID || cargo.length!==1 ||
          Number(cargo[0].ownerID)!==ownerID || Number(cargo[0].typeID)!==oreTypeID ||
          Number(cargo[0].quantity)!==receipt.nextCargo)
        return blocked(entity,"ALIFE07_POSTCOMMIT_SOURCE_READBACK_UNKNOWN");

      const currentScene=readState();
      let deltaResult;
      if (Number(currentScene?.remainingQuantity)===receipt.beforeRock) {
        deltaResult=commitScene(); // Native asteroid visuals, NOT another source write.
      }else if(Number(currentScene?.remainingQuantity)===receipt.afterRock) {
        deltaResult={success:true,data:{depleted:receipt.afterRock===0,replayed:true}};
      }else{
        return blocked(entity,"ALIFE07_POSTCOMMIT_SCENE_DIVERGED");
      }
      if (!deltaResult?.success)
        return blocked(entity,"ALIFE07_POSTCOMMIT_SCENE_FAILED");
      const updated=(Array.isArray(entity.nativeCargoItems)?entity.nativeCargoItems:[])
        .filter(c=>Number(c?.typeID)===oreTypeID && Number(c?.moduleID||0)===0);
      if (updated.length>1) return blocked(entity,"ALIFE07_POSTCOMMIT_DUPLICATE_LOCAL");
      const old=updated[0];
      if (old && Number(old.itemID)!==receipt.cargoID)
        return blocked(entity,"ALIFE07_POSTCOMMIT_LOCAL_ID_CONFLICT");
      const localRow={itemID:receipt.cargoID,ownerID,locationID:shipID,moduleID:0,
        typeID:oreTypeID,groupID:Number(type.groupID)||0,
        categoryID:Number(type.categoryID)||0,quantity:receipt.nextCargo,
        stacksize:receipt.nextCargo,singleton:0,flagID:5,
        itemName:String(type.name||"type "+oreTypeID),
        volume:Math.max(0,Number(type.volume)||0)};
      if (old) Object.assign(old,localRow);
      else if (Array.isArray(entity.nativeCargoItems)) entity.nativeCargoItems.push(localRow);
      else entity.nativeCargoItems=[localRow];
      return {success:true,deltaResult,receipt};
    }catch(_){return blocked(entity,"ALIFE07_POSTCOMMIT_RECONCILIATION_UNKNOWN");}
  }
  return Object.freeze({settle});
}

let live;
function settle(input) {
  if (!live) live=createAtomicMiningSettler({
    gameStore:require("../gameStore"),
    nativeStore:require("./npc/nativeNpcStore"),
    resolveType:require("../services/inventory/itemTypeRegistry").resolveItemByTypeID,
  });
  return live.settle(input);
}
module.exports={createAtomicMiningSettler,settle};
