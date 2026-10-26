import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNpcExpeditionOperations}=
 require("../integration/coopNpcExpeditionOperations.cjs");
const {createNpcExpeditionLoot}=
 require("../integration/coopNpcExpeditionLoot.cjs");
const sid=30000142,shipID=980000000321,containerID=6200000000321,
 itemID=7300000000311,stationID=60000321,corpID=700;
function fixture(){
 let now=1000000,hackTurns=0,warps=0;
 const ship={itemID:shipID,kind:"ship",nativeNpc:true,ownerID:901,
  corporationID:corpID,position:{x:0,y:0,z:0},mode:"STOP"};
 const site={itemID:490,kind:"signature",position:{x:0,y:0,z:0}};
 const container={itemID:containerID,kind:"container",ownerID:1,
  dungeonSiteID:490,dungeonSiteInstanceID:900,
  dungeonMaterializedContainer:true,dungeonMaterializedSiteContent:true,
  dungeonSiteContentAnalyzer:"data",dungeonSiteContentHackingState:0,
  position:{x:500,y:0,z:0},radius:30};
 const station={itemID:stationID,kind:"station",position:{x:1e7,y:0,z:0},radius:500};
 const entities=new Map([[shipID,ship],[490,site],[containerID,container],[stationID,station]]);
 const scene={systemID:sid,getEntityByID:id=>entities.get(id)};
 const rows=new Map([[itemID,{itemID,typeID:4001,ownerID:1,
  locationID:containerID,flagID:5,quantity:3,stacksize:3,singleton:0,customInfo:""}]]);
 const nativeStore={
  getNativeEntity:id=>id===shipID?{entityID:shipID,systemID:sid,ownerID:901,
   corporationID:corpID}:null,
  listNativeModulesForEntity:()=>[{entityID:shipID,moduleID:980100000321,
   ownerID:901,typeID:22175,categoryID:7,itemName:"Data Analyzer I",
   moduleState:{online:true}}]
 };
 const itemStore={ITEM_FLAGS:{CARGO_HOLD:5,HANGAR:4},
  findItemById:id=>rows.get(id)?{...rows.get(id)}:null,
  listContainerItems:(owner,loc,flag)=>[...rows.values()].filter(x=>
   x.locationID===loc&&(owner==null||x.ownerID===owner)&&
   (flag==null||x.flagID===flag)).map(x=>({...x})),
  updateInventoryItem:(id,fn)=>{
   rows.set(id,fn({...rows.get(id)}));return {success:true};
  },
  transferItemToOwnerLocation:(id,owner,loc,flag)=>{
   Object.assign(rows.get(id),{ownerID:owner,locationID:loc,flagID:flag});return {success:true}},
  moveItemToLocation:(id,loc,flag)=>{
   Object.assign(rows.get(id),{locationID:loc,flagID:flag});return {success:true}}
 };
 const gameStore={flushTableSync:()=>({success:true})};
 const hackingService={nativeNpcTurn:()=>{
  hackTurns++;
  if(hackTurns===3)container.dungeonSiteContentHackingState=2;
  return {status:hackTurns===1?"NATIVE_NPC_HACK_STARTED":
   hackTurns===2?"NATIVE_NPC_HACK_PROGRESS":"NATIVE_NPC_HACK_SUCCESS"};
 }};
 const assignments=[{pilotID:"coop-pilot-321",entityID:shipID,systemID:sid}];
 const tips=[{systemID:sid,siteID:490,corpID,scoutPilotID:"coop-pilot-321"}];
 const deps={nativeStore,itemStore,gameStore,getController:()=>({entityID:shipID,systemID:sid}),
  getStation:()=>({stationID,solarSystemID:sid,corporationID:corpID}),
  getStationsForSystem:()=>[{stationID,solarSystemID:sid,corporationID:corpID}],
  isNpcCorporation:id=>id===corpID,
  siteService:{listMaterializedUniverseSiteContentEntities:()=>[container]},
  hackingService,typeHasEffectName:(type,effect)=>type===22175&&effect==="doHacking",
  resolveItemByTypeID:()=>({name:"Data Analyzer I"}),
  orderBridge:{blocked:()=>false,issue:({execute})=>execute()},
  warpToPoint:()=>{warps++;return {success:true}},
  clock:()=>now};
 const tick=(driver,flags={hack:true,loot:true})=>
  driver.tick({scene,assignments,tips,flags});
 return{make:()=>createNpcExpeditionOperations(deps),deps,rows,ship,station,site,
  container,scene,assignments,tips,tick,
  get warps(){return warps},get hackTurns(){return hackTurns},
  advance:ms=>{now+=ms}};
}
test("EX-03B15 NPC physically witnesses site, hacks original board, picks exact item and returns",()=>{
 const f=fixture(),d=f.make();
 assert.equal(f.tick(d).hacked,0);
 assert.equal(f.tick(d).hacked,0);
 const unlocked=f.tick(d);
 assert.equal(unlocked.hacked,1);
 assert.equal(unlocked.picked,1);
 assert.equal(unlocked.orderedReturn,1);
 assert.equal(f.rows.size,1);
 assert.equal(f.rows.get(itemID).itemID,itemID);
 assert.equal(f.rows.get(itemID).locationID,shipID);
 assert.equal(f.warps,1);
 f.ship.position={...f.station.position};
 assert.equal(f.tick(d).delivered,0,"station requires dwell");
 f.advance(2500);
 assert.equal(f.tick(d).delivered,1);
 assert.equal(f.rows.get(itemID).locationID,stationID);
 assert.equal(f.rows.size,1);
 assert.equal(d.inspectLoot(itemID).status,"IN_WAREHOUSE");
 assert.equal(f.tick(d).delivered,0,"no duplicate warehouse item");
});
test("EX-03B15 no physical on-grid expedition proof: no hack or free item",()=>{
 const f=fixture(),d=f.make();
 assert.equal(f.tick(d,{hack:true,loot:true}).hacked,0);
 f.site.position.x=2e8;
 const result=f.tick(d);
 assert.equal(result.hacked,0);
 assert.equal(result.picked,0);
 assert.equal(f.rows.get(itemID).ownerID,1);
});
test("EX-03B15 original corporation refusal blocks expedition loot pickup",()=>{
 const f=fixture(),d=f.make();
 f.deps.isNpcCorporation=()=>false;
 const other=createNpcExpeditionOperations(f.deps);
 f.container.dungeonSiteContentHackingState=2;
 assert.equal(f.tick(other,{hack:false,loot:true}).picked,0);
 assert.equal(f.rows.get(itemID).locationID,containerID);
});
