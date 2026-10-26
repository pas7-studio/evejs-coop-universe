import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch,WRECK,STORE}=require("../scripts/coop-npc-expedition-wreck-patch.cjs");
const {patch:salvagePatch}=require("../scripts/coop-salvage-death-native-patch.cjs");
const nativeWreck=process.env.EVEJS_PINNED_NPC_WRECK_SOURCE;
const nativeStore=process.env.EVEJS_PINNED_NPC_STORE_SOURCE;
function source(file){
 if(file&&fs.existsSync(file))return fs.readFileSync(file,"utf8");
 return null;
}
test("EX-03B18 native wreck adapter source pin is exactly reversible, syntax-safe and idempotent",()=>{
 for(const [file,pin] of [[WRECK,nativeWreck],[STORE,nativeStore]]){
  const original=source(pin);
  if(!original)return; // On Actions, both pins MUST be supplied below.
  const patched=patch(original,file);
  assert.notEqual(patched,original);
  assert.equal(patch(patched,file),patched);
  assert.equal(patch(patched,file,true),original);
  assert.doesNotThrow(()=>new Function("require","module","exports","__dirname",patched));
  assert.equal(patch(original,file,true),original);
 }
});
test("EX-03B18 EXACT pinned sources: death to source wreck, item listing, pickup and decay guard are stock-hooked",
 {skip:!nativeWreck||!nativeStore},()=>{
 const beforeW=source(nativeWreck),beforeS=source(nativeStore);
 assert(beforeW&&beforeS,"EX03_REQUIRED_PINNED_UPSTREAM_MISSING");
 const patchedW=patch(beforeW,WRECK),patchedS=patch(beforeS,STORE);
 for(const phrase of [
  "EX03B18_NATIVE_WRECK_STAGE",
  "EX03B18_NATIVE_ORIGINAL_ITEM_PICKUP",
  "EX03B18_NATIVE_WRECK_DECAY_GUARD",
  "EX03B18_NATIVE_WRECK_SLIM_REFRESH",
  "EX03B18_NATIVE_DEATH_FAILURE_FENCE",
  "canDestroy(wreckRecord.wreckID)",
  "refreshNativeWreckRuntimeEntity(wreckRecord.systemID,wreckID,{broadcast:true})"
 ])assert.ok(patchedW.includes(phrase),phrase);
 assert.match(patchedS,/EX03B18_NATIVE_WRECK_CONTENTS/);
 assert.match(patchedS,/\.list\(\{wreckID:normalizedWreckID\}\)/);
 assert.match(patchedW,/createNpcExpeditionWreckCustody/);
 assert.match(patchedS,/createNpcExpeditionWreckCustody/);
 assert.equal(patch(patchedW,WRECK,true),beforeW);
 assert.equal(patch(patchedS,STORE,true),beforeS);
 // The stock normal NPC loot call remains intact when flag OFF.
 assert.match(patchedW,/const grantResult = grantItemToCharacterLocation\(/);
 assert.match(patchedW,/nativeNpcStore\.buildNativeCargoItems\(entityID\)/);
});
test("EX-03B18 stock nativeNpcStore source returns ORIGINAL itemID row on visible wreck",
 {skip:!nativeStore},()=>{
 const original=source(nativeStore);
 assert(original,"EX03_REQUIRED_PINNED_NPC_STORE_MISSING");
 const patched=patch(original,STORE);
 const wreckID=980300000321,itemID=730000000321;
 const item={itemID,ownerID:700,locationID:wreckID,
  flagID:4,typeID:34,quantity:3,stacksize:3,singleton:0,
  customInfo:"coop-npc-expedition:v1:container:62:ship:980000000321:corp:700:wreck:"+wreckID};
 const rows={npcWrecks:{nextWreckID:0,wrecks:{
  [wreckID]:{wreckID,sourceEntityID:980000000321,corporationID:999,coopNpcExpeditionSourceCorpID:700,
   systemID:30000142,transient:false}
 }},npcWreckItems:{items:{},nextWreckItemID:0}};
 const items={ITEM_FLAGS:{HANGAR:4,CARGO_HOLD:5},
  findItemById:()=>({...item}),
  listContainerItems:(_owner,loc)=>loc===wreckID?[{...item}]:[],
  updateInventoryItem:()=>({success:true}),
  moveItemToLocation:()=>({success:true}),
  transferItemToOwnerLocation:()=>({success:true})};
 const gameStore={read:(table,key)=>{
   let x=rows[table]||{};
   for(const part of String(key||"/").split("/").filter(Boolean))x=x?.[part];
   return {success:true,data:x||{}};
  },
  write:(table,key,value)=>({success:true}),
  ensureTable:()=>true,flushTableSync:()=>({success:true})};
 const adapter=require("../integration/coopNpcExpeditionWreckCustody.cjs");
 const dependencies=p=>{
  if(p==="path")return{join:(...x)=>x.join("/")};
  if(p.includes("gameStore"))return gameStore;
  if(p.includes("services/inventory/itemStore"))return items;
  if(p.includes("coopNpcExpeditionWreckCustody"))return adapter;
  if(p.includes("nativeNpcStore"))return m.exports;
  throw Error("UNEXPECTED_PINNED_NATIVE_REQUIRE:"+p);
 };
 const m={exports:{}};
 const previous=process.env.EVEJS_COOP_NPC_EXPEDITION_WRECK;
 try{
  process.env.EVEJS_COOP_NPC_EXPEDITION_WRECK="1";
  new Function("require","module","exports","__dirname",patched)(
   dependencies,m,m.exports,"/pinned/server/src/space/npc");
  // This tests the actual exported original store function, not a copy.
  // The fake minimal GameStore may require valid root shape (stock helper).
  const visible=m.exports.buildNativeWreckContents(wreckID);
  assert.equal(visible.length,1);
  assert.equal(visible[0].itemID,itemID);
  assert.equal(visible[0].customInfo,item.customInfo);
 }finally{
  if(previous===undefined)delete process.env.EVEJS_COOP_NPC_EXPEDITION_WRECK;
  else process.env.EVEJS_COOP_NPC_EXPEDITION_WRECK=previous;
 }
});

test("EX-03B19 actual pinned NPC wreck and native salvage hooks are composable, idempotent and reversible",
 {skip:!nativeWreck},()=>{
 const original=source(nativeWreck);
 assert(original,"EX03_EXACT_NATIVE_WRECK_SOURCE_REQUIRED");
 const installed=salvagePatch(patch(original,WRECK),false);
 assert.equal(patch(installed,WRECK),installed);
 assert.equal(salvagePatch(installed,false),installed);
 assert.doesNotThrow(()=>new Function("require","module","exports","__dirname",installed));
 const cleaned=patch(salvagePatch(installed,true),WRECK,true);
 assert.equal(cleaned,original,"must restore exact pinned stock source bytes");
});

test("EX-03B20 stock native wreck remains fully functional with experimental flag OFF",
 {skip:!nativeWreck},()=>{
 const raw=source(nativeWreck);
 const patched=patch(raw,WRECK);
 // Execute ORIGINAL native build function, with a tripwire if the new
 // expedition module is accessed when flags are unset.
 let newModuleRequested=0;
 const item={itemID:980300000321,ownerID:901,typeID:26520,
  locationID:980300000321,flagID:4};
 const wreck={wreckID:item.itemID,systemID:30000142,
  sourceEntityID:980000000321,corporationID:999,
  sourceTypeID:588,createdAtMs:1000,
  position:{x:0,y:0,z:0},direction:{x:1,y:0,z:0}};
 const npcStore={
  buildNativeWreckInventoryItem:()=>({...item}),
  listNativeWreckItemsForWreck:()=>[],
  getNativeWreck:()=>({...wreck})};
 const scene={systemID:30000142,
  getEntityByID:()=>({itemID:item.itemID,kind:"wreck",isEmpty:false}),
  getCurrentSimTimeMs:()=>1200};
 const runtime={buildRuntimeSpaceEntityFromItemRecord:()=>({itemID:item.itemID}),
  ensureScene:()=>scene};
 const shim=p=>{
  if(p==="path")return {join:(...parts)=>parts.join("/")};
  if(p.includes("coopNpcExpeditionWreckCustody")){
   newModuleRequested++;throw Error("EX03_MODULE_TOUCHED_WHEN_FLAG_OFF");
  }
  if(p.includes("space/runtime")||p.endsWith("/runtime"))return runtime;
  if(p.includes("spaceDebrisState"))return{getSpaceDebrisLifetimeMs:()=>100000};
  if(p.includes("itemStore"))return{ITEM_FLAGS:{HANGAR:4}};
  if(p.includes("itemTypeRegistry"))return{resolveItemByTypeID:()=>null};
  if(p.includes("npcData"))return{getNpcLootTable:()=>null};
  if(p.includes("npcLoot"))return{rollNpcLootEntries:()=>[]};
  if(p.includes("npcRegistry"))return{getControllerByEntityID:()=>null,unregisterController:()=>{}};
  if(p.includes("nativeNpcStore"))return npcStore;
  if(p.includes("wreckUtils"))return{buildDunRotationFromDirection:()=>[],
   resolveEntityWreckType:()=>({typeID:26520})};
  return {};
 };
 const m={exports:{}},before=process.env.EVEJS_COOP_NPC_EXPEDITION_WRECK;
 try{
  delete process.env.EVEJS_COOP_NPC_EXPEDITION_WRECK;
  new Function("require","module","exports","__dirname",patched)(
   shim,m,m.exports,"/pinned/server/src/space/npc");
  const native=m.exports.buildNativeWreckRuntimeEntity(wreck,{nowMs:1200});
  assert(native);
  assert.equal(native.itemID,item.itemID);
  assert.equal(native.isEmpty,true);
  assert.equal(newModuleRequested,0,"stock OFF must not load expedition itemStore");
 }finally{
  if(before===undefined)delete process.env.EVEJS_COOP_NPC_EXPEDITION_WRECK;
  else process.env.EVEJS_COOP_NPC_EXPEDITION_WRECK=before;
 }
});
