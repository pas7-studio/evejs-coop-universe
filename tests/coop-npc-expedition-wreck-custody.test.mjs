import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNpcExpeditionWreckCustody}=
 require("../integration/coopNpcExpeditionWreckCustody.cjs");
const shipID=980000000321,wreckID=980300000321,corp=700,
 itemID=730000000321,characterID=321,playerShipID=880000000321;
const tag="coop-npc-expedition:v1:container:620000000321:ship:"+shipID+":corp:"+corp;
function fixture(){
 let flushCount=0,failAt=0,transferCount=0;
 const rows=new Map([
 [itemID,{itemID,typeID:34,ownerID:corp,locationID:shipID,flagID:5,
  singleton:0,stacksize:3,quantity:3,customInfo:tag}],
 [playerShipID,{itemID:playerShipID,typeID:123,ownerID:characterID,
  locationID:999,flagID:4,singleton:1,stacksize:1,quantity:-1,customInfo:""}]
 ]);
 const wrecks=new Map([[wreckID,{wreckID,sourceEntityID:shipID,
  corporationID:corp,systemID:30000142,transient:false}]]);
 const items={ITEM_FLAGS:{HANGAR:4,CARGO_HOLD:5},
  findItemById:id=>rows.get(id)?{...rows.get(id)}:null,
  listContainerItems:(_owner,loc,flag)=>[...rows.values()]
   .filter(x=>x.locationID===loc&&(flag==null||x.flagID===flag))
   .map(x=>({...x})),
  updateInventoryItem:(id,fn)=>{const row=rows.get(id);
   if(!row)return {success:false};
   rows.set(id,fn({...row}));return {success:true}},
  moveItemToLocation:(id,loc,flag)=>{const row=rows.get(id);
   if(!row)return {success:false};
   rows.set(id,{...row,locationID:loc,flagID:flag});return {success:true}},
  transferItemToOwnerLocation:(id,owner,loc,flag)=>{
   transferCount++;const row=rows.get(id);
   if(!row)return {success:false};
   rows.set(id,{...row,ownerID:owner,locationID:loc,flagID:flag});
   return {success:true,data:{quantity:row.stacksize,changes:[]}}
  }
 };
 const npcStore={getNativeWreck:id=>wrecks.get(id)||null,
  listNativeWrecks:()=>[...wrecks.values()]};
 const gameStore={flushTableSync:()=>({success:++flushCount!==failAt})};
 return {make:()=>createNpcExpeditionWreckCustody({items,npcStore,gameStore}),
  rows,wrecks,items,
  get flushCount(){return flushCount},get transferCount(){return transferCount},
  setFail:v=>{failAt=v}};
}
test("EX-03B18 exact original ItemStore itemID survives NPC death, physical wreck and player pickup",()=>{
 const f=fixture(),c=f.make();
 assert.equal(c.stage({wreckID,shipID,corporationID:corp}).status,"ORIGINAL_ITEMSTORE_LOOT_IN_WRECK");
 assert.equal(c.list({wreckID}).length,1);
 assert.equal(c.list({wreckID})[0].itemID,itemID);
 assert.equal(f.rows.size,2,"no new itemID, including no fabricated wreckItemID");
 assert.equal(f.rows.get(itemID).locationID,wreckID);
 assert.equal(c.canDestroy(wreckID),false,"physical wreck cannot vanish with original cargo");
 assert.equal(f.flushCount,3,"original wreck and item provenance/move were flushed");
 const result=c.claim({characterID,wreckID,itemID,destinationLocationID:playerShipID,
  destinationFlagID:5,quantity:3});
 assert.equal(result.status,"HANDLED");
 assert.equal(result.success,true);
 assert.equal(result.originalItemID,itemID);
 assert.equal(result.data.quantity,3);
 assert.equal(f.rows.get(itemID).itemID,itemID);
 assert.equal(f.rows.get(itemID).ownerID,characterID);
 assert.equal(f.rows.get(itemID).locationID,playerShipID);
 assert.equal(f.rows.get(itemID).quantity,3);
 assert.equal(f.rows.size,2);
 assert.equal(f.transferCount,1);
 assert.equal(c.canDestroy(wreckID),true);
 assert.equal(c.list({wreckID}).length,0);
 assert.equal(c.claim({characterID,wreckID,itemID,destinationLocationID:playerShipID,
  destinationFlagID:5}).status,"NOT_EXPEDITION_ITEM");
 assert.equal(f.transferCount,1,"same original ID never claimed twice");
});
test("EX-03B18 no split, foreign player ship, or wrong flag can collect original NPC wreck loot",()=>{
 const f=fixture(),c=f.make();
 assert.equal(c.stage({wreckID,shipID,corporationID:corp}).success,true);
 for(const attempt of [
  {characterID,wreckID,itemID,destinationLocationID:playerShipID,destinationFlagID:5,quantity:1},
  {characterID:777,wreckID,itemID,destinationLocationID:playerShipID,destinationFlagID:5,quantity:3},
  {characterID,wreckID,itemID,destinationLocationID:playerShipID,destinationFlagID:4,quantity:3}
 ]){
  const r=c.claim(attempt);
  assert.equal(r.status,"HANDLED");assert.equal(r.success,false);
 }
 assert.equal(f.rows.get(itemID).ownerID,corp);
 assert.equal(f.transferCount,0);
});
test("EX-03B18 SIGKILL window after durable intent is fail-closed across fresh driver",()=>{
 const f=fixture(),c=f.make();f.setFail(2);
 assert.equal(c.stage({wreckID,shipID,corporationID:corp}).success,false);
 assert.equal(f.rows.get(itemID).itemID,itemID);
 assert.match(f.rows.get(itemID).customInfo,/:wreck:/);
 const resumed=f.make();f.setFail(0);
 assert.equal(resumed.stage({wreckID,shipID,corporationID:corp}).success,false);
 assert.equal(f.rows.get(itemID).locationID,shipID);
 assert.equal(f.rows.size,2);
 assert.equal(resumed.list({wreckID}).length,0);
});
test("EX-03B18 wreck decay refuses unverifiable/partial original expedition items",()=>{
 const f=fixture(),c=f.make();
 assert.equal(c.stage({wreckID,shipID,corporationID:corp}).success,true);
 assert.equal(c.canDestroy(wreckID),false);
 f.rows.get(itemID).customInfo="coop-npc-expedition:v1:corrupt";
 assert.equal(c.list({wreckID}).length,0);
 assert.equal(c.canDestroy(wreckID),false,"malformed marker must not hide cargo from expiry guard");
});
test("EX-03B18 previously allocated native wreck blocks second death even when original NPC hold empty",()=>{
 const f=fixture(),c=f.make();
 assert.equal(c.stage({wreckID,shipID,corporationID:corp}).success,true);
 f.wrecks.set(980300000322,{wreckID:980300000322,
  sourceEntityID:shipID,corporationID:corp,transient:false});
 assert.equal(c.stage({wreckID:980300000322,shipID,corporationID:corp}).success,false);
 assert.equal(f.rows.size,2);
});
