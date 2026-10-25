"use strict";
// Stage J actual native GameStore transaction for one intact original wreck
// stack -> separate, uniquely tagged NPC corporation station item.
// The callback is a server-side trust boundary, never exposed to client RPC.
const pos=x=>Number.isSafeInteger(x)&&x>0;
const deny=status=>({status});
const marker=(manifestKey,cargoID,wreckItemID)=>
 "coop-salvage:v1:"+manifestKey+":"+cargoID+":"+wreckItemID;
function createNativeSalvageTransfer({atomic,readWitness,readManifest,
 readOriginalWreckItem,listNativeItems,buildInventoryItem,
 readWarehouseItem}={}){
 if(typeof atomic?.transact!=="function"||
  [readWitness,readManifest,readOriginalWreckItem,listNativeItems,
   buildInventoryItem,readWarehouseItem].some(f=>typeof f!=="function"))
  throw Error("SALVAGE_NATIVE_SQLITE_AUTHORITIES_REQUIRED");
 const identify=args=>{
  if(!/^\d+-\d+-\d+$/.test(String(args?.manifestKey))||
   ![args.cargoID,args.wreckItemID,args.stationID,args.corporationID,
    args.quantity,args.expectedWreckID].every(pos))
   return deny("SALVAGE_TRANSFER_INVALID_IDENTITY");
  let witness,manifest;
  try{witness=readWitness(args.manifestKey);manifest=readManifest(args.manifestKey)}
  catch{return deny("SALVAGE_TRANSFER_SOURCE_UNAVAILABLE")}
  const r=witness?.record,m=manifest?.record;
  if(witness?.status!=="READY"||r?.manifestKey!==args.manifestKey||
   manifest?.status!=="READY"||m?.key!==args.manifestKey||
   r.wreckID!==args.expectedWreckID||
   r.stationID!==args.stationID||m.stationID!==args.stationID||
   r.corporationID!==args.corporationID||
   m.corporationID!==args.corporationID||
   !r.rows?.some(x=>x.cargoID===args.cargoID&&
    x.wreckItemID===args.wreckItemID&&x.quantity===args.quantity&&
    m.cargo?.some(c=>c.cargoID===x.cargoID&&
     c.typeID===x.typeID&&c.quantity>=x.quantity)))
   return deny("SALVAGE_TRANSFER_ORIGINAL_SOURCE_UNVERIFIED");
  return {status:"READY",row:r.rows.find(x=>
   x.cargoID===args.cargoID&&x.wreckItemID===args.wreckItemID)};
 };
 function inspect(args){
  const source=identify(args);if(source.status!=="READY")return source;
  const m=marker(args.manifestKey,args.cargoID,args.wreckItemID);
  let items,wreckRow;
  try{items=listNativeItems();wreckRow=readOriginalWreckItem(args.wreckItemID)}
  catch{return deny("SALVAGE_TRANSFER_RECEIPT_UNAVAILABLE")}
  if(!Array.isArray(items))return deny("SALVAGE_TRANSFER_RECEIPT_UNAVAILABLE");
  const matching=items.filter(x=>x?.customInfo===m);
  if(matching.length===0)return deny("NOT_FOUND");
  if(matching.length!==1)return deny("SALVAGE_TRANSFER_DUPLICATED_NATIVE_ITEM");
  const stock=matching[0];
  if(wreckRow||!pos(stock.itemID)||stock.ownerID!==args.corporationID||
   stock.locationID!==args.stationID||stock.flagID!==4||
   stock.typeID!==source.row.typeID||
   stock.quantity!==args.quantity||stock.stacksize!==args.quantity||
   stock.singleton!==0)
   return deny("SALVAGE_TRANSFER_DURABLE_RECEIPT_CONFLICT");
  return {status:"ATOMIC_NATIVE_ITEM_MOVED",nativeDurable:true,
   sourceDebited:true,destinationCredited:true,
   manifestKey:args.manifestKey,cargoID:args.cargoID,
   wreckID:args.expectedWreckID,wreckItemID:args.wreckItemID,
   stationID:args.stationID,corporationID:args.corporationID,
   quantity:args.quantity,nativeWarehouseItemID:stock.itemID};
 }
 function move(args){
  if(process.env.EVEJS_COOP_SALVAGE_ATOMIC_TRANSFER!=="1"||
   process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS!=="1")
   return deny("DISABLED");
  const source=identify(args);if(source.status!=="READY")return source;
  const before=inspect(args);
  if(before.status==="ATOMIC_NATIVE_ITEM_MOVED")return before;
  if(before.status!=="NOT_FOUND")return before;
  const label=marker(args.manifestKey,args.cargoID,args.wreckItemID);
  try{
   const result=atomic.transact(["npcWreckItems","items","identityState"],tx=>{
    const wrecks=tx.get("npcWreckItems","items");
    if(!wrecks||typeof wrecks!=="object"||Array.isArray(wrecks))
     throw Error("SALVAGE_NATIVE_WRECK_TABLE_UNAVAILABLE");
    const original=wrecks[String(args.wreckItemID)];
    if(!original||original.sourceKind!=="cargo"||
     original.wreckID!==args.expectedWreckID||
     original.sourceCargoID!==args.cargoID||
     original.typeID!==source.row.typeID||
     original.quantity!==args.quantity||original.singleton===true)
     throw Error("SALVAGE_NATIVE_WRECK_ITEM_CHANGED");
    if(Object.values(wrecks).some(x=>x!==original&&
      x?.sourceCargoID===args.cargoID))
     throw Error("SALVAGE_SOURCE_SPLIT_OR_DUPLICATE");
    const existing=tx.scan("items");
    if(existing.some(x=>x.value?.customInfo===label))
     throw Error("SALVAGE_NATIVE_DESTINATION_EXISTS");
    const current=tx.get("identityState","nextItemID");
    if(!pos(current))throw Error("SALVAGE_NATIVE_ID_ALLOCATOR_UNAVAILABLE");
    const maximum=existing.reduce((n,x)=>
     Math.max(n,Number(x.value?.itemID)||0),0);
    const id=Math.max(current,maximum+1);
    if(!pos(id)||!Number.isSafeInteger(id+1)||existing.some(x=>x.key===String(id)))
     throw Error("SALVAGE_NATIVE_ITEM_ID_COLLISION");
    const built=buildInventoryItem({itemID:id,typeID:original.typeID,
     itemName:original.itemName,ownerID:args.corporationID,
     locationID:args.stationID,flagID:4,
     quantity:args.quantity,stacksize:args.quantity,singleton:0,
     customInfo:label});
    if(!built||built.itemID!==id||built.typeID!==original.typeID||
     built.ownerID!==args.corporationID||
     built.locationID!==args.stationID||built.flagID!==4||
     built.quantity!==args.quantity||built.stacksize!==args.quantity||
     built.singleton!==0||built.customInfo!==label)
     throw Error("SALVAGE_NATIVE_ITEM_BUILD_INVALID");
    const next={...wrecks};delete next[String(args.wreckItemID)];
    tx.put("npcWreckItems","items",next);
    tx.put("identityState","nextItemID",id+1);
    tx.put("items",String(id),built);
    return {status:"ATOMIC_NATIVE_ITEM_MOVED",nativeWarehouseItemID:id};
   });
   if(result?.status!=="ATOMIC_NATIVE_ITEM_MOVED")
    return deny("SALVAGE_NATIVE_TRANSACTION_NOT_COMMITTED");
  }catch{return deny("SALVAGE_NATIVE_ATOMIC_COMMIT_UNCERTAIN")}
  const confirmed=inspect(args);
  return confirmed.status==="ATOMIC_NATIVE_ITEM_MOVED"?confirmed:
   deny("SALVAGE_NATIVE_COMMIT_NEEDS_RECONCILIATION");
 }
 function warehouse(args){
  const proof=inspect(args);
  if(proof.status!=="ATOMIC_NATIVE_ITEM_MOVED")return null;
  return {nativeWarehouseItemID:proof.nativeWarehouseItemID,
   sourceCargoID:args.cargoID,sourceWreckItemID:args.wreckItemID,
   quantity:args.quantity,ownerID:args.corporationID,
   stationID:args.stationID};
 }
 return {move,inspect,warehouse};
}
module.exports={createNativeSalvageTransfer,marker};
