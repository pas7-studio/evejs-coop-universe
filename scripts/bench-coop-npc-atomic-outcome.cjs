#!/usr/bin/env node
"use strict";
/**
 * Manual isolated POSIX + node:sqlite NPC bank benchmark.
 * Creates its OWN throwaway native-shaped SQLite and ammo receipt directory.
 * Never opens EveJS data, Docker volumes or a supplied database.
 * This is NOT client gameplay, nor the production GameStore adapter.
 */
const fs=require("node:fs");
const path=require("node:path");
const os=require("node:os");
const {DatabaseSync}=require("node:sqlite");
const {createAtomicAmmoBank}=require("../integration/coopNpcAmmoBankAtomic.cjs");
const {createFireOutcomeWitness}=require("../integration/coopNpcFireOutcomeWitness.cjs");
const SEP="\u001f";
const positiveOption=(name,defaultValue,min,max)=>{
 const opt=process.argv.find(v=>v.startsWith("--"+name+"="));
 const val=opt?Number(opt.split("=")[1]):defaultValue;
 if(!Number.isSafeInteger(val)||val<min||val>max)
  throw Error("INVALID_BENCH_OPTION_"+name);
 return val;
};
const percentile=(sorted,p)=>sorted[Math.min(sorted.length-1,Math.ceil(p*sorted.length)-1)];
function run(){
 if(process.platform!=="linux")throw Error("POSIX_LINUX_WSL2_REQUIRED");
 const major=Number(process.versions.node.split(".")[0]);
 if(major<22)throw Error("NODE_22_REQUIRED");
 if(process.argv.some(x=>!/^--(iterations|warmup|barrels|max-p95-ms)=\d+$/.test(x)))
  throw Error("UNKNOWN_BENCH_OPTION");
 const iterations=positiveOption("iterations",100,5,10000),
  warmup=positiveOption("warmup",5,0,1000),
  barrels=positiveOption("barrels",2,1,16),
  maxP95=positiveOption("max-p95-ms",0,0,10000);
 const total=iterations+warmup;
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),"coop-npc-bank-bench-"));
 const root=path.join(folder,"journal"),sqlitePath=path.join(folder,"scratch.sqlite");
 fs.mkdirSync(root,{mode:0o700});
 let db=null;
 const prev=process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS;
 process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS="1";
 try{
  db=new DatabaseSync(sqlitePath);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
  for(const t of ["npcEntities","npcModules","npcCargo"])
   db.exec('CREATE TABLE "'+t+'"(key TEXT PRIMARY KEY,json TEXT NOT NULL)');
  const ins=(t,k,v)=>db.prepare('INSERT INTO "'+t+'"(key,json) VALUES(?,?)')
   .run(k,JSON.stringify(v));
  ins("npcEntities","entities"+SEP+"101",{entityID:101,ownerID:900,systemID:30000144});
  const chargeTypeID=35,moduleTypeID=123;
  const cargo={};
  for(let b=0;b<barrels;b++){
   const moduleID=401+b,cargoID=501+b,flagID=27+b;
   ins("npcModules","modules"+SEP+moduleID,{moduleID,entityID:101,
    ownerID:900,typeID:moduleTypeID,categoryID:7,flagID});
   cargo[cargoID]={cargoID,entityID:101,moduleID,ownerID:900,
    typeID:chargeTypeID,categoryID:8,quantity:total+2};
  }
  ins("npcCargo","cargo",cargo);
  const read=(t,k)=>{
   const row=db.prepare('SELECT json FROM "'+t+'" WHERE key=?').get(k);
   return row?JSON.parse(row.json):null;
  };
  const adapter={transact(tables,callback){
   db.exec("BEGIN IMMEDIATE");
   try{
    const tx={get(t,k){if(!tables.includes(t))throw Error("BAD_TABLE");return read(t,k);},
     put(t,k,v){
      if(!tables.includes(t))throw Error("BAD_TABLE");
      db.prepare('INSERT INTO "'+t+'"(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json')
       .run(k,JSON.stringify(v));
     }};
    const value=callback(tx);
    db.exec("COMMIT");
    return value;
   }catch(e){try{db.exec("ROLLBACK");}catch(_){}throw e;}
  }};
  const ship={kind:"ship",nativeNpc:true,itemID:101,ownerID:900,
   nativeCargoItems:Object.values(cargo).map(v=>({...v,itemID:v.cargoID,stacksize:v.quantity}))};
  const store={listNativeCargoForEntity:(id)=>{
   return Object.values(read("npcCargo","cargo")||{}).filter(v=>v.entityID===id);
  }};
  const bank=createAtomicAmmoBank({root,atomicRows:adapter,store,compatible:()=>true});
  const witness=createFireOutcomeWitness({root});
  const debits=[],witnesses=[],totalDurations=[];
  for(let i=0;i<total;i++){
   const whenMs=1000+i*1000;
   const items=store.listNativeCargoForEntity(101);
   const entries=items.map(v=>({
    moduleItem:{itemID:v.moduleID,typeID:moduleTypeID,flagID:27+v.moduleID-401},
    chargeItem:{itemID:v.cargoID,typeID:chargeTypeID,quantity:v.quantity}
   }));
   if(entries.length!==barrels)throw Error("BENCH_BARRELS_MISSING");
   const begin=process.hrtime.bigint();
   const used=bank.consume({entity:ship,entries,whenMs});
   const afterDebit=process.hrtime.bigint();
   if(!used.success)throw Error("BENCH_DEBIT_FAILED:"+used.errorMsg);
   const outcome=witness.record({entity:ship,whenMs,kind:"TURRET_RESOLVED",hit:false});
   const complete=process.hrtime.bigint();
   if(!outcome.ok)throw Error("BENCH_WITNESS_FAILED:"+outcome.status);
   if(i>=warmup){
    debits.push(Number(afterDebit-begin)/1e6);
    witnesses.push(Number(complete-afterDebit)/1e6);
    totalDurations.push(Number(complete-begin)/1e6);
   }
  }
  const final=read("npcCargo","cargo");
  for(const item of Object.values(final)){
   if(item.quantity!==2)throw Error("BENCH_NATIVE_AMMO_BALANCE_MISMATCH");
  }
  const summarize=values=>{
   const s=[...values].sort((a,b)=>a-b);
   const rounded=n=>Math.round(n*1000)/1000;
   return {p50:rounded(percentile(s,.5)),p95:rounded(percentile(s,.95)),
    p99:rounded(percentile(s,.99)),max:rounded(s[s.length-1])};
  };
  const report={status:"ISOLATED_BENCHMARK_ONLY",node:process.versions.node,
   platform:process.platform,barrels,iterations,warmup,
   debitMs:summarize(debits),outcomeMs:summarize(witnesses),
   entireCycleMs:summarize(totalDurations),
   roundsPerSecond:Math.round(iterations/
    (totalDurations.reduce((a,b)=>a+b,0)/1000)*100)/100,
   sqlite:"WAL, synchronous=FULL",localTempOnly:true,
   doesNotMeasure:["real GameStore cache or flush","NPC AI","client-visible damage","scene projectile delivery"]};
  process.stdout.write(JSON.stringify(report,null,2)+"\n");
  if(maxP95>0&&report.entireCycleMs.p95>maxP95)process.exitCode=2;
 }finally{
  if(prev===undefined)delete process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS;
  else process.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS=prev;
  if(db)db.close();
  fs.rmSync(folder,{recursive:true,force:true});
 }
}
try{run()}catch(e){process.stderr.write("NPC_BANK_BENCH_FAILED:"+e.message+"\n");process.exitCode=2;}
