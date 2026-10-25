"use strict";
// Internal-only stock EveJS itemStore extension: one cache write and one
// synchronous native SQLite flush for refinery ore debit + mineral credits.
// No user-facing RPC and no independent economic inventory.
const TARGET="server/src/services/inventory/itemStore.js";
const BEGIN="// COOP_NATIVE_REFINERY_ATOMIC_BEGIN";
const END="// COOP_NATIVE_REFINERY_ATOMIC_END";
const HOOK=String.raw`// COOP_NATIVE_REFINERY_ATOMIC_BEGIN
function refineNpcWarehouseOreAtomic(plan) {
  ensureMigrated();
  const positive=value=>Number.isSafeInteger(value)&&value>0;
  const ownerID=Number(plan&&plan.ownerID),stationID=Number(plan&&plan.stationID);
  const oreItemID=Number(plan&&plan.oreItemID),oreTypeID=Number(plan&&plan.oreTypeID);
  const originalQuantity=Number(plan&&plan.originalQuantity);
  const consumeQuantity=Number(plan&&plan.consumeQuantity),leftOvers=Number(plan&&plan.leftOvers);
  const operationID=String(plan&&plan.operationID||"");
  if(![ownerID,stationID,oreItemID,oreTypeID,originalQuantity,consumeQuantity].every(positive)||
    !Number.isSafeInteger(leftOvers)||leftOvers<0||
    consumeQuantity+leftOvers!==originalQuantity||
    !/^coop-refine:v1:[0-9]+:[0-9]+$/.test(operationID)||
    operationID!=="coop-refine:v1:"+oreItemID+":"+originalQuantity||
    !Array.isArray(plan&&plan.outputs)||plan.outputs.length<1||plan.outputs.length>16)
    return {success:false,errorMsg:"REFINERY_INVALID_PLAN"};
  const outputs=plan.outputs;
  const seen=new Set();
  for(const out of outputs){
    if(!positive(Number(out.typeID))||!positive(Number(out.quantity))||
       Number(out.quantity)>CLIENT_INVENTORY_STACK_LIMIT||seen.has(Number(out.typeID))||
       toNumber(getItemMetadata(out.typeID).groupID,0)<=0)
      return {success:false,errorMsg:"REFINERY_INVALID_OUTPUT"};
    seen.add(Number(out.typeID));
  }
  const items=JSON.parse(JSON.stringify(readItems())),source=normalizeInventoryItem(items[String(oreItemID)]);
  const prefix=operationID+":mineral:";
  if(Object.values(items).some(x=>x&&String(x.customInfo||"").startsWith(prefix)))
    return {success:false,errorMsg:"REFINERY_ALREADY_MUTATED_RECONCILE"};
  if(!source||source.ownerID!==ownerID||source.locationID!==stationID||
     source.flagID!==ITEM_FLAGS.HANGAR||source.singleton!==0||
     source.typeID!==oreTypeID||source.quantity!==originalQuantity||
     !/^coop-warehouse:v1:cargo:[0-9]+$/.test(String(source.customInfo||"")))
    return {success:false,errorMsg:"REFINERY_SOURCE_CHANGED"};
  const created=[];
  if(leftOvers){
    items[String(oreItemID)]=buildInventoryItem({...source,quantity:leftOvers,stacksize:leftOvers,singleton:0});
  }else delete items[String(oreItemID)];
  for(const out of outputs){
    const id=nextItemID(ownerID,items,null);
    if(!positive(id)||items[String(id)])return {success:false,errorMsg:"REFINERY_ITEM_ID_CONFLICT"};
    const item=buildInventoryItem({itemID:id,typeID:Number(out.typeID),ownerID,
      locationID:stationID,flagID:ITEM_FLAGS.HANGAR,quantity:Number(out.quantity),
      stacksize:Number(out.quantity),singleton:0,
      customInfo:prefix+Number(out.typeID)});
    if(item.typeID!==Number(out.typeID)||item.quantity!==Number(out.quantity))
      return {success:false,errorMsg:"REFINERY_OUTPUT_MISMATCH"};
    items[String(id)]=item;
    created.push({itemID:id,typeID:item.typeID,quantity:item.quantity,customInfo:item.customInfo});
  }
  if(!writeItems(items))return {success:false,errorMsg:"REFINERY_ITEMS_WRITE_UNCERTAIN"};
  // GameStore writes go through a deferred cache; a successful write() is NOT durable.
  const sync=repo.flushTableSync(ITEMS_TABLE);
  if(!sync||sync.success!==true)return {success:false,errorMsg:"REFINERY_ITEMS_FLUSH_UNCERTAIN"};
  return {success:true,data:{oreItemID,originalQuantity,consumeQuantity,leftOvers,created}};
}
// COOP_NATIVE_REFINERY_ATOMIC_END
`;
function patch(source,file,remove=false){
 if(file!==TARGET)throw Error("REFINERY_FILE_MISMATCH");
 const eol=source.includes("\r\n")?"\r\n":"\n";
 const hook=HOOK.replace(/\n/g,eol);
 const exportEntry=`  refineNpcWarehouseOreAtomic,${eol}`;
 const count=(hay,needle)=>hay.split(needle).length-1;
 if(remove){
  if(count(source,BEGIN)===0&&count(source,exportEntry)===0)return source;
  if(count(source,BEGIN)!==1||count(source,END)!==1||count(source,exportEntry)!==1)
   throw Error("REFINERY_PATCH_REMOVE_DRIFT");
  return source.replace(hook,"").replace(exportEntry,"");
 }
 if(count(source,BEGIN)===1&&count(source,exportEntry)===1)return source;
 if(count(source,BEGIN)||count(source,END)||count(source,exportEntry))throw Error("REFINERY_PATCH_PARTIAL");
 const anchor="module.exports = {"+eol;
 if(count(source,anchor)!==1)throw Error("REFINERY_EXPORT_ANCHOR_DRIFT");
 return source.replace(anchor,hook+anchor+exportEntry);
}
module.exports={patch,TARGET,BEGIN,END,HOOK};