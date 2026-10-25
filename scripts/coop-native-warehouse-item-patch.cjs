"use strict";
// One reversible hook into the exact pinned EveJS itemStore; no global
// item creation API is granted to clients. Called only by trusted warehouse.
const FILE="server/src/services/inventory/itemStore.js";
const BEGIN="// COOP_NATIVE_WAREHOUSE_ITEM_BEGIN";
const END="// COOP_NATIVE_WAREHOUSE_ITEM_END";
const injection=`${BEGIN}
function findWarehouseItem({cargoID}={}) {
  if(!Number.isSafeInteger(Number(cargoID))||Number(cargoID)<=0)
    throw Error("WAREHOUSE_CARGO_ID_INVALID");
  ensureMigrated();
  const tag="coop-warehouse:v1:cargo:"+String(cargoID);
  const matches=Object.values(readItems()).filter(x=>x&&x.customInfo===tag);
  if(matches.length>1)throw Error("WAREHOUSE_DUPLICATE_NATIVE_ITEM_TAG");
  return matches[0]?cloneValue(matches[0]):null;
}
function grantUniqueNpcDepotItem({ownerID,stationID,typeID,quantity,cargoID}={}) {
  ensureMigrated();
  const valid=v=>Number.isSafeInteger(Number(v))&&Number(v)>0;
  if(![ownerID,stationID,typeID,quantity,cargoID].every(valid)||
    Number(quantity)>CLIENT_INVENTORY_STACK_LIMIT)
    return {success:false,errorMsg:"INVALID_NATIVE_WAREHOUSE_GRANT"};
  const tag="coop-warehouse:v1:cargo:"+String(cargoID);
  const all=readItems(),matches=Object.values(all).filter(x=>x&&x.customInfo===tag);
  if(matches.length>1)return {success:false,errorMsg:"DUPLICATE_NATIVE_WAREHOUSE_TAG"};
  if(matches.length===1){
    const item=matches[0];
    if(Number(item.ownerID)!==Number(ownerID)||Number(item.locationID)!==Number(stationID)||
       Number(item.flagID)!==ITEM_FLAGS.HANGAR||Number(item.typeID)!==Number(typeID)||
       Number(item.quantity)!==Number(quantity)||Number(item.singleton)!==0)
      return {success:false,errorMsg:"NATIVE_WAREHOUSE_TAG_COLLISION"};
    return {success:true,data:{itemID:item.itemID,existing:true}};
  }
  const type=resolveItemTypeReference({typeID:Number(typeID)});
  if(!type || Number(type.typeID)!==Number(typeID) || shouldItemDefaultToSingleton(type))
    return {success:false,errorMsg:"WAREHOUSE_CARGO_TYPE_INVALID"};
  const item=buildInventoryItem({itemID:nextItemID(Number(ownerID),all,null),
    typeID:Number(typeID),ownerID:Number(ownerID),locationID:Number(stationID),
    flagID:ITEM_FLAGS.HANGAR,quantity:Number(quantity),stacksize:Number(quantity),
    singleton:0,customInfo:tag});
  // No merge with pre-existing stacks; receipt tag survives restarts.
  all[String(item.itemID)]=item;
  if(!writeItems(all,{indexDelta:{upsertedIDs:[item.itemID],removedIDs:[]}}))
    return {success:false,errorMsg:"WAREHOUSE_ITEM_WRITE_FAILED"};
  return {success:true,data:{itemID:item.itemID,existing:false}};
}
${END}
`;
function patch(text,file,remove=false){
 if(file!==FILE)return text;
 const anchor="module.exports = {";
 const eol=text.includes("\r\n")?"\r\n":"\n";
 const code=injection.replaceAll("\n",eol);
 const exportsLine="  findWarehouseItem,"+eol+"  grantUniqueNpcDepotItem,"+eol;
 if(remove){
  if(!text.includes(BEGIN)&&!text.includes(END))return text;
  if(text.split(BEGIN).length!==2||text.split(END).length!==2||
     !text.includes(code)||text.split(exportsLine).length!==2)
   throw Error("WAREHOUSE_PATCH_DRIFT");
  return text.replace(code,"").replace(anchor+eol+exportsLine,anchor+eol);
 }
 if(text.includes(BEGIN)){
  if(text.includes(code)&&text.includes(anchor+eol+exportsLine))return text;
  throw Error("WAREHOUSE_PATCH_DRIFT");
 }
 if(text.split(anchor).length!==2||!text.includes("function writeItems(")||!text.includes("function nextItemID("))
  throw Error("WAREHOUSE_PINNED_SOURCE_MISMATCH");
 return text.replace(anchor,code+anchor).replace(anchor+eol,anchor+eol+exportsLine);
}
module.exports={patch,FILE,BEGIN,END};