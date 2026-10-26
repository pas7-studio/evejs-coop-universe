import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNpcExpeditionLoot}=require("../integration/coopNpcExpeditionLoot.cjs");
const sid=30000142,entityID=980000000321,corp=700,containerID=6200000000221,
 itemID=730000000001,stationID=60000111;
function fixture(){
 let flushes=0, failFlush=false, failAfterMove=false, docked=false;
 const ship={itemID:entityID,kind:"ship",nativeNpc:true,ownerID:901,
  corporationID:corp,position:{x:0,y:0,z:0}};
 const container={itemID:containerID,ownerID:1,
  position:{x:1800,y:0,z:0},radius:30,
  dungeonMaterializedContainer:true,dungeonMaterializedSiteContent:true,
  dungeonSiteContentHackingState:2};
 const rows=new Map([[itemID,{
  itemID,typeID:4001,ownerID:1,locationID:containerID,
  flagID:5,quantity:3,stacksize:3,singleton:0,customInfo:""
 }]]);
 const itemStore={ITEM_FLAGS:{CARGO_HOLD:5,HANGAR:4},
  findItemById:id=>rows.has(id)?{...rows.get(id)}:null,
  listContainerItems:(_owner,loc)=>[...rows.values()].filter(x=>x.locationID===loc).map(x=>({...x})),
  writeItemCustomInfo:(id,value)=>{
   const item=rows.get(id);if(!item)return {success:false};
   rows.set(id,{...item,customInfo:value});return {success:true};
  },
  transferItemToOwnerLocation:(id,owner,location,flag)=>{
   const item=rows.get(id);if(!item)return {success:false};
   rows.set(id,{...item,ownerID:owner,locationID:location,flagID:flag});
   if(failAfterMove)throw Error("native transfer outcome ambiguous");
   return {success:true};
  },
  moveItemToLocation:(id,location,flag)=>{
   const item=rows.get(id);if(!item)return {success:false};
   rows.set(id,{...item,locationID:location,flagID:flag});return {success:true};
  }
 };
 const nativeStore={getNativeEntity:()=>({entityID,systemID:sid,ownerID:901,corporationID:corp})};
 const controllers={get:()=>({entityID,systemID:sid})};
 const scene={systemID:sid,getEntityByID:id=>id===entityID?ship:id===containerID?container:null};
 const assignments=[{pilotID:"coop-pilot-321",entityID,systemID:sid}];
 const gameStore={flushTableSync:table=>{
  assert.equal(table,"items");flushes++;
  return {success:!failFlush};
 }};
 const deps={nativeStore,itemStore,gameStore,
  getController:controllers.get,getStation:id=>id===stationID?
   {stationID,solarSystemID:sid}:null,
  isNpcCorporation:id=>id===corp,
  isNativeSiteOwner:(owner,source)=>owner===1&&source.ownerID===1,
  verifyNativeArrival:()=>docked,clock:()=>1000000};
 const args={scene,entityID,assignments,itemID,containerID,stationID};
 return {make:()=>createNpcExpeditionLoot(deps),args,rows,ship,container,assignments,
  get flushes(){return flushes},
  setDocked:v=>{docked=v},setFlushFailure:v=>{failFlush=v},
  setTransferThrow:v=>{failAfterMove=v}};
}
test("EX-03B15 exact original itemID moves container -> NPC ship -> corporate hangar",()=>{
 const f=fixture(),d=f.make();
 const before=f.rows.get(itemID);
 assert.equal(d.collect(f.args).status,"NATIVE_ORIGINAL_LOOT_IN_SHIP");
 assert.equal(f.rows.size,1);
 assert.equal(f.rows.get(itemID).itemID,itemID);
 assert.equal(f.rows.get(itemID).typeID,before.typeID);
 assert.equal(f.rows.get(itemID).quantity,3);
 assert.equal(f.rows.get(itemID).locationID,entityID);
 assert.equal(f.flushes,2);
 assert.equal(d.inspectReceipt(itemID).status,"IN_SHIP");
 assert.equal(d.deliver(f.args).reason,"EX03_LOOT_NATIVE_STATION_ARRIVAL_MISSING");
 f.setDocked(true);
 assert.equal(d.deliver(f.args).status,"NATIVE_ORIGINAL_LOOT_IN_CORPORATE_WAREHOUSE");
 assert.equal(f.rows.get(itemID).locationID,stationID);
 assert.equal(f.rows.get(itemID).ownerID,corp);
 assert.equal(f.rows.size,1);
 assert.equal(f.flushes,3);
 assert.equal(d.inspectReceipt(itemID).status,"IN_WAREHOUSE");
 assert.equal(d.collect(f.args).status,"BLOCKED","never duplicate original item");
});
test("EX-03B15 restart rehydrates original item provenance without allocating inventory",()=>{
 const f=fixture();const a=f.make();
 assert.equal(a.collect(f.args).status,"NATIVE_ORIGINAL_LOOT_IN_SHIP");
 const b=f.make();
 assert.equal(b.inspectReceipt(itemID).status,"IN_SHIP");
 f.setDocked(true);
 assert.equal(b.deliver(f.args).status,"NATIVE_ORIGINAL_LOOT_IN_CORPORATE_WAREHOUSE");
 assert.equal(f.rows.size,1);
});
test("EX-03B15 no hack, no range, no owner, no source content: no item movement",()=>{
 for(const mutate of [
  f=>{f.container.dungeonSiteContentHackingState=0},
  f=>{f.ship.position.x=1e7},
  f=>{f.container.ownerID=999},
  f=>{f.rows.get(itemID).ownerID=25},
  f=>{f.rows.get(itemID).locationID=111},
  f=>{f.rows.get(itemID).customInfo="already-used"}
 ]){
  const f=fixture();mutate(f);
  assert.equal(f.make().collect(f.args).status,"BLOCKED");
  assert.equal(f.flushes,0);
 }
});
test("EX-03B15 native store flush uncertainty quarantines original item",()=>{
 const f=fixture(),d=f.make();f.setFlushFailure(true);
 assert.equal(d.collect(f.args).status,"BLOCKED");
 assert.equal(f.rows.size,1);
 f.setFlushFailure(false);
 assert.equal(d.collect(f.args).reason,"EX03_LOOT_OPERATOR_REPAIR_REQUIRED");
});
test("EX-03B15 ambiguous native ItemStore transfer cannot replay",()=>{
 const f=fixture(),d=f.make();f.setTransferThrow(true);
 assert.equal(d.collect(f.args).status,"BLOCKED");
 assert.equal(d.collect(f.args).reason,"EX03_LOOT_OPERATOR_REPAIR_REQUIRED");
 assert.equal(f.rows.size,1);
 assert.equal(d.inspectReceipt(itemID).status,"IN_SHIP");
});
test("EX-03B15 player-owned or unauthorized dock cannot launder native expedition loot",()=>{
 const f=fixture(),d=f.make();
 assert.equal(d.collect(f.args).status,"NATIVE_ORIGINAL_LOOT_IN_SHIP");
 f.ship.session={characterID:8000};
 f.setDocked(true);
 assert.equal(d.deliver(f.args).status,"BLOCKED");
 f.ship.session=null;
 f.rows.get(itemID).ownerID=8000;
 assert.equal(d.deliver(f.args).status,"BLOCKED");
});
