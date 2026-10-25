"use strict";
// Chat 25. Source-bound reversible patches; NOT a replacement installer.
// Pin must be checked by Chat 01 before using these functions.
const ITEMS="server/src/services/inventory/itemStore.js";
const RUNTIME="server/src/services/reprocessing/reprocessingRuntime.js";
const SERVICE="server/src/services/station/reprocessingService.js";
const BEGIN="// COOP_PLAYER_ORE_ATOMIC_BEGIN",END="// COOP_PLAYER_ORE_ATOMIC_END";
const ITEM_HOOK=String.raw`// COOP_PLAYER_ORE_ATOMIC_BEGIN
function coopPlayerOreReprocessAtomic(plan) {
  ensureMigrated();
  const pos=x=>Number.isSafeInteger(Number(x))&&Number(x)>0;
  const nonneg=x=>Number.isSafeInteger(Number(x))&&Number(x)>=0;
  const itemID=Number(plan&&plan.itemID),ownerID=Number(plan&&plan.characterID);
  const stationID=Number(plan&&plan.stationID),typeID=Number(plan&&plan.typeID);
  const originalQuantity=Number(plan&&plan.originalQuantity);
  const consumed=Number(plan&&plan.consumeQuantity);
  const leftover=Number(plan&&plan.leftOvers);
  const operationID=String(plan&&plan.operationID||"");
  if(![itemID,ownerID,stationID,typeID,originalQuantity,consumed].every(pos)||
     !nonneg(leftover)||consumed+leftover!==originalQuantity||
     operationID!=="coop-player-ore-v1-"+ownerID+"-"+itemID+"-"+originalQuantity+"-"+typeID||
     !Array.isArray(plan?.outputs)||plan.outputs.length<1||plan.outputs.length>16)
    return {success:false,errorMsg:"PLAYER_ORE_INVALID_NATIVE_PLAN"};
  const outputs=plan.outputs,types=new Set();
  for(const entry of outputs){
    const t=Number(entry.typeID),q=Number(entry.quantity);
    const meta=pos(t)?getItemMetadata(t):null;
    if(!pos(t)||!pos(q)||q>CLIENT_INVENTORY_STACK_LIMIT||types.has(t)||
       !meta||!pos(meta.groupID)||!pos(meta.categoryID))
      return {success:false,errorMsg:"PLAYER_ORE_INVALID_MATERIAL"};
    types.add(t);
  }
  // Clone BEFORE mutation. Failed writes do not silently alter cached items.
  const current=readItems();
  const nativeSource=normalizeInventoryItem(current[String(itemID)]);
  if(!nativeSource||Number(nativeSource.itemID)!==itemID||
     Number(nativeSource.ownerID)!==ownerID||
     Number(nativeSource.locationID)!==stationID||
     Number(nativeSource.flagID)!==ITEM_FLAGS.HANGAR||
     Number(nativeSource.typeID)!==typeID||
     Number(nativeSource.singleton)!==0||
     Number(nativeSource.quantity)!==originalQuantity||
     Number(nativeSource.stacksize)!==originalQuantity)
    return {success:false,errorMsg:"PLAYER_ORE_SOURCE_CHANGED"};
  const prefix=operationID+":mineral:";
  if(Object.values(current).some(v=>v&&String(v.customInfo||"").startsWith(prefix)))
    return {success:false,errorMsg:"PLAYER_ORE_ALREADY_MUTATED"};
  const items=JSON.parse(JSON.stringify(current));
  const inputChanges=[],outputChanges=[],created=[];
  if(leftover){
    const after=buildInventoryItem({...nativeSource,quantity:leftover,stacksize:leftover,singleton:0});
    items[String(itemID)]=after;
    inputChanges.push({item:after,previousData:cloneValue(nativeSource),removed:false});
  }else{
    // Keep original source ID reserved until every new material ID is allocated.
    inputChanges.push({item:buildRemovedItemNotificationState(nativeSource),
      previousData:cloneValue(nativeSource),removed:true});
  }
  const characterRecord=readCharacters()[String(ownerID)]||null;
  for(const out of outputs){
    const newID=nextItemID(ownerID,items,characterRecord);
    if(!pos(newID)||items[String(newID)])
      return {success:false,errorMsg:"PLAYER_ORE_ITEM_ID_CONFLICT"};
    const t=Number(out.typeID),q=Number(out.quantity);
    const material=buildInventoryItem({itemID:newID,ownerID,typeID:t,
      locationID:stationID,flagID:ITEM_FLAGS.HANGAR,singleton:0,
      quantity:q,stacksize:q,customInfo:prefix+t});
    if(material.itemID!==newID||material.ownerID!==ownerID||
       material.typeID!==t||material.quantity!==q)
      return {success:false,errorMsg:"PLAYER_ORE_MATERIAL_CONSTRUCTION_FAILED"};
    items[String(newID)]=material;
    created.push({itemID:newID,typeID:t,quantity:q});
    outputChanges.push({item:material,
      previousData:{itemID:newID,ownerID,locationID:0,flagID:0,quantity:0,stacksize:0},
      removed:false});
  }
  if(!leftover)delete items[String(itemID)];
  if(!writeItems(items))return {success:false,errorMsg:"PLAYER_ORE_NATIVE_ITEMS_WRITE_UNCERTAIN"};
  const flush=repo.flushTableSync(ITEMS_TABLE);
  if(!flush||flush.success!==true)return {success:false,errorMsg:"PLAYER_ORE_NATIVE_FLUSH_UNCERTAIN"};
  return {success:true,data:{operationID,itemID,consumed,leftover,created,
    inputChanges,outputChanges}};
}
// COOP_PLAYER_ORE_ATOMIC_END
`;
const RPC_HOOK='  if (process.env.EVEJS_COOP_PLAYER_ORE_ATOMIC === "1") return require(path.join(__dirname, "../../space/coopPlayerOreReprocessing")).reprocess(session, options);';
const SERVICE_HOOK='  if (process.env.EVEJS_COOP_PLAYER_ORE_ATOMIC === "1") return require(path.join(__dirname, "../../space/coopPlayerOreReprocessing")).materializeWithoutSplit(session, itemIDs);';
const SERVICE_FUNCTION='function materializeOversizedSelectionsForReprocess(session, itemIDs = [], quoteOptions = {}) {';
const FUNCTION='function reprocessItems(session, options = {}) {';
function patch(source,file,remove=false){
 if(![ITEMS,RUNTIME,SERVICE].includes(file))throw Error("PLAYER_ORE_PATCH_TARGET_MISMATCH");
 if(typeof source!=="string"||!source)throw Error("PLAYER_ORE_EMPTY_SOURCE");
 const eol=source.includes("\r\n")?"\r\n":"\n";
 const count=(str,part)=>str.split(part).length-1;
 if(file===RUNTIME||file===SERVICE){
  const hook=(file===RUNTIME?RPC_HOOK:SERVICE_HOOK)+eol;
  const anchor=(file===RUNTIME?FUNCTION:SERVICE_FUNCTION)+eol;
  if(count(source,anchor)!==1)throw Error("PLAYER_ORE_REPROCESSING_SERVICE_DRIFT");
  if(remove){
   if(!source.includes(hook))return source;
   if(count(source,hook)!==1)throw Error("PLAYER_ORE_SERVICE_REMOVE_DRIFT");
   return source.replace(anchor+hook,anchor);
  }
  if(source.includes(anchor+hook))return source;
  if(source.includes(file===RUNTIME?RPC_HOOK:SERVICE_HOOK))throw Error("PLAYER_ORE_HOOK_PARTIAL");
  return source.replace(anchor,anchor+hook);
 }
 const text=ITEM_HOOK.replace(/\n/g,eol),exportEntry="  coopPlayerOreReprocessAtomic,"+eol;
 const anchor="module.exports = {"+eol;
 if(count(source,anchor)!==1)throw Error("PLAYER_ORE_ITEMSTORE_EXPORT_DRIFT");
 if(remove){
  if(!source.includes(BEGIN)&&!source.includes(exportEntry))return source;
  if(count(source,BEGIN)!==1||count(source,END)!==1||
    count(source,exportEntry)!==1||count(source,text)!==1)
    throw Error("PLAYER_ORE_ITEMSTORE_REMOVE_DRIFT");
  return source.replace(text,"").replace(exportEntry,"");
 }
 if(count(source,BEGIN)===1&&count(source,END)===1&&count(source,exportEntry)===1)
  return source;
 if(source.includes(BEGIN)||source.includes(END)||source.includes(exportEntry))
  throw Error("PLAYER_ORE_ITEMSTORE_PARTIAL");
 return source.replace(anchor,text+anchor+exportEntry);
}
module.exports={patch,ITEMS,RUNTIME,SERVICE,BEGIN,END,RPC_HOOK,SERVICE_HOOK,ITEM_HOOK};
