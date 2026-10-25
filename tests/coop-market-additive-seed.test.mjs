import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
const require=createRequire(import.meta.url);
const {inspect,copyStatements,run,DEFAULT_SYSTEM}=require("../scripts/coop-market-additive-seed.cjs");
const names=["manifest","regions","solar_systems","stations","market_types","seed_stock","seed_buy_orders","region_summaries","system_seed_summaries","market_orders","price_history"];
function fake(filename,{addon=false,overlap=false,overlapSql="",version=3,hasStock=true}={}){
 const meta={schema_version:version,static_data_dir:"/var/lib/evejs/gameStore/data",
  selected_solar_system_ids:addon?[30100032]:[30000142,30000145]};
 return {name:filename,close:()=>{},
  pragma:()=>"ok",
  prepare(sql){return {
   all(){if(sql.includes("sqlite_master"))return names.map(name=>({name}));
    if(sql.includes("table_info"))return ["id","value"].map(name=>({name}));throw Error("Unknown .all SQL "+sql);},
   get(){if(sql.includes("manifest_json"))return {value:JSON.stringify(meta)};
    if(sql.includes("solar_system_name AS name"))return addon?{region_id:10000101,name:"Manifest"}:null;
    if(sql.includes("COUNT(*) AS n")){
     if(addon&&sql.includes("stations"))return {n:3};
     if(addon&&sql.includes("price<=0"))return {n:0};
     if(addon&&sql.includes("seed_stock"))return {n:hasStock?10:0};
     if(addon&&sql.includes("seed_buy_orders"))return {n:4};
     return {n:(overlap||overlapSql&&sql.includes(overlapSql))?1:0};
    }throw Error("Unknown .get SQL "+sql);}
   };}
 };
}
test("dry-run validates a real candidate system and returns additive counts",()=>{
 const dir=mkdtempSync(join(tmpdir(),"coop-market-additive-"));
 try{const file=join(dir,"candidate.sqlite");writeFileSync(file,"candidate test file");
  const plan=inspect(fake(join(dir,"market.sqlite")),fake(file,{addon:true}));
  assert.equal(plan.status,"ADDITIVE_IMPORT_ELIGIBLE");
  assert.equal(plan.systemID,30100032);
  assert.equal(plan.scope.sellRows,10);
  assert.equal(plan.candidateSha256.length,64);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("rejects already-stocked regions and player orders, never overwrites",()=>{
 const dir=mkdtempSync(join(tmpdir(),"coop-market-additive-"));
 try{const file=join(dir,"candidate.sqlite");writeFileSync(file,"candidate");
 assert.throws(()=>inspect(fake("main",{overlap:true}),fake(file,{addon:true})),/OVERLAPPING_MARKET_REGION/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("blocks wrong system selection, mismatched SDE, missing stock",()=>{
 const dir=mkdtempSync(join(tmpdir(),"coop-market-additive-"));
 try{const file=join(dir,"candidate.sqlite");writeFileSync(file,"candidate");
 assert.throws(()=>inspect(fake("main"),fake(file,{addon:true,version:99})),/mismatch/);
 assert.throws(()=>inspect(fake("main"),fake(file,{addon:true,hasStock:false})),/no local station or buyable stock/);
 assert.throws(()=>inspect(fake("main"),fake(file,{addon:true}),{systemID:30000142}),/precisely/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("native insert plan never alters market_orders, escrow, price_history, manifest",()=>{
 const stmts=copyStatements();
 assert.deepEqual(stmts.map(x=>x.table),["regions","solar_systems","stations","market_types","seed_stock","seed_buy_orders","region_summaries","system_seed_summaries"]);
 assert.ok(stmts.every(x=>x.sql.startsWith("INSERT OR IGNORE")));
 assert.equal(DEFAULT_SYSTEM,30100032);
 assert.ok(stmts.every(x=>!x.sql.includes("UPDATE market_orders")));
});
test("apply without exclusive lock and exact approval cannot mutate market",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"coop-market-additive-"));
 try{const market=join(dir,"market.sqlite"),candidate=join(dir,"candidate.sqlite");writeFileSync(market,"market test");writeFileSync(candidate,"candidate test");
  class DB{constructor(file){return fake(file,{addon:file===candidate})}}
  await assert.rejects(run({market,candidate,Database:DB,apply:true,confirm:"WRONG",backupDir:dir}),/Refusing apply/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("rejects existing Exordium buy-order liquidity and system-level summaries",()=>{
 const dir=mkdtempSync(join(tmpdir(),"coop-market-additive-"));
 try{const file=join(dir,"candidate.sqlite");writeFileSync(file,"fixture");
  for(const overlapSql of ["seed_buy_orders WHERE region_id", "system_seed_summaries WHERE solar_system_id"]){
   assert.throws(()=>inspect(fake("main",{overlapSql}),fake(file,{addon:true})),/OVERLAPPING_MARKET_REGION/);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("same underlying market SQLite file is rejected even through a symlink",async()=>{
 const {symlinkSync}=await import("node:fs");
 const dir=mkdtempSync(join(tmpdir(),"coop-market-additive-"));
 try{const main=join(dir,"market.sqlite"),candidate=join(dir,"alias.sqlite");
  writeFileSync(main,"fixture");symlinkSync(main,candidate);
  await assert.rejects(run({market:main,candidate,Database:class {constructor(){throw Error("Must be rejected before opening DB");}}}),/separate database/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});