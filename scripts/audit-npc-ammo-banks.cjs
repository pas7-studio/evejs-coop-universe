#!/usr/bin/env node
"use strict";
// Read-only audit; NEVER edits native SQLite, receipts, lockfiles or volumes.
const fs=require("node:fs");
const path=require("node:path");
const {inspectShip}=require("../integration/coopNpcAmmoBankAtomic.cjs");
const pos=v=>Number.isSafeInteger(Number(v))&&Number(v)>0;
function auditBanks({root,limit=2000}={}){
 if(typeof root!=="string"||!path.isAbsolute(root)||!Number.isSafeInteger(limit)||
  limit<1||limit>20000)throw Error("INVALID_BANK_AUDIT_OPTIONS");
 const dir=path.join(root,"bank-ships"),entries=[],warnings=[];
 const counts={COMMITTED:0,BANK_LOCKED_RECONCILE:0,
  BANK_NEEDS_RECONCILIATION:0,BANK_ORPHAN_TEMP:0,
  BANK_JOURNAL_CORRUPT:0,BANK_OTHER_UNSAFE:0};
 if(!fs.existsSync(dir))return {status:"NOT_INSTALLED",counts,entries,warnings,scanned:0};
 const st=fs.lstatSync(dir);
 if(!st.isDirectory()||st.isSymbolicLink())throw Error("UNSAFE_BANK_AUDIT_DIRECTORY");
 const files=fs.readdirSync(dir);
 const ids=new Set();
 for(const name of files){
  const found=/^([1-9][0-9]*)\.json(?:\.lock|\.tmp-[0-9]+-[0-9]+)?$/.exec(name);
  if(!found||!pos(found[1])||String(Number(found[1]))!==found[1]){
   warnings.push("UNKNOWN_BANK_FILE:"+name);
   continue;
  }
  ids.add(Number(found[1]));
 }
 if(ids.size>limit)return {status:"INCOMPLETE",counts,entries,
  warnings:[...warnings,"AUDIT_LIMIT_REACHED"],scanned:0};
 for(const entityID of [...ids].sort((a,b)=>a-b)){
  const observed=inspectShip({root,entityID});
  const state=observed.ok?"COMMITTED":observed.status;
  // A journal with only a .lock or temp file is not a valid COMMITTED.
  const key=Object.hasOwn(counts,state)?state:"BANK_OTHER_UNSAFE";
  counts[key]++;
  if(key!=="COMMITTED")entries.push({entityID,status:key,
   reason:observed.status});
 }
 return {status:entries.length||warnings.length?
  "NEEDS_OPERATOR_RECONCILIATION":"CLEAN",
  counts,entries,warnings,scanned:ids.size};
}
if(require.main===module){
 try{
  const result=auditBanks({root:process.argv[2]||
   process.env.EVEJS_COOP_NPC_AMMO_DEBIT_ROOT||
   "/var/lib/evejs/coop-npc-ammo-debits"});
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
  if(!["CLEAN","NOT_INSTALLED"].includes(result.status))process.exitCode=2;
 }catch(e){
  process.stderr.write("READ_ONLY_BANK_AUDIT_FAILED: "+String(e.message)+"\n");
  process.exitCode=2;
 }
}
module.exports={auditBanks};
