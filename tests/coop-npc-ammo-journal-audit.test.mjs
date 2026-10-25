import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {audit}=require("../scripts/audit-npc-ammo-debits.cjs");
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"npc-ammo-audit-"));
 const dir=path.join(root,"ships","101");
 fs.mkdirSync(dir,{recursive:true});
 const receipt=(phase="COMMITTED",moduleID=401)=>({
  version:1,phase,entityID:101,moduleID,cargoID:501,boundaryMs:1000,
  beforeQuantity:5,afterQuantity:4,ownerID:900,typeID:35,
  nonce:"test"});
 const write=(phase,moduleID=401)=>fs.writeFileSync(
  path.join(dir,String(moduleID)+".json"),JSON.stringify(receipt(phase,moduleID)));
 const cleanup=()=>fs.rmSync(root,{recursive:true,force:true});
 return {root,dir,write,receipt,cleanup};
}
test("empty journal and missing root are visibly safe to inspect",()=>{
 const f=fixture();try{
  const result=audit({root:f.root});
  assert.equal(result.status,"CLEAN");
  assert.equal(result.scanned,0);
  assert.equal(audit({root:path.join(f.root,"not-installed")}).status,
   "NOT_INSTALLED");
 }finally{f.cleanup();}
});
test("completed journal returns clean with no repair action",()=>{
 const f=fixture();try{
  f.write("COMMITTED");
  const r=audit({root:f.root});
  assert.equal(r.status,"CLEAN");assert.equal(r.counts.COMMITTED,1);
  assert.equal(r.entries.length,0);
 }finally{f.cleanup();}
});
test("crash PREPARED receipt reported, never rewritten or removed",()=>{
 const f=fixture();try{
  f.write("PREPARED");
  const before=fs.readFileSync(path.join(f.dir,"401.json"),"utf8");
  const r=audit({root:f.root});
  assert.equal(r.status,"NEEDS_OPERATOR_RECONCILIATION");
  assert.equal(r.counts.PREPARED_RECONCILE,1);
  assert.equal(fs.readFileSync(path.join(f.dir,"401.json"),"utf8"),before);
 }finally{f.cleanup();}
});
test("stale writer lock takes precedence even if cycle record says COMMITTED",()=>{
 const f=fixture();try{
  f.write("COMMITTED");
  fs.writeFileSync(path.join(f.dir,"401.json.lock"),"stale");
  const r=audit({root:f.root});
  assert.equal(r.counts.LOCKED_RECONCILE,1);
  assert.equal(fs.existsSync(path.join(f.dir,"401.json.lock")),true);
 }finally{f.cleanup();}
});
test("interrupted atomic file orphan temp forces operator review",()=>{
 const f=fixture();try{
  f.write("COMMITTED");
  fs.writeFileSync(path.join(f.dir,"401.json.tmp-100-20"),"orphan");
  assert.equal(audit({root:f.root}).counts.ORPHAN_TEMP_RECONCILE,1);
 }finally{f.cleanup();}
});
test("corrupt record cannot be silently classified as committed",()=>{
 const f=fixture();try{
  fs.writeFileSync(path.join(f.dir,"401.json"),"{invalid");
  const r=audit({root:f.root});
  assert.equal(r.status,"NEEDS_OPERATOR_RECONCILIATION");
  assert.equal(r.counts.CORRUPT_RECONCILE,1);
 }finally{f.cleanup();}
});
test("audit limit reports INCOMPLETE instead of pretending all ammo receipts clean",()=>{
 const f=fixture();try{
  f.write("COMMITTED",401);f.write("COMMITTED",402);
  const r=audit({root:f.root,limit:1});
  assert.equal(r.status,"INCOMPLETE");
  assert.equal(r.warnings[0],"AUDIT_LIMIT_REACHED");
  assert.equal(r.scanned,1);
 }finally{f.cleanup();}
});
