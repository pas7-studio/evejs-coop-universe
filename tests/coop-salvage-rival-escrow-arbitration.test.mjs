import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createSalvageRivals}=require("../integration/coopSalvageNpcRivals.cjs");
const prior={rivals:process.env.EVEJS_COOP_ALIFE_SALVAGE_RIVALS,
 atomic:process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS,
 death:process.env.EVEJS_COOP_SALVAGE_NATIVE_DEATH};
process.env.EVEJS_COOP_ALIFE_SALVAGE_RIVALS="1";
process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS="1";
process.env.EVEJS_COOP_SALVAGE_NATIVE_DEATH="1";
const manifestKey="30000144-77-1000000",systemID=30000144;
const caseRow={manifestKey,wreckID:8001,haulerID:901,
 rows:[{wreckItemID:9001,cargoID:5501,sourceCargoID:5501,
  typeID:34,quantity:5}]};
function fixture(fn,{escrow=null,preflight="NOT_FOUND"}={}){
 let commits=0,beforeTransaction=null;
 let db={
  npcWreckItems:{items:{"9001":{wreckItemID:9001,wreckID:8001,
   sourceCargoID:5501,sourceKind:"cargo",typeID:34,quantity:5,
   itemName:"Ore",singleton:false,groupID:18,categoryID:4}}},
  npcCargo:{cargo:{},nextCargoID:2001},
  corporationRuntime:escrow===null?{}:{coopSalvageEscrows:escrow}
 };
 const atomic={transact:(tables,work)=>{
  if(beforeTransaction){const run=beforeTransaction;beforeTransaction=null;run(db)}
  const data=structuredClone(db);
  const tx={get:(t,k)=>data[t]?.[k]??null,put:(t,k,v)=>{data[t][k]=v},
   scan:t=>Object.entries(data[t]||{}).map(([key,value])=>({key,value}))};
  const result=work(tx);db=data;commits++;return result;
 }};
 const wreck=()=>({wreckID:8001,systemID,sourceEntityID:901,
  lootRightCorpID:10001,corporationID:10001});
 const npc=()=>({entityID:801,systemID,ownerID:10001,corporationID:10001});
 const ship={kind:"ship",nativeNpc:true,itemID:801,
  position:{x:0,y:0,z:0},capacity:100};
 const physicalWreck={kind:"wreck",nativeNpcWreck:true,itemID:8001,
  position:{x:500,y:0,z:0}};
 const scene={systemID,getEntityByID:id=>
  id===801?ship:id===8001?physicalWreck:null};
 const rival=createSalvageRivals({atomic,
  readCases:()=>[caseRow],
  // Deliberately stale preflight proves the in-transaction fence wins.
  readEscrow:()=>({status:preflight}),
  getController:id=>({entityID:id,systemID,currentTargetID:0}),
  getNativeEntity:npc,getNativeWreck:wreck,
  getNativeWreckItems:()=>Object.values(db.npcWreckItems.items),
  readCargo:()=>Object.values(db.npcCargo.cargo),
  warp:()=>({success:true}),orbit:()=>({success:true}),
  getUnitVolume:()=>1,clock:()=>1000000
 });
 const tick=()=>rival.tick({scene,
  assignments:[{pilotID:"coop-pilot-001",entityID:801,systemID}],
  roles:[{pilotID:"coop-pilot-001",role:"hauler"}],
  blockedIDs:new Set()});
 fn({tick,db:()=>structuredClone(db),commits:()=>commits,
  scheduleBeforeTransaction:run=>beforeTransaction=run});
}
const funded=(status="RESERVED")=>({version:1,byContract:{
 ["salvage-"+manifestKey]:{contractID:"salvage-"+manifestKey,status}
}});
test("NPC rival may atomically recover unreserved original stock",()=>fixture(f=>{
 const result=f.tick();
 assert.equal(result.status,"READY");
 assert.equal(result.pickups.length,1);
 assert.equal(result.pickups[0].status,"ALIFE_NATIVE_SALVAGE_PICKED");
 assert.equal(Object.keys(f.db().npcWreckItems.items).length,0);
 assert.equal(Object.keys(f.db().npcCargo.cargo).length,1);
 assert.equal(f.db().corporationRuntime.coopSalvageRivalMoves.moves["9001"].state,"NPC_CARGO");
 assert.equal(f.commits(),1);
}));
test("funded RESCUE blocks NPC pickup despite stale preflight saying unreserved",()=>fixture(f=>{
 const result=f.tick();
 assert.equal(result.status,"READY");
 assert.equal(result.pickups.length,0);
 assert.equal(f.db().npcWreckItems.items["9001"].quantity,5);
 assert.equal(Object.keys(f.db().npcCargo.cargo).length,0);
 assert.equal(f.commits(),0);
},{escrow:funded()}));
test("REFUNDED source stays fenced for manual custody reconciliation",()=>fixture(f=>{
 assert.equal(f.tick().pickups.length,0);
 assert.equal(f.db().npcWreckItems.items["9001"].quantity,5);
},{escrow:funded("REFUNDED")}));
test("corrupted escrow ledger cannot authorize NPC salvage",()=>fixture(f=>{
 assert.equal(f.tick().pickups.length,0);
 assert.equal(f.db().npcWreckItems.items["9001"].quantity,5);
},{escrow:{version:99,byContract:{}}}));
test("source cargo converted to unrelated loot after preflight cannot be picked",()=>fixture(f=>{
 f.scheduleBeforeTransaction(db=>{db.npcWreckItems.items["9001"].sourceKind="loot"});
 const result=f.tick();
 assert.equal(result.pickups.length,0);
 assert.equal(f.db().npcWreckItems.items["9001"].sourceKind,"loot");
 assert.equal(Object.keys(f.db().npcCargo.cargo).length,0);
 assert.equal(f.commits(),0);
}));
test("salvage rivals remain disabled by default feature gate",()=>fixture(f=>{
 process.env.EVEJS_COOP_ALIFE_SALVAGE_RIVALS="0";
 try{
  assert.equal(f.tick().status,"DISABLED");
  assert.equal(f.commits(),0);
 }finally{process.env.EVEJS_COOP_ALIFE_SALVAGE_RIVALS="1"}
}));
process.on("exit",()=>{
 for(const [current,envKey] of [["rivals","EVEJS_COOP_ALIFE_SALVAGE_RIVALS"],
  ["atomic","EVEJS_COOP_NATIVE_ATOMIC_ROWS"],
  ["death","EVEJS_COOP_SALVAGE_NATIVE_DEATH"]]){
  if(prior[current]===undefined)delete process.env[envKey];
  else process.env[envKey]=prior[current];
 }
});
