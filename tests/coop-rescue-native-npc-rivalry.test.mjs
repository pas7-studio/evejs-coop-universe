import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createRescueRivalry}=require("../integration/coopRescueNpcRivalry.cjs");
const {createRescueNpcDepot}=require("../integration/coopRescueNpcDepot.cjs");
const {createNativeRescueTransfer}=require("../integration/coopRescueNativeTransfer.cjs");
const old=Object.fromEntries(["EVEJS_COOP_RESCUE_NPC_RIVALS",
 "EVEJS_COOP_RESCUE_ATOMIC","EVEJS_COOP_RESCUE_PROVENANCE"]
 .map(k=>[k,process.env[k]]));
for(const k of Object.keys(old))process.env[k]="1";
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(fn){
 let time=1000000,loss=true,warp=0,orbit=0,shipAt=0,rollback=false;
 let db={npcEntities:{entities:{"2002":{entityID:2002,systemID:30000144,
    corporationID:20002,transient:false}}},
  npcWreckItems:{items:{"8201":{wreckItemID:8201,wreckID:8001,
    sourceKind:"cargo",sourceCargoID:5501,sourceOriginalQuantity:8,
    typeID:34,quantity:8,singleton:false}}},
  npcCargo:{nextCargoID:980200000100,cargo:{}},
  items:{"1701":{itemID:1701,ownerID:701,categoryID:6}},
  characters:{"701":{characterID:701}},identityState:{nextItemID:9000}};
 const wreck={wreckID:8001,systemID:30000144,sourceEntityID:901,corporationID:10001};
 const scene={systemID:30000144,
  staticEntities:[{kind:"station",itemID:60002,position:{x:10000,y:0,z:0}}],
  getEntityByID:id=>id===8001?{nativeNpcWreck:true,
   itemID:8001,position:{x:0,y:0,z:0}}:id===2002?{
   kind:"ship",nativeNpc:true,itemID:2002,mode:"STOP",
   position:{x:shipAt,y:0,z:0}}:null};
 const atomic=(tables,fn)=>{
  const before=copy(db);
  const tx={get:(t,k)=>db[t]?.[k]??null,
   put:(t,k,v)=>db[t][k]=v,
   scan:t=>Object.entries(db[t]).map(([key,value])=>({key,value}))};
  try{const r=fn(tx);if(rollback)throw Error("ROLLBACK");return r}
  catch(e){db=before;throw e}
 };
 const candidates=[{role:"trader",entityID:2002,systemID:30000144,
  corporationID:20002}];
 const rivalry=createRescueRivalry({
  getWrecks:()=>[wreck],
  getWreckItems:()=>Object.values(db.npcWreckItems.items),
  readVerifiedLoss:()=>loss?{status:"READY",outcomes:[{
   systemID:30000144,targetID:901,status:"HAULER_NATIVE_LOSS_VERIFIED",
   haulerNativeWreckID:8001}]}:{status:"READY",outcomes:[]},
  atomicRows:atomic,clock:()=>time,
  warpToEntity:()=>{warp++;return {success:true}},
  orbit:()=>{orbit++;return {success:true}},
  readController:()=>({entityID:2002,systemID:30000144})});
 const depot=createRescueNpcDepot({
  getCargo:()=>Object.values(db.npcCargo.cargo),
  getStations:()=>[{stationID:60002,solarSystemID:30000144,
   corporationID:20002}],
  atomicRows:atomic,clock:()=>time,
  warpToPoint:()=>{warp++;return{success:true}},
  orbit:()=>{orbit++;return{success:true}},
  getMetadata:()=>({typeID:34,volume:0.01,name:"Tritanium"})});
 const player=createNativeRescueTransfer({
  atomicRows:atomic,readWreck:()=>wreck,
  getMetadata:()=>({typeID:34,volume:0.01,name:"Tritanium"}),
  refreshWreck:()=>({success:true})});
 try{fn({rivalry,depot,player,candidates,scene,
  db:()=>db,clock:t=>time=t,move:x=>shipAt=x,
  loss:x=>loss=x,setRollback:x=>rollback=x,
  calls:()=>({warp,orbit})})}finally{}
}
test("no NPC rival action from merely an unverified wreck",()=>fixture(f=>{
 f.loss(false);
 assert.deepEqual(f.rivalry.tick({scene:f.scene,candidates:f.candidates}).orders,[]);
 assert.equal(Object.keys(f.db().npcCargo.cargo).length,0);
}));
test("real NPC rival must physically approach the original same wreck",()=>fixture(f=>{
 f.move(300000);
 assert.equal(f.rivalry.tick({scene:f.scene,candidates:f.candidates})
  .orders[0]?.movement,"WARP");
 assert.equal(Object.keys(f.db().npcCargo.cargo).length,0);
}));
test("real competing NPC atomically removes the source salvage from player world",()=>fixture(f=>{
 const r=f.rivalry.tick({scene:f.scene,candidates:f.candidates});
 assert.equal(r.orders[0]?.status,"NATIVE_RIVAL_CARGO_CAPTURED");
 assert.equal(f.db().npcWreckItems.items["8201"],undefined);
 assert.equal(f.db().npcCargo.cargo["980200000100"].quantity,8);
 assert.equal(f.player.transfer({characterID:701,wreckID:8001,wreckItemID:8201,
  destinationLocationID:1701,destinationFlagID:5}).success,false);
}));
test("atomic competing NPC SQLite rollback preserves unchanged wreck source",()=>fixture(f=>{
 f.setRollback(true);
 assert.deepEqual(f.rivalry.tick({scene:f.scene,candidates:f.candidates}).orders,[]);
 assert.equal(f.db().npcWreckItems.items["8201"].quantity,8);
 assert.equal(Object.keys(f.db().npcCargo.cargo).length,0);
}));
test("real NPC rival physically delivers salvage to own station and never mints ore",()=>fixture(f=>{
 f.rivalry.tick({scene:f.scene,candidates:f.candidates});
 f.move(10000);
 assert.equal(f.depot.tick({scene:f.scene,candidates:f.candidates}).events.length,0);
 f.clock(1003000);
 const result=f.depot.tick({scene:f.scene,candidates:f.candidates});
 assert.equal(result.events[0]?.status,"NATIVE_RIVAL_CORP_STOCK_COMMITTED");
 assert.equal(f.db().npcCargo.cargo["980200000100"],undefined);
 assert.equal(f.db().items["9000"].quantity,8);
 assert.equal(f.db().items["9000"].ownerID,20002);
 assert.equal(f.db().items["9000"].locationID,60002);
}));
process.on("exit",()=>{for(const [k,v] of Object.entries(old)){
 if(v===undefined)delete process.env[k];else process.env[k]=v
}});
