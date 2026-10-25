import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeRescueTransfer,token}=require("../integration/coopRescueNativeTransfer.cjs");
const {createRescueWarehouse}=require("../integration/coopRescueNativeWarehouse.cjs");
const prior=Object.fromEntries(["EVEJS_COOP_RESCUE_ATOMIC","EVEJS_COOP_RESCUE_PROVENANCE",
 "EVEJS_COOP_RESCUE_WAREHOUSE","EVEJS_COOP_NATIVE_ATOMIC_ROWS"].map(k=>[k,process.env[k]]));
for(const k of Object.keys(prior))process.env[k]="1";
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(){
 let db={characters:{"701":{characterID:701,stationID:60001}},
  items:{"1701":{itemID:1701,ownerID:701,categoryID:6}},
  identityState:{nextItemID:9000},npcCargo:{cargo:{}},
  npcWreckItems:{items:{"8201":{wreckItemID:8201,wreckID:8001,
   sourceKind:"cargo",sourceCargoID:5501,sourceOriginalQuantity:8,
   typeID:34,quantity:8,singleton:false,transient:false}}}};
 let fail=false;
 const atomic=(tables,fn)=>{
  const before=copy(db);
  const tx={get:(t,k)=>db[t]?.[k]??null,put:(t,k,v)=>db[t][k]=v,
   scan:t=>Object.entries(db[t]).map(([key,value])=>({key,value}))};
  try{const r=fn(tx);if(fail)throw Error("SQLITE_ROLLBACK");return r}
  catch(e){db=before;throw e}
 };
 const pick=createNativeRescueTransfer({atomicRows:atomic,
  readWreck:()=>({wreckID:8001,systemID:30000144,sourceEntityID:901}),
  getMetadata:()=>({typeID:34,volume:0.01,name:"Tritanium"}),
  refreshWreck:()=>({success:true})});
 const station=createRescueWarehouse({atomicRows:atomic,
  isNpcCorporation:()=>true,
  readStation:()=>({stationID:60001,corporationID:10001}),
  readOriginalManifest:()=>({status:"READY",record:{
   key:"30000144-77-1000000",stationID:60001,corporationID:10001,
   cargo:[{cargoID:5501,typeID:34,quantity:8}]}})});
 const args={characterID:701,wreckID:8001,wreckItemID:8201,
  destinationLocationID:1701,destinationFlagID:5};
 const dock={session:{characterID:701,stationID:60001,shipID:1701,
  socket:{destroyed:false}},manifestKey:"30000144-77-1000000",
  stationID:60001,corporationID:10001};
 return {pick,station,args,dock,db:()=>db,setFail:x=>fail=x};
}
test("original cargo survives two partial real native pickups with conservation",()=>{
 const f=fixture();
 assert.equal(f.pick.transfer({...f.args,quantity:3}).success,true);
 assert.equal(f.pick.transfer({...f.args,quantity:5}).success,true);
 assert.equal(f.db().npcWreckItems.items["8201"],undefined);
 assert.equal(f.db().items["9000"].quantity+f.db().items["9001"].quantity,8);
 assert.equal(f.db().items["9000"].customInfo,token(8001,8201,5501));
});
test("the same vanished native wreck item is never credited again",()=>{
 const f=fixture();f.pick.transfer(f.args);
 assert.equal(f.pick.transfer(f.args).success,false);
 assert.equal(Object.keys(f.db().items).length,2);
});
test("SQLITE rollback leaves source AND destination unchanged",()=>{
 const f=fixture();f.setFail(true);
 assert.equal(f.pick.transfer(f.args).success,false);
 assert.equal(f.db().npcWreckItems.items["8201"].quantity,8);
 assert.equal(Object.keys(f.db().items).length,1);
});
test("source still in original NPC hauler blocks fake salvage",()=>{
 const f=fixture();f.db().npcCargo.cargo["5501"]={cargoID:5501,entityID:901};
 assert.equal(f.pick.transfer(f.args).success,false);
 assert.equal(Object.keys(f.db().items).length,1);
});
test("wrong ship ownership or cargo container blocks transfer",()=>{
 const f=fixture();
 assert.equal(f.pick.transfer({...f.args,destinationLocationID:9009}).success,false);
 assert.equal(f.pick.transfer({...f.args,destinationFlagID:4}).success,false);
});
test("one real itemID ownership moves to NPC corporation on actual docking",()=>{
 const f=fixture();f.pick.transfer(f.args);
 const r=f.station.deliver({...f.dock,itemID:9000});
 assert.equal(r.status,"NATIVE_RESCUE_WAREHOUSE_COMMITTED");
 assert.equal(f.db().items["9000"].ownerID,10001);
 assert.equal(f.db().items["9000"].locationID,60001);
 assert.equal(Object.keys(f.db().items).length,2);
});
test("two partial pickups both physically deliver to NPC without duplicated ore",()=>{
 const f=fixture();
 assert.equal(f.pick.transfer({...f.args,quantity:3}).success,true);
 assert.equal(f.pick.transfer({...f.args,quantity:5}).success,true);
 assert.equal(f.station.deliver({...f.dock,itemID:9000}).status,
  "NATIVE_RESCUE_WAREHOUSE_COMMITTED");
 assert.equal(f.station.deliver({...f.dock,itemID:9001}).status,
  "NATIVE_RESCUE_WAREHOUSE_COMMITTED");
 const all=[f.db().items["9000"],f.db().items["9001"]];
 assert.equal(all.reduce((n,x)=>n+x.quantity,0),8);
 assert.ok(all.every(x=>x.ownerID===10001&&x.locationID===60001));
 assert.equal(Object.keys(f.db().items).length,3);
});
test("replaying docked delivery cannot mint stock",()=>{
 const f=fixture();f.pick.transfer(f.args);
 f.station.deliver({...f.dock,itemID:9000});
 assert.notEqual(f.station.deliver({...f.dock,itemID:9000}).status,
  "NATIVE_RESCUE_WAREHOUSE_COMMITTED");
 assert.equal(Object.keys(f.db().items).length,2);
});
test("no warehouse mutation from an undocked in-space character",()=>{
 const f=fixture();f.pick.transfer(f.args);
 assert.equal(f.station.deliver({...f.dock,itemID:9000,
  session:{...f.dock.session,_space:{initialStateSent:true}}}).status,
  "RESCUE_NOT_DOCKED_AT_STATION");
 assert.equal(f.db().items["9000"].ownerID,701);
});
process.on("exit",()=>{for(const [k,v] of Object.entries(prior)){
 if(v===undefined)delete process.env[k];else process.env[k]=v
}});
