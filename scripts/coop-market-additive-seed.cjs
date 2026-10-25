"use strict";
// Offline, opt-in ADDITIVE import of an independently seeded EveJS solar system.
// Never replaces market.sqlite, player orders, escrow, prices, or history.
// No live Docker invocation. Operator must stop server + market and hold flock.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const DEFAULT_SYSTEM=30100032; // AIR starter hub Manifest, per SDE
const TABLES=["manifest","regions","solar_systems","stations","market_types","seed_stock","seed_buy_orders","region_summaries","system_seed_summaries","market_orders","price_history"];
const positive=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):null;
const safePath=(file,label)=>{if(!file||!path.isAbsolute(file)||!fs.existsSync(file)||!fs.statSync(file).isFile())throw Error(label+" must be an existing absolute SQLite file");return path.resolve(file)};
function checksum(file){const h=crypto.createHash("sha256"),fd=fs.openSync(file,"r");try{const b=Buffer.alloc(1024*1024);let n=0;while((n=fs.readSync(fd,b,0,b.length,null))>0)h.update(b.subarray(0,n));return h.digest("hex");}finally{fs.closeSync(fd)}}
function scalar(db,sql,...args){const row=db.prepare(sql).get(...args);return Number(row?.n||0)}
function validateSchema(db,label){
 const available=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
 const missing=TABLES.filter(t=>!available.has(t));if(missing.length)throw Error(label+" missing tables: "+missing.join(","));
 const good=db.pragma("quick_check",{simple:true});if(good!=="ok")throw Error(label+" SQLite quick_check failed");
}
function inspect(target,candidate,{systemID=DEFAULT_SYSTEM}={}){
 systemID=positive(systemID);if(!systemID)throw Error("Invalid target system ID");
 validateSchema(target,"target");validateSchema(candidate,"candidate");
 const manifest=db=>JSON.parse(db.prepare("SELECT value FROM manifest WHERE key='manifest_json'").get()?.value||"null");
 const destMeta=manifest(target),sourceMeta=manifest(candidate);
 if(!destMeta||!sourceMeta||destMeta.schema_version!==sourceMeta.schema_version||
    destMeta.static_data_dir!==sourceMeta.static_data_dir)throw Error("Market SDE/schema mismatch");
 if(JSON.stringify(sourceMeta.selected_solar_system_ids)!==JSON.stringify([systemID]))
  throw Error("Candidate must be seeded for precisely the requested solar system");
 const row=candidate.prepare("SELECT region_id,solar_system_name AS name FROM solar_systems WHERE solar_system_id=?").get(systemID);
 if(!row||!positive(row.region_id))throw Error("Candidate lacks authoritative solar system and region");
 const regionID=Number(row.region_id);
 const scope={stations:scalar(candidate,"SELECT COUNT(*) AS n FROM stations WHERE solar_system_id=?",systemID),
  sellRows:scalar(candidate,"SELECT COUNT(*) AS n FROM seed_stock WHERE solar_system_id=? AND quantity>0",systemID),
  buyRows:scalar(candidate,"SELECT COUNT(*) AS n FROM seed_buy_orders WHERE solar_system_id=? AND quantity>0",systemID)};
 if(!scope.stations||!scope.sellRows)throw Error("Candidate has no local station or buyable stock");
 const badStock=scalar(candidate,"SELECT COUNT(*) AS n FROM seed_stock WHERE solar_system_id=? AND (price<=0 OR quantity<0)",systemID);
 if(badStock)throw Error("Candidate contains invalid sell prices or quantities");
 const existing={regionStock:scalar(target,"SELECT COUNT(*) AS n FROM seed_stock WHERE region_id=?",regionID),
  regionOrders:scalar(target,"SELECT COUNT(*) AS n FROM market_orders WHERE region_id=?",regionID),
  regionSummaries:scalar(target,"SELECT COUNT(*) AS n FROM region_summaries WHERE region_id=?",regionID),
  regionBuyStock:scalar(target,"SELECT COUNT(*) AS n FROM seed_buy_orders WHERE region_id=?",regionID),
  systemSummaries:scalar(target,"SELECT COUNT(*) AS n FROM system_seed_summaries WHERE solar_system_id=?",systemID),
  scopeStock:scalar(target,"SELECT COUNT(*) AS n FROM seed_stock WHERE solar_system_id=?",systemID)};
 // Do not merge overlapping regions: Rust cache summary rows include ALL orders.
 // Existing seed buy liquidity or the system cache alone also mean occupied.
 // This intentionally guards player market state instead of rewriting it.
 if(Object.values(existing).some(Boolean))throw Error("OVERLAPPING_MARKET_REGION: do not modify existing stock/orders/summaries");
 const candidateTables=TABLES.filter(t=>!["manifest","market_orders","price_history"].includes(t));
 for(const table of candidateTables){
  const cols=db=>db.prepare(`PRAGMA table_info("${table}")`).all().map(x=>x.name).join(",");
  if(cols(target)!==cols(candidate))throw Error("Market table schema drift: "+table);
 }
 return {status:"ADDITIVE_IMPORT_ELIGIBLE",systemID,regionID,systemName:row.name,scope,
  candidateSha256:checksum(candidate.name),existing,
  warning:"No changes made. Apply requires offline flock, immutable backup and explicit approval."};
}
const COPY=[
 ["regions","region_id","regionID"],
 ["solar_systems","solar_system_id","systemID"],
 ["stations","solar_system_id","systemID"],
 ["market_types","type_id","types"],
 ["seed_stock","solar_system_id","systemID"],
 ["seed_buy_orders","solar_system_id","systemID"],
 ["region_summaries","region_id","regionID"],
 ["system_seed_summaries","solar_system_id","systemID"]
];
function copyStatements(){return COPY.map(([table,column,scope])=>({table,sql:
 scope==="types"?
 `INSERT OR IGNORE INTO main.market_types SELECT * FROM addon.market_types WHERE type_id IN (SELECT type_id FROM addon.seed_stock WHERE solar_system_id=? UNION SELECT type_id FROM addon.seed_buy_orders WHERE solar_system_id=?)`:
 `INSERT OR IGNORE INTO main.${table} SELECT * FROM addon.${table} WHERE ${column}=?`,scope}));}
async function run({market,candidate,systemID=DEFAULT_SYSTEM,apply=false,confirm="",backupDir="",Database}={}){
 const mainPath=safePath(market,"Market"),srcPath=safePath(candidate,"Candidate");
 // Symlinks and alternate lexical names must not point at the same SQLite file.
 if(fs.realpathSync(mainPath)===fs.realpathSync(srcPath))
  throw Error("Candidate must be a separate database");
 const DB=Database||require("/app/server/node_modules/better-sqlite3");
 const main=new DB(mainPath,{readonly:true,fileMustExist:true}),donor=new DB(srcPath,{readonly:true,fileMustExist:true});
 let plan;try{main.pragma("query_only = ON");donor.pragma("query_only = ON");plan=inspect(main,donor,{systemID});}finally{main.close();donor.close();}
 if(!apply)return plan;
 if(confirm!=="IMPORT_MANIFEST_WITH_BACKUP"||process.env.EVEJS_COOP_MARKET_OFFLINE_LOCK_HELD!=="1")
  throw Error("Refusing apply without operator confirmation and offline exclusive market lock");
 if(!backupDir||!path.isAbsolute(backupDir))throw Error("Absolute retained market backup directory required");
 fs.mkdirSync(backupDir,{recursive:true});
 const backup=path.join(backupDir,`coop-before-manifest-${Date.now()}-${crypto.randomBytes(5).toString("hex")}.sqlite`);
 const db=new DB(mainPath,{fileMustExist:true});
 try{
  await db.backup(backup); // SQLite consistent snapshot before changing ANY stock.
  if(!fs.existsSync(backup)||fs.statSync(backup).size<1024)throw Error("Backup was not retained");
  db.prepare("ATTACH DATABASE ? AS addon").run(srcPath);
  try{
   // Reject incompatible SDE type metadata instead of silently ignoring
   // duplicate type IDs from different build snapshots.
   const incompatible=db.prepare(`SELECT COUNT(*) AS n FROM main.market_types m
     JOIN addon.market_types a ON a.type_id=m.type_id
     WHERE a.type_id IN (SELECT type_id FROM addon.seed_stock WHERE solar_system_id=?
                       UNION SELECT type_id FROM addon.seed_buy_orders WHERE solar_system_id=?)
       AND (m.group_id<>a.group_id OR m.category_id<>a.category_id
            OR m.market_group_id<>a.market_group_id OR m.name<>a.name
            OR m.portion_size<>a.portion_size OR m.published<>a.published)`).get(plan.systemID,plan.systemID);
   if(Number(incompatible?.n||0)>0)throw Error("Native item type metadata conflicts with existing market; no import performed");
   const inserted=db.transaction(()=>{
    const info={};for(const entry of copyStatements()){
     const param=entry.scope==="regionID"?plan.regionID:plan.systemID;
     info[entry.table]=db.prepare(entry.sql).run(...(entry.scope==="types"?[param,param]:[param])).changes;
    }
    if(info.seed_stock<1)throw Error("No newly imported native sell stock");
    return info;
   })();
   return {...plan,status:"ADDITIVE_IMPORT_APPLIED_OFFLINE",backup,inserted,
    warning:"Keep market offline until pinned market-server doctor validates the DB; restart only after operator approval."};
  }finally{db.exec("DETACH DATABASE addon");}
 }finally{db.close();}
}
async function cli(argv=process.argv.slice(2)){
 const opt={};for(let i=0;i<argv.length;i++){
  const k=argv[i];if(k==="--apply"){opt.apply=true;continue;}
  if(!["--market","--candidate","--system-id","--backup-dir","--confirm"].includes(k)||!argv[i+1])throw Error("Unexpected argument: "+k);
  const dest={"--market":"market","--candidate":"candidate","--system-id":"systemID","--backup-dir":"backupDir","--confirm":"confirm"}[k];opt[dest]=argv[++i];
 }
 console.log(JSON.stringify(await run(opt),null,2));
}
if(require.main===module)cli().catch(e=>{console.error(JSON.stringify({status:"ADDITIVE_IMPORT_BLOCKED",reason:String(e.message).slice(0,240)}));process.exitCode=2;});
module.exports={inspect,run,copyStatements,DEFAULT_SYSTEM};