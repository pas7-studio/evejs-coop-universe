import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {inspect,MANIFEST_SYSTEM}=require("../scripts/coop-market-station-readiness.cjs");
const manifest=30100032,stationA=60000011,stationB=60000012;
function fake({seedA=0,seedB=0,ordersA=0,published=true,
 stationRows=[{stationID:stationA,station:"Manifest V - AIR",systemID:manifest},
  {stationID:stationB,station:"Manifest VI",systemID:manifest}],schema=true}={}){
 const queries=[];
 const sql={
  prepare(query){queries.push(query);return {
   all(...args){
    if(query.includes("sqlite_master"))return (schema?
     ["stations","market_types","seed_stock","market_orders"]:["stations"]).map(name=>({name}));
    if(query.includes("FROM stations WHERE solar_system_id="))return stationRows;
    if(query.includes("FROM seed_stock k JOIN market_types t")&&query.includes("LIMIT 8"))
     return args[0]===stationA&&seedA&&published?
      [{typeID:34,item:"Tritanium",marketGroupID:1857,quantity:seedA,price:6}]:
      args[0]===stationB&&seedB&&published?
       [{typeID:35,item:"Pyerite",marketGroupID:1857,quantity:seedB,price:10}]:[];
    if(query.includes("FROM market_orders o JOIN market_types t")&&query.includes("LIMIT 8"))
     return args[0]===stationA&&ordersA?
      [{typeID:36,item:"Mexallon",marketGroupID:1857,quantity:2,price:8}]:[];
    throw Error("Unexpected SQL all "+query);
   },
   get(id){
    if(query.includes("FROM seed_stock k JOIN market_types t"))
     return {n:published?(id===stationA?(seedA>0?1:0):(seedB>0?1:0)):0,
      units:published?(id===stationA?seedA:seedB):0};
    if(query.includes("FROM market_orders o JOIN market_types t"))
     return {n:id===stationA?ordersA:0};
    throw Error("Unexpected SQL get "+query);
   }
  }}
 };
 return {db:sql,queries};
}
test("P0 no station chosen cannot claim client purchase even if system has stock",()=>{
 const out=inspect(fake({seedB:100}).db,{systemID:manifest});
 assert.equal(out.status,"STATION_SELECTION_REQUIRED");
 assert.equal(out.stations.length,2);
 assert.equal(out.stations[0].status,"NO_LOCAL_SELL_LIQUIDITY");
 assert.equal(out.stations[1].status,"LOCAL_NATIVE_SELL_LIQUIDITY");
});
test("P0 populated OTHER station never makes player's current station buyable",()=>{
 const out=inspect(fake({seedB:100}).db,{systemID:manifest,stationID:stationA});
 assert.equal(out.status,"NO_BUYABLE_STOCK_AT_SELECTED_STATION");
 assert.equal(out.stationID,stationA);
});
test("P0 exact same station authentic published catalog type is a CANDIDATE, not a verified buy",()=>{
 const out=inspect(fake({seedA:100,seedB:50}).db,{systemID:manifest,stationID:stationA});
 assert.equal(out.status,"STATION_NATIVE_STOCK_EVIDENCED_NOT_CLIENT_PROVEN");
 assert.equal(out.examples.length,1);
 assert.equal(out.examples[0].typeID,34);
 assert.equal(out.examples[0].marketGroupID,1857);
 assert.equal(out.examples[0].source,"NATIVE_SEED");
 assert.match(out.warning,/NOT a successful client buy/);
});
test("P0 native player sell orders can supply a stocked station without seed",()=>{
 const out=inspect(fake({ordersA:1}).db,{systemID:manifest,stationID:stationA});
 assert.equal(out.status,"STATION_NATIVE_STOCK_EVIDENCED_NOT_CLIENT_PROVEN");
 assert.equal(out.examples[0].source,"PLAYER_SELL_ORDER");
 assert.equal(out.seededSellUnits,0);
 assert.equal(out.openPlayerSellOrders,1);
});
test("P0 unpublished/ungrouped native market rows do not falsely count",()=>{
 const out=inspect(fake({seedA:50,published:false}).db,{systemID:manifest,stationID:stationA});
 assert.equal(out.status,"NO_BUYABLE_STOCK_AT_SELECTED_STATION");
});
test("P0 selected station must be an actual station in requested system",()=>{
 const out=inspect(fake({seedA:20}).db,{systemID:manifest,stationID:60009999});
 assert.equal(out.status,"STATION_NOT_IN_SYSTEM");
 assert.equal(out.stationID,60009999);
});
test("P0 incomplete market schema is BLOCKED, never auto-created",()=>{
 const out=inspect(fake({schema:false}).db,{systemID:manifest,stationID:stationA});
 assert.equal(out.status,"MARKET_SCHEMA_INCOMPLETE");
 assert.deepEqual(out.missing,["market_types","seed_stock","market_orders"]);
});
test("P0 invalid native station or system ID cannot reach SQL",()=>{
 const f=fake();
 assert.throws(()=>inspect(f.db,{systemID:0}),/Positive system/);
 assert.throws(()=>inspect(f.db,{stationID:-4}),/Positive system/);
 assert.equal(f.queries.length,0);
});
test("P0 market inspector SQL is strictly read-only",()=>{
 const f=fake({seedA:20});
 inspect(f.db,{systemID:MANIFEST_SYSTEM,stationID:stationA});
 assert.ok(f.queries.every(x=>/^\s*SELECT\b/.test(x)));
 assert.ok(f.queries.some(x=>x.includes("WHERE k.station_id=?")));
});
