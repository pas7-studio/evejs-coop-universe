import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNpcSalvageDelivery}=require("../integration/coopSalvageNpcStationDelivery.cjs");
const envPrev={rivals:process.env.EVEJS_COOP_ALIFE_SALVAGE_RIVALS,
 atomic:process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS};
process.env.EVEJS_COOP_ALIFE_SALVAGE_RIVALS="1";
process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS="1";
const manifestKey="30000144-77-1000000",systemID=30000144;
const stock={cargoID:2001,entityID:801,ownerID:10001,flagID:5,
 typeID:34,itemName:"Recovered Ore",quantity:5,singleton:false,
 sourceWreckItemID:9001,sourceWreckID:8001,sourceCargoID:5501,
 salvageManifestKey:manifestKey};
const receipt={v:1,state:"NPC_CARGO",wreckID:8001,
 manifestKey,sourceCargoID:5501,wreckItemID:9001,
 npcCargoID:2001,entityID:801,corporationID:10001};
function fixture(fn){
 let db={npcCargo:{cargo:{"2001":structuredClone(stock)}},
  corporationRuntime:{coopSalvageRivalMoves:{version:1,moves:{"9001":structuredClone(receipt)}}},
  identityState:{nextItemID:100000},items:{}};
 let beforeTransaction=null,commits=0,now=1000000,hasEnemy=false;
 const scene={systemID,staticEntities:[{kind:"station",itemID:60001,
  position:{x:100,y:0,z:0}}],
  getEntityByID:id=>id===801?{kind:"ship",nativeNpc:true,itemID:801,
   position:{x:0,y:0,z:0}}:null};
 const atomic={transact:(tables,work)=>{
  if(beforeTransaction){const hook=beforeTransaction;beforeTransaction=null;hook(db)}
  const copy=structuredClone(db);
  const tx={get:(t,k)=>copy[t]?.[k]??null,
   scan:t=>Object.entries(copy[t]||{}).map(([key,value])=>({key,value})),
   put:(t,k,value)=>{copy[t][k]=value}};
  const outcome=work(tx);db=copy;commits++;return outcome;
 }};
 const make=({build=spec=>spec,readItems=()=>Object.values(db.items)}={})=>createNpcSalvageDelivery({
  atomic,readNativeCargo:()=>Object.values(db.npcCargo.cargo),
  readRivalJournal:()=>db.corporationRuntime.coopSalvageRivalMoves,
  readNativeItems:readItems,
  readNativeEntity:()=>({entityID:801,systemID,corporationID:10001,ownerID:10001}),
  getController:()=>({entityID:801,systemID,currentTargetID:hasEnemy?777:0}),
  getStation:id=>id===60001?{solarSystemID:systemID}:null,
  buildInventoryItem:build,warp:()=>({success:true}),
  orbit:()=>({success:true}),clock:()=>now
 });
 const args={scene,assignments:[{pilotID:"coop-pilot-001",entityID:801,systemID}],
  blockedIDs:new Set()};
 fn({make,args,db:()=>structuredClone(db),
  mutateDuringTransaction:hook=>beforeTransaction=hook,
  commits:()=>commits,setEnemy:x=>hasEnemy=x,
  setTime:x=>now=x});
}
test("original NPC salvage is deposited as one native station item and journal receipt",()=>fixture(f=>{
 const result=f.make().tick(f.args);
 assert.equal(result.status,"READY");
 assert.equal(result.deliveries.length,1);
 assert.equal(result.deliveries[0].status,"ALIFE_SALVAGE_RIVAL_STOCK_CONFIRMED");
 assert.equal(f.db().npcCargo.cargo["2001"],undefined);
 const item=f.db().items["100000"];
 assert.equal(item.itemID,100000);
 assert.equal(item.ownerID,10001);
 assert.equal(item.locationID,60001);
 assert.equal(item.flagID,4);
 assert.equal(item.quantity,5);
 assert.equal(item.stacksize,5);
 assert.equal(item.singleton,0);
 assert.equal(f.db().corporationRuntime.coopSalvageRivalMoves.moves["9001"].state,
  "NPC_STOCK_DELIVERED");
 assert.equal(f.commits(),1);
}));
test("after NPC salvage delivery same original item cannot be minted twice",()=>fixture(f=>{
 f.make().tick(f.args);
 f.setTime(1070000);
 const replay=f.make().tick(f.args);
 assert.equal(replay.deliveries.length,0);
 assert.equal(f.commits(),1);
 assert.equal(Object.keys(f.db().items).length,1);
}));
test("a committed move with stale itemStore reports reconciliation, not false delivery",()=>fixture(f=>{
 const result=f.make({readItems:()=>[]}).tick(f.args);
 assert.equal(result.deliveries.length,1);
 assert.equal(result.deliveries[0].status,
  "ALIFE_SALVAGE_RIVAL_COMMITTED_NEEDS_RECONCILIATION");
 assert.equal(f.commits(),1);
 assert.equal(f.db().npcCargo.cargo["2001"],undefined);
 assert.equal(f.db().items["100000"].ownerID,10001);
}));
test("changed cargo owner after preflight aborts atomic station move",()=>fixture(f=>{
 f.mutateDuringTransaction(db=>{db.npcCargo.cargo["2001"].ownerID=20002});
 assert.equal(f.make().tick(f.args).deliveries.length,0);
 assert.equal(f.db().items["100000"],undefined);
 assert.equal(f.db().npcCargo.cargo["2001"].ownerID,20002);
 assert.equal(f.commits(),0);
}));
test("changed wreck origin after preflight aborts atomic station move",()=>fixture(f=>{
 f.mutateDuringTransaction(db=>{db.npcCargo.cargo["2001"].sourceWreckID=7001});
 assert.equal(f.make().tick(f.args).deliveries.length,0);
 assert.equal(f.db().items["100000"],undefined);
 assert.equal(f.commits(),0);
}));
test("changed native source manifest after preflight blocks stock creation",()=>fixture(f=>{
 f.mutateDuringTransaction(db=>{db.npcCargo.cargo["2001"].salvageManifestKey="30000144-77-999999"});
 assert.equal(f.make().tick(f.args).deliveries.length,0);
 assert.equal(f.commits(),0);
}));
test("changed durable rival receipt after preflight aborts native delivery",()=>fixture(f=>{
 f.mutateDuringTransaction(db=>{
  db.corporationRuntime.coopSalvageRivalMoves.moves["9001"].wreckID=90000});
 assert.equal(f.make().tick(f.args).deliveries.length,0);
 assert.equal(f.commits(),0);
}));
test("missing native item ID allocator cannot be silently replaced with guessed ID",()=>fixture(f=>{
 f.mutateDuringTransaction(db=>{delete db.identityState.nextItemID});
 assert.equal(f.make().tick(f.args).deliveries.length,0);
 assert.equal(Object.keys(f.db().items).length,0);
 assert.equal(f.commits(),0);
}));
test("malformed inventory item build cannot become NPC warehouse stock",()=>fixture(f=>{
 const fake=f.make({build:spec=>({...spec,flagID:5})});
 assert.equal(fake.tick(f.args).deliveries.length,0);
 assert.equal(Object.keys(f.db().items).length,0);
 assert.equal(f.commits(),0);
}));
test("combat NPC never abandons target for a station transfer",()=>fixture(f=>{
 f.setEnemy(true);
 assert.equal(f.make().tick(f.args).deliveries.length,0);
 assert.equal(f.commits(),0);
}));
test("native rival station delivery remains opt-in",()=>fixture(f=>{
 process.env.EVEJS_COOP_ALIFE_SALVAGE_RIVALS="0";
 try{
  assert.equal(f.make().tick(f.args).status,"DISABLED");
  assert.equal(f.commits(),0);
 }finally{process.env.EVEJS_COOP_ALIFE_SALVAGE_RIVALS="1"}
}));
process.on("exit",()=>{
 for(const [name,key] of [["rivals","EVEJS_COOP_ALIFE_SALVAGE_RIVALS"],
  ["atomic","EVEJS_COOP_NATIVE_ATOMIC_ROWS"]]){
  if(envPrev[name]===undefined)delete process.env[key];
  else process.env[key]=envPrev[name];
 }
});
