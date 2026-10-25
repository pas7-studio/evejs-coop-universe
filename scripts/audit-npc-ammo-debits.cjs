#!/usr/bin/env node
"use strict";
// READ-ONLY audit of durable native NPC ammunition journal receipts.
// No inventory access, automatic rollback, lock removal or file mutation.
const fs=require("node:fs");
const path=require("node:path");
const positive=x=>Number.isSafeInteger(Number(x))&&Number(x)>0;
function audit({root,limit=2000}={}){
 if(typeof root!=="string"||!path.isAbsolute(root)||
  !Number.isSafeInteger(limit)||limit<1||limit>20000)
  throw Error("INVALID_AMMO_AUDIT_OPTIONS");
 const base=path.join(root,"ships");
 const counts={COMMITTED:0,PREPARED_RECONCILE:0,LOCKED_RECONCILE:0,
  CORRUPT_RECONCILE:0,ORPHAN_TEMP_RECONCILE:0};
 const entries=[],warnings=[];
 let scanned=0;
 let ships=[];
 try{ships=fs.readdirSync(base,{withFileTypes:true});}
 catch(e){if(e.code==="ENOENT")return {status:"NOT_INSTALLED",counts,
  entries,warnings,scanned};throw e;}
 const ids=ships.filter(x=>x.isDirectory()&&positive(x.name))
  .sort((a,b)=>Number(a.name)-Number(b.name));
 for(const ship of ids){
  const dir=path.join(base,ship.name);
  const names=fs.readdirSync(dir).filter(n=>
   /^[0-9]+\.json(?:\.lock|\.tmp-[0-9]+-[0-9]+)?$/.test(n)).sort();
  const modules=new Map();
  for(const name of names){
   const m=/^([0-9]+)\.json(?:\.(lock|tmp-[0-9]+-[0-9]+))?$/.exec(name);
   if(!m||!positive(m[1]))continue;
   const id=Number(m[1]);
   if(!modules.has(id))modules.set(id,{receipt:false,lock:false,tmp:[]});
   const a=modules.get(id);
   if(!m[2])a.receipt=true;
   else if(m[2]==="lock")a.lock=true;
   else a.tmp.push(name);
  }
  for(const [moduleID,meta] of [...modules].sort((a,b)=>a[0]-b[0])){
   if(++scanned>limit){
    warnings.push("AUDIT_LIMIT_REACHED");
    return {status:"INCOMPLETE",counts,entries,warnings,scanned:scanned-1};
   }
   const entry={entityID:Number(ship.name),moduleID,status:null};
   let record=null;
   try{
    if(meta.receipt){
     const file=path.join(dir,String(moduleID)+".json");
     const stat=fs.statSync(file);
     if(stat.size>8192)throw Error("RECORD_TOO_LARGE");
     record=JSON.parse(fs.readFileSync(file,"utf8"));
     if(record?.version!==1||
      !["PREPARED","COMMITTED"].includes(record.phase)||
      Number(record.entityID)!==entry.entityID||
      Number(record.moduleID)!==moduleID||!positive(record.cargoID)||
      !Number.isFinite(Number(record.boundaryMs)))
      throw Error("INVALID_RECORD");
     entry.boundaryMs=record.boundaryMs;
     entry.cargoID=record.cargoID;
     entry.phase=record.phase;
     entry.beforeQuantity=record.beforeQuantity;
     entry.afterQuantity=record.afterQuantity;
    }
    if(meta.lock)entry.status="LOCKED_RECONCILE";
    else if(meta.tmp.length)entry.status="ORPHAN_TEMP_RECONCILE";
    else if(record?.phase==="PREPARED")entry.status="PREPARED_RECONCILE";
    else if(record?.phase==="COMMITTED")entry.status="COMMITTED";
    else entry.status="CORRUPT_RECONCILE";
   }catch(_){entry.status="CORRUPT_RECONCILE";}
   counts[entry.status]++;
   if(entry.status!=="COMMITTED")entries.push(entry);
  }
 }
 return {status:entries.length?"NEEDS_OPERATOR_RECONCILIATION":"CLEAN",
  counts,entries,warnings,scanned};
}
if(require.main===module){
 try{
  const result=audit({root:process.argv[2]||
   process.env.EVEJS_COOP_NPC_AMMO_DEBIT_ROOT||
   "/var/lib/evejs/coop-npc-ammo-debits"});
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
  if(!["CLEAN","NOT_INSTALLED"].includes(result.status))
   process.exitCode=2;
 }catch(e){
  process.stderr.write("READ_ONLY_AMMO_AUDIT_FAILED: "+String(e.message)+"\n");
  process.exitCode=2;
 }
}
module.exports={audit};
