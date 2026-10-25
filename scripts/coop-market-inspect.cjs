"use strict";
// Read-only inventory of actual SQLite market liquidity. Does not seed, alter
// prices, create orders, restart services or modify a named Docker volume.
const fs=require("node:fs");
const DB_DEFAULT="/var/lib/evejs/market/market.sqlite";
const DEFAULT_SYSTEMS=[30000142,30000144]; // Jita and Perimeter
const positive=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
function inspect(db,{systems=DEFAULT_SYSTEMS}={}) {
 const ids=[...new Set(systems.map(positive).filter(Boolean))].slice(0,10);
 if(!ids.length)throw Error("At least one valid solar system ID is required");
 const required=["stations","market_types","seed_stock","market_orders"];
 const available=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
 const missing=required.filter(t=>!available.has(t));
 if(missing.length)return {status:"MARKET_SCHEMA_INCOMPLETE",missing,systems:ids};
 const totals={};
 for(const table of required){totals[table]=Number(db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count)||0;}
 const holders=ids.map(()=>"?").join(",");
 const selection=db.prepare(`SELECT s.solar_system_id AS systemID, COUNT(DISTINCT s.station_id) AS stations,
  COUNT(DISTINCT CASE WHEN k.quantity > 0 THEN k.type_id END) AS seededTypes,
  COALESCE(SUM(CASE WHEN k.quantity > 0 THEN k.quantity ELSE 0 END),0) AS seededUnits,
  COUNT(DISTINCT CASE WHEN k.quantity > 0 THEN s.station_id END) AS stockedStations
  FROM stations s LEFT JOIN seed_stock k ON k.station_id=s.station_id
  WHERE s.solar_system_id IN (${holders}) GROUP BY s.solar_system_id`).all(...ids);
 const orderRows=db.prepare(`SELECT s.solar_system_id AS systemID,
  SUM(CASE WHEN o.bid=0 AND o.state='open' AND o.vol_remaining>0 THEN 1 ELSE 0 END) AS sellOrders,
  SUM(CASE WHEN o.bid=1 AND o.state='open' AND o.vol_remaining>0 THEN 1 ELSE 0 END) AS buyOrders
  FROM stations s LEFT JOIN market_orders o ON o.station_id=s.station_id
  WHERE s.solar_system_id IN (${holders}) GROUP BY s.solar_system_id`).all(...ids);
 const byID=new Map(selection.map(r=>[Number(r.systemID),r]));
 const orders=new Map(orderRows.map(r=>[Number(r.systemID),r]));
 const scopes=ids.map(id=>{
  const row=byID.get(id)||{},o=orders.get(id)||{};
  const seededUnits=Number(row.seededUnits)||0,sellOrders=Number(o.sellOrders)||0;
  return {systemID:id,stations:Number(row.stations)||0,stockedStations:Number(row.stockedStations)||0,
   seededTypes:Number(row.seededTypes)||0,seededUnits,
   sellOrders,buyOrders:Number(o.buyOrders)||0,
   status:seededUnits||sellOrders?"SELL_LIQUIDITY_PRESENT":Number(row.stations)>0?"NO_LOCAL_SELL_LIQUIDITY":"SYSTEM_NOT_SEEDED"};
 });
 const nearest=db.prepare(`SELECT s.solar_system_id AS systemID, s.station_name AS station,
  COUNT(DISTINCT k.type_id) AS types, SUM(k.quantity) AS units
  FROM seed_stock k JOIN stations s ON s.station_id=k.station_id
  WHERE k.quantity>0 GROUP BY s.station_id ORDER BY units DESC LIMIT 8`).all()
  .map(r=>({systemID:Number(r.systemID),station:r.station,types:Number(r.types),units:Number(r.units)}));
 const allEmpty=scopes.every(x=>x.status!=="SELL_LIQUIDITY_PRESENT");
 const totalSeedUnits=Number(db.prepare("SELECT COALESCE(SUM(quantity),0) AS n FROM seed_stock WHERE quantity>0").get().n)||0;
 return {status:totalSeedUnits===0?"NO_SEED_STOCK":allEmpty?"NO_LOCAL_SELL_LIQUIDITY":"MARKET_STOCK_AVAILABLE",
  source:"LIVE_SQLITE_READ_ONLY",systems:scopes,counts:totals,globalSeedUnits:totalSeedUnits,stockedStations:nearest,
  warning:"Market catalog/client routing and wallet/inventory settlement are independent checks; this report is NOT proof of a successful purchase."};
}
function run({file=DB_DEFAULT,systems=DEFAULT_SYSTEMS,Database}={}) {
 if(!fs.existsSync(file)||fs.statSync(file).size===0)return {status:"MISSING_MARKET_DB",file};
 const DB=Database||require("/app/server/node_modules/better-sqlite3");
 const db=new DB(file,{readonly:true,fileMustExist:true});
 try{db.pragma("query_only = ON");return inspect(db,{systems});}
 finally{db.close();}
}
if(require.main===module){
 try{const args=process.argv.slice(2);const sys=args[0]?String(args[0]).split(",").map(Number):DEFAULT_SYSTEMS;
  console.log(JSON.stringify(run({systems:sys}),null,2));
 }catch(error){console.error(JSON.stringify({status:"MARKET_DB_READ_ERROR",error:String(error.message).slice(0,160)}));process.exitCode=2;}
}
module.exports={inspect,run,DEFAULT_SYSTEMS};