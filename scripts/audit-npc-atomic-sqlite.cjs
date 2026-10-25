#!/usr/bin/env node
"use strict";
/** Read-only operator attestation of native SQLite fences vs POSIX bank receipts.
 * Never changes SQLite rows, receipts, lock files or live cargo.
 */
const fs=require("node:fs");
const path=require("node:path");
const {DatabaseSync}=require("node:sqlite");
const valid=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const limit=16384;
function readFile(file){
 if(!fs.existsSync(file))return null;
 const st=fs.lstatSync(file);
 if(st.isSymbolicLink()||!st.isFile()||st.size>limit)
  throw Error("UNSAFE_BANK_RECEIPT");
 const raw=fs.readFileSync(file,"utf8");
 if(raw.length>limit)throw Error("UNSAFE_BANK_RECEIPT_SIZE");
 const v=JSON.parse(raw);
 if(v?.version!==1||!["PREPARED","COMMITTED"].includes(v.phase)||
  !valid(v.entityID)||!Number.isFinite(v.boundaryMs)||v.boundaryMs<=0||
  !Array.isArray(v.modules)||!v.modules.length||v.modules.length>16||
  v.modules.some(m=>!valid(m))||new Set(v.modules).size!==v.modules.length||
  (v.outcomeRequired!==undefined&&typeof v.outcomeRequired!=="boolean")||
  (v.outcome!==undefined&&(
   !v.outcome||v.outcome.version!==1||
   !["TURRET_RESOLVED","MISSILE_LAUNCHED","MISSILE_LAUNCH_FAILED"].includes(v.outcome.kind)||
   v.outcome.boundaryMs!==v.boundaryMs||
   !Number.isFinite(v.outcome.observedAtMs)||v.outcome.observedAtMs<=0||
   (v.outcome.kind==="TURRET_RESOLVED"&&typeof v.outcome.hit!=="boolean")||
   (v.outcome.kind==="MISSILE_LAUNCHED"&&!valid(v.outcome.missileID))
  )))
  throw Error("INVALID_BANK_RECEIPT");
 return v;
}
function validateFence(raw,id){
 if(raw==null)return null;
 const v=JSON.parse(raw);
 if(v?.version!==1||v.entityID!==id||!v.modules||
  typeof v.modules!=="object"||Array.isArray(v.modules)||
  Object.keys(v.modules).length>2048||
  (v.outcomeRequired!==undefined&&typeof v.outcomeRequired!=="boolean")||
  Object.entries(v.modules).some(([k,n])=>!valid(k)||
    String(valid(k))!==k||!Number.isFinite(n)||n<=0))
  throw Error("INVALID_NATIVE_FENCE");
 return v;
}
function auditBankSqlite({root,sqlitePath,maxShips=2000,requireOutcome=false}={}){
 if(!path.isAbsolute(root||"")||!path.isAbsolute(sqlitePath||"")||
  !Number.isSafeInteger(maxShips)||maxShips<1||maxShips>20000||
  typeof requireOutcome!=="boolean")
  throw Error("INVALID_BANK_AUDIT_INPUT");
 const rootSt=fs.lstatSync(root),dbSt=fs.lstatSync(sqlitePath);
 if(rootSt.isSymbolicLink()||!rootSt.isDirectory()||
  dbSt.isSymbolicLink()||!dbSt.isFile())
  throw Error("UNSAFE_BANK_AUDIT_PATH");
 const dir=path.join(root,"bank-ships"),names=[];
 if(fs.existsSync(dir)){
  const st=fs.lstatSync(dir);
  if(st.isSymbolicLink()||!st.isDirectory())
   throw Error("UNSAFE_BANK_AUDIT_DIRECTORY");
  names.push(...fs.readdirSync(dir));
 }
 if(names.length>maxShips*5)throw Error("BANK_AUDIT_FILE_LIMIT");
 const ids=new Set(),warnings=[],files=new Map();
 for(const name of names){
  const m=/^([1-9][0-9]*)\.json(?:\.lock|\.tmp-[0-9]+-[0-9]+)?$/.exec(name);
  const id=m?valid(m[1]):null;
  if(!id||String(id)!==m[1]){warnings.push("UNKNOWN_FILE:"+name);continue;}
  ids.add(id);
  if(!files.has(id))files.set(id,[]);
  files.get(id).push(name);
 }
 let db;
 const fences=new Map();
 try{
  db=new DatabaseSync(sqlitePath,{readOnly:true});
  const rows=db.prepare('SELECT key,json FROM "npcCargo" WHERE key LIKE ? LIMIT ?')
   .all("coopAmmoCycles_%",maxShips+1);
  if(rows.length>maxShips)throw Error("BANK_AUDIT_SQL_LIMIT");
  for(const row of rows){
   const m=/^coopAmmoCycles_([1-9][0-9]*)$/.exec(row.key);
   const id=m?valid(m[1]):null;
   if(!id||String(id)!==m[1]){warnings.push("UNKNOWN_NATIVE_FENCE:"+row.key);continue;}
   if(fences.has(id))throw Error("DUPLICATE_NATIVE_FENCE");
   fences.set(id,validateFence(row.json,id));
   ids.add(id);
  }
 }finally{if(db)db.close();}
 if(ids.size>maxShips)throw Error("BANK_AUDIT_SHIP_LIMIT");
 const entries=[],counts={MATCH_COMMITTED:0,NEEDS_RECONCILIATION:0,
  COMMIT_MISMATCH:0,NATIVE_FENCE_WITHOUT_JOURNAL:0,
  JOURNAL_WITHOUT_NATIVE_FENCE:0,CORRUPT_NEEDS_REVIEW:0,
  MISSING_FIRE_OUTCOME:0,FAILED_FIRE_OUTCOME:0,OUTCOME_MODE_MISMATCH:0};
 for(const id of [...ids].sort((a,b)=>a-b)){
  const entriesForShip=files.get(id)||[];
  const lock=entriesForShip.includes(String(id)+".json.lock");
  const orphanTemp=entriesForShip.some(n=>n.startsWith(String(id)+".json.tmp-"));
  const fence=fences.get(id)||null;
  let receipt=null,status,modulesMatched=0;
  try{
   receipt=readFile(path.join(dir,String(id)+".json"));
   if(receipt&&receipt.entityID!==id)throw Error("ENTITY_MISMATCH");
   if(!receipt&&!fence)status="CORRUPT_NEEDS_REVIEW";
   else if(!receipt)status="NATIVE_FENCE_WITHOUT_JOURNAL";
   else if(lock||orphanTemp||receipt.phase==="PREPARED"){
    modulesMatched=fence?receipt.modules.filter(mid=>
     Number(fence.modules[String(mid)]||0)>=receipt.boundaryMs).length:0;
    // PREPARED is never proof of rollback even if no fence is visible;
    // protect both the pre-COMMIT and lost-COMMIT-ack cases equally.
    status="NEEDS_RECONCILIATION";
   }else if(!fence)status="JOURNAL_WITHOUT_NATIVE_FENCE";
   else{
    modulesMatched=receipt.modules.filter(mid=>
     Number(fence.modules[String(mid)]||0)>=receipt.boundaryMs).length;
    status=modulesMatched===receipt.modules.length?
     "MATCH_COMMITTED":"COMMIT_MISMATCH";
    if(status==="MATCH_COMMITTED"){
     if(Boolean(fence.outcomeRequired)!==Boolean(receipt.outcomeRequired))
      status="OUTCOME_MODE_MISMATCH";
     else if(requireOutcome||receipt.outcomeRequired===true||
             fence.outcomeRequired===true){
      if(!receipt.outcome)status="MISSING_FIRE_OUTCOME";
      else if(receipt.outcome.kind==="MISSILE_LAUNCH_FAILED")
       status="FAILED_FIRE_OUTCOME";
     }
    }
   }
  }catch(_){status="CORRUPT_NEEDS_REVIEW";}
  counts[status]++;
  entries.push({entityID:id,status,receiptPhase:receipt?.phase||null,
   boundaryMs:receipt?.boundaryMs||null,
   lock,orphanTemp,sqliteFencePresent:!!fence,
   modulesMatched,modulesTotal:receipt?.modules.length||0,
   outcomeKind:receipt?.outcome?.kind||null,
   outcomeRequired:receipt?.outcomeRequired===true||fence?.outcomeRequired===true});
 }
 const clean=warnings.length===0&&
  entries.every(r=>r.status==="MATCH_COMMITTED");
 return {status:clean?"CLEAN":"NEEDS_OPERATOR_REVIEW",clean,
  scanned:ids.size,counts,warnings,entries};
}
if(require.main===module){
 try{
  if(process.argv[4]!==undefined&&process.argv[4]!=="--require-outcome")
   throw Error("INVALID_BANK_AUDIT_ARGUMENT");
  if(process.argv.length>5)throw Error("INVALID_BANK_AUDIT_ARGUMENT");
  const report=auditBankSqlite({
   root:process.argv[2],
   sqlitePath:process.argv[3],
   requireOutcome:process.argv[4]==="--require-outcome"
  });
  process.stdout.write(JSON.stringify(report,null,2)+"\n");
  if(!report.clean)process.exitCode=2;
 }catch(e){
  process.stderr.write("READ_ONLY_SQLITE_BANK_AUDIT_FAILED:"+e.message+"\n");
  process.exitCode=2;
 }
}
module.exports={auditBankSqlite};
