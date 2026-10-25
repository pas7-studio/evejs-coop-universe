import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
const require=createRequire(import.meta.url);
const {inspect}=require("../scripts/coop-market-inspect.cjs");
function db({jita=100,perimeter=0,orders=0}={}){
 return {prepare(query){
  const statement={
   all(...p){
    if(query.includes("sqlite_master"))return ["stations","market_types","seed_stock","market_orders"].map(name=>({name}));
    if(query.includes("stockedStations"))return [{systemID:30000142,stations:2,stockedStations:jita>0?2:0,seededTypes:jita?50:0,seededUnits:jita},
      {systemID:30000144,stations:1,stockedStations:perimeter?1:0,seededTypes:perimeter?20:0,seededUnits:perimeter}];
    if(query.includes("AS sellOrders"))return [{systemID:30000142,sellOrders:orders,buyOrders:0},{systemID:30000144,sellOrders:0,buyOrders:0}];
    if(query.includes("FROM seed_stock k JOIN stations s ON s.station_id=k.station_id") && query.includes("AS item"))return jita?[{stationID:60003760,systemID:30000142,station:"Jita IV",typeID:34,item:"Tritanium",price:5.5,quantity:jita}]:[];
    if(query.includes("SELECT s.solar_system_id AS systemID, s.station_name"))return jita?[{systemID:30000142,station:"Jita IV",types:50,units:jita}]:[];
    throw Error("Unrecognized SQL: "+query);
   },
   get(){if(query.includes("SUM(quantity)"))return {n:jita+perimeter};if(query.includes("WHERE state='open'"))return {n:orders};return {count:10};}
  };return statement;}};
}
test("real stock present only in Jita diagnoses Perimeter as not locally stocked",()=>{
 const r=inspect(db(),{});assert.equal(r.status,"MARKET_STOCK_AVAILABLE");
 assert.equal(r.systems[0].status,"SELL_LIQUIDITY_PRESENT");
 assert.equal(r.systems[1].status,"NO_LOCAL_SELL_LIQUIDITY");
 assert.equal(r.globalSeedUnits,100);
 assert.equal(r.affordableSeedExamples[0].typeID,34);
});
test("entire selected geography has no live stock without inventing orders",()=>{
 const r=inspect(db({jita:0,perimeter:0}),{});
 assert.equal(r.status,"NO_SELL_LIQUIDITY");assert.equal(r.stockedStations.length,0);
});
test("existing player orders still count as real liquidity without seeded stock",()=>{
 const r=inspect(db({jita:0,perimeter:0,orders:2}),{});
 assert.equal(r.status,"MARKET_STOCK_AVAILABLE");
 assert.equal(r.globalOpenSellOrders,2);
});
test("missing native market tables fail closed",()=>{
 const mock=db();mock.prepare=q=>({all:()=>[{name:"stations"}]});
 assert.equal(inspect(mock).status,"MARKET_SCHEMA_INCOMPLETE");
});
test("host inspector is read-only and never requests rebuild or market mutations",()=>{
 const s=readFileSync(new URL("../scripts/Inspect-Coop-Market.ps1",import.meta.url),"utf8");
 assert.match(s,/exec -T server node/);
 const commands=s.split(/\r?\n/).filter(line=>/^\s*&\s+docker\s+compose\b/.test(line));
 assert.equal(commands.length,1);
 assert.doesNotMatch(commands[0],/\b(?:rebuild|up -d|down|stop|restart|AdjustSeedStock|update_file|rm -rf)\b/i);
});