"use strict";
// Manual native runtime gate: only a disposable temp GameStore; never evejs-data.
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {spawnSync,execFileSync}=require("node:child_process");
const PIN="c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f";
const owner=1000010,station=60000001,bpo=1990000110,ore=1990000120,job=970000000000000,sep="\u001f";
const tables=["items","corporationRuntime","industryBlueprintState","industryJobs","identityState"];
const check=(ok,why)=>{if(!ok)throw Error("BLOCKED_"+why)};
function codeRoot(){
 const n=process.argv.indexOf("--code-path");check(n>=0&&process.argv[n+1],"CODE_PATH_REQUIRED");
 const c=fs.realpathSync(path.resolve(process.argv[n+1]));
 check(fs.existsSync(path.join(c,"compose.yaml")),"NOT_CODE_ROOT");
 const sha=execFileSync("git",["-C",path.dirname(c),"rev-parse","HEAD"],{encoding:"utf8"}).trim();
 check(sha===PIN,"WRONG_UPSTREAM_PIN");
 check(fs.existsSync(path.join(c,"server","src","space","coopGameStoreAtomic.js")),"OVERLAY_MISSING");
 return c;
}
function assertTemp(){
 const root=process.env.EVEJS_COOP_ATOMIC_VERIFY_ROOT,data=process.env.EVEJS_GAMESTORE_DATA_DIR;
 check(!!root&&!!data,"TEMP_ENV_MISSING");
 const r=fs.realpathSync(root),d=fs.realpathSync(data);
 check(path.dirname(r)===fs.realpathSync(os.tmpdir())&&path.basename(r).startsWith("evejs-coop-atomic-"),"NOT_TEMP_ROOT");
 check(d===path.join(r,"data")&&fs.existsSync(path.join(r,".coop-verify")),"UNSAFE_DATA_PATH");
 check(process.env.EVEJS_PERSISTENCE_WORKER==="1"&&process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS==="1","FEATURE_GATE_MISSING");
}
function child(code,phase){
 assertTemp();
 const store=require(path.join(code,"server","src","gameStore"));
 const inventory=require(path.join(code,"server","src","services","inventory","itemStore"));
 const bridge=store.coopAtomicNativeRows;check(bridge&&typeof bridge.transact==="function","BRIDGE_UNAVAILABLE");
 const read=(table,local)=>store.read(table,local).data;
 if(phase==="seed"){
  tables.forEach(t=>check(store.ensureTable(t),"TABLE_"+t));
  const records={
   items:{[bpo]:{itemID:bpo,typeID:1111,categoryID:9,ownerID:owner,locationID:station,flagID:4,singleton:1,quantity:1,stacksize:1},
     [ore]:{itemID:ore,typeID:34,categoryID:4,ownerID:owner,locationID:station,flagID:4,singleton:0,quantity:10,stacksize:10}},
   corporationRuntime:{corporations:{[owner]:{corporationID:owner,wallet:{divisions:{"1000":{key:1000,balance:200,journal:[],transactions:[]}}}}}},
   industryBlueprintState:{records:{[bpo]:{itemID:bpo,typeID:1111,original:true,jobID:null}}},
   industryJobs:{jobs:{},_meta:{nextJobID:job,version:1}},
   identityState:{version:1,nextAccountID:1,nextCharacterID:140000001,nextItemID:1990000200}
  };
  for(const [table,record] of Object.entries(records))check(store.write(table,"/",record)?.success,"SEED_"+table);
  check(store.flushTablesSync(tables)?.success,"SEED_FLUSH");
  check(inventory.findItemById(ore)?.quantity===10,"SEED_INDEX");
  check(store.write("items","/"+ore+"/quantity",12)?.success,"NATIVE_STOCK_WRITE");
  const result=bridge.transact(tables,tx=>{
   const x=tx.get("items",String(ore));check(x?.quantity===12,"STOCK_DIRTY_FLUSH");
   tx.put("items",String(ore),{...x,quantity:7,stacksize:7});
   const c=tx.get("corporationRuntime","corporations"+sep+owner);
   c.wallet.divisions["1000"].balance=175;
   tx.put("corporationRuntime","corporations"+sep+owner,c);
   const b=tx.get("industryBlueprintState","records"+sep+bpo);
   tx.put("industryBlueprintState","records"+sep+bpo,{...b,jobID:job});
   tx.put("industryJobs","jobs"+sep+job,{jobID:job,ownerID:owner,blueprintID:bpo,status:1});
   const m=tx.get("industryJobs","_meta");tx.put("industryJobs","_meta",{...m,nextJobID:job+1});
   return "INSTALLED";
  });
  check(result==="INSTALLED"&&read("items","/"+ore)?.quantity===7,"CACHE_AFTER_COMMIT");
  check(inventory.findItemById(ore)?.quantity===7,"INDEX_AFTER_COMMIT");
  check(read("industryJobs","/jobs/"+job)?.status===1,"JOB_AFTER_COMMIT");
  check(store.flushTablesSync(tables)?.success,"FINAL_FLUSH");
 }else if(phase==="restart"){
  check(read("items","/"+ore)?.quantity===7,"RESTART_ITEM");
  check(inventory.findItemById(ore)?.quantity===7,"RESTART_INDEX");
  check(read("corporationRuntime","/corporations/"+owner)?.wallet?.divisions?.["1000"]?.balance===175,"RESTART_WALLET");
  check(read("industryBlueprintState","/records/"+bpo)?.jobID===job,"RESTART_BLUEPRINT");
  check(read("industryJobs","/jobs/"+job)?.status===1,"RESTART_JOB");
  check(read("industryJobs","/_meta")?.nextJobID===job+1,"RESTART_JOB_SEQUENCE");
 }else check(false,"UNKNOWN_PHASE");
 process.stdout.write(JSON.stringify({phase,status:"PASS"})+"\n");
}
function main(){
 const code=codeRoot(),phase=process.env.EVEJS_COOP_ATOMIC_VERIFY_PHASE;
 if(phase)return child(code,phase);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-coop-atomic-")),data=path.join(root,"data");
 fs.mkdirSync(data);fs.writeFileSync(path.join(root,".coop-verify"),"temporary sandbox\n");
 try{
  const env={...process.env,EVEJS_GAMESTORE_DATA_DIR:data,EVEJS_COOP_ATOMIC_VERIFY_ROOT:root,
    EVEJS_PERSISTENCE_WORKER:"1",EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1"};
  delete env.NODE_TEST_CONTEXT;delete env.NODE_TEST_WORKER_ID;
  for(const mode of ["seed","restart"]){
   const r=spawnSync(process.execPath,[__filename,"--code-path",code],{
    env:{...env,EVEJS_COOP_ATOMIC_VERIFY_PHASE:mode},encoding:"utf8",timeout:45000,maxBuffer:1024*1024
   });
   if(r.stdout)process.stdout.write(r.stdout);
   check(r.status===0,"RUNTIME_"+mode.toUpperCase()+": "+String(r.stderr||r.error?.message||"no details").slice(-1200));
  }
  process.stdout.write(JSON.stringify({status:"PASS",gate:"COOP_032D_PINNED_GAMESTORE_DISPOSABLE"})+"\n");
 }finally{fs.rmSync(root,{recursive:true,force:true})}
}
try{main()}catch(e){console.error(JSON.stringify({status:"BLOCKED",reason:e.message}));process.exitCode=1}
