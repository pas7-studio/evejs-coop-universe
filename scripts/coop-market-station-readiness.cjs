"use strict";
// Read-only exact-station readiness gate for the REAL native EveJS market.
// Stock elsewhere in a solar system or flat client catalog does NOT imply a buyable station.
const fs=require("node:fs");
const DB_FILE="/var/lib/evejs/market/market.sqlite";
const MANIFEST_SYSTEM=30100032;
const validID=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):null;
const SCHEMA=["stations","market_types","seed_stock","market_orders"];
const safeCount=v=>Number.isSafeInteger(Number(v))&&Number(v)>=0?Number(v):0;
function inspect(db,{systemID=MANIFEST_SYSTEM,stationID=null}={}){
 const system=validID(systemID),station=stationID==null?null:validID(stationID);
 if(!system||(stationID!==null&&!station))throw Error("Positive system and station IDs required");
 const existing=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
 const missing=SCHEMA.filter(x=>!existing.has(x));
 if(missing.length)return {status:"MARKET_SCHEMA_INCOMPLETE",systemID:system,missing};
 const stations=db.prepare("SELECT station_id AS stationID,station_name AS station,solar_system_id AS systemID FROM stations WHERE solar_system_id=? ORDER BY station_id").all(system);
 if(!Array.isArray(stations)||stations.some(x=>!validID(x.stationID)||Number(x.systemID)!==system))
  return {status:"MARKET_STATION_AUTHORITY_INVALID",systemID:system};
 const results=[];
 for(const row of stations){
  const id=Number(row.stationID);
  const seeded=db.prepare("SELECT COUNT(*) AS n,COALESCE(SUM(k.quantity),0) AS units FROM seed_stock k JOIN market_types t ON t.type_id=k.type_id WHERE k.station_id=? AND k.quantity>0 AND k.price>0 AND t.published=1 AND t.market_group_id>0").get(id)||{};
  const orders=db.prepare("SELECT COUNT(*) AS n FROM market_orders o JOIN market_types t ON t.type_id=o.type_id WHERE o.station_id=? AND o.state='open' AND o.bid=0 AND o.vol_remaining>0 AND o.price>0 AND t.published=1 AND t.market_group_id>0").get(id)||{};
  results.push({stationID:id,station:String(row.station||""),systemID:system,
   seededSellTypes:safeCount(seeded.n),seededSellUnits:safeCount(seeded.units),
   openPlayerSellOrders:safeCount(orders.n),
   status:safeCount(seeded.n)+safeCount(orders.n)>0?"LOCAL_NATIVE_SELL_LIQUIDITY":"NO_LOCAL_SELL_LIQUIDITY"});
 }
 if(!results.length)return {status:"SYSTEM_NOT_SEEDED",systemID:system,stations:[]};
 if(!station)return {status:"STATION_SELECTION_REQUIRED",systemID:system,stations:results,
  reason:"Select the exact station from the client; stock in another station does not count."};
 const selected=results.find(x=>x.stationID===station);
 if(!selected)return {status:"STATION_NOT_IN_SYSTEM",systemID:system,stationID:station,stations:results};
 if(selected.status!=="LOCAL_NATIVE_SELL_LIQUIDITY")
  return {status:"NO_BUYABLE_STOCK_AT_SELECTED_STATION",systemID:system,stationID:station,station:selected.station,stations:results};
 const seeds=db.prepare("SELECT k.type_id AS typeID,t.name AS item,t.market_group_id AS marketGroupID,k.quantity AS quantity,k.price AS price FROM seed_stock k JOIN market_types t ON t.type_id=k.type_id WHERE k.station_id=? AND k.quantity>0 AND k.price>0 AND t.published=1 AND t.market_group_id>0 ORDER BY k.price ASC,k.type_id ASC LIMIT 8").all(station);
 const playerSell=db.prepare("SELECT o.type_id AS typeID,t.name AS item,t.market_group_id AS marketGroupID,o.vol_remaining AS quantity,o.price AS price FROM market_orders o JOIN market_types t ON t.type_id=o.type_id WHERE o.station_id=? AND o.state='open' AND o.bid=0 AND o.vol_remaining>0 AND o.price>0 AND t.published=1 AND t.market_group_id>0 ORDER BY o.price ASC,o.order_id ASC LIMIT 8").all(station);
 const valid=row=>validID(row.typeID)&&validID(row.marketGroupID)&&
  Number.isFinite(Number(row.price))&&Number(row.price)>0&&validID(row.quantity);
 const examples=[...seeds.filter(valid).map(x=>({...x,source:"NATIVE_SEED"})),
  ...playerSell.filter(valid).map(x=>({...x,source:"PLAYER_SELL_ORDER"}))]
  .sort((a,b)=>Number(a.price)-Number(b.price)).slice(0,8);
 if(!examples.length)return {status:"MARKET_EXAMPLES_NOT_EVIDENCED",systemID:system,stationID:station,
  reason:"Summary lists stock but read-only detail query returned no identifiable purchasable types."};
 return {status:"STATION_NATIVE_STOCK_EVIDENCED_NOT_CLIENT_PROVEN",systemID:system,
  stationID:station,station:selected.station,seededSellTypes:selected.seededSellTypes,
  seededSellUnits:selected.seededSellUnits,openPlayerSellOrders:selected.openPlayerSellOrders,
  examples,source:"LIVE_NATIVE_MARKET_SQLITE_READ_ONLY",
  warning:"This is NOT a successful client buy. Verify visible catalog, native ISK debit, received hangar item, stock decrement and reconnect."};
}
function run({file=DB_FILE,systemID=MANIFEST_SYSTEM,stationID=null,Database}={}){
 if(!fs.existsSync(file)||fs.statSync(file).size<1)
  return {status:"MISSING_NATIVE_MARKET_DB",file};
 const DB=Database||require("/app/server/node_modules/better-sqlite3");
 const db=new DB(file,{readonly:true,fileMustExist:true});
 try{db.pragma("query_only = ON");return inspect(db,{systemID,stationID});}
 finally{db.close()}
}
if(require.main===module){
 try{
  const argv=process.argv.slice(2);
  if(argv.length>2||argv.some(x=>!validID(x)))
   throw Error("Usage: node coop-market-station-readiness.cjs [systemID [stationID]]");
  const result=run({systemID:argv[0]?Number(argv[0]):MANIFEST_SYSTEM,
   stationID:argv[1]?Number(argv[1]):null});
  console.log(JSON.stringify(result,null,2));
  if(!["STATION_SELECTION_REQUIRED","STATION_NATIVE_STOCK_EVIDENCED_NOT_CLIENT_PROVEN"].includes(result.status))
   process.exitCode=2;
 }catch(error){console.error(JSON.stringify({status:"NATIVE_MARKET_READINESS_BLOCKED",reason:String(error.message).slice(0,220)}));process.exitCode=2}
}
module.exports={inspect,run,DB_FILE,MANIFEST_SYSTEM};
