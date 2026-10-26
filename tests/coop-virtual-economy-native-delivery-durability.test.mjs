import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createEconomy}=require("../integration/coopVirtualEconomy.cjs");
const system="30000144";
function scoped(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-economy-custody-"));
 try{return fn({dir,file:path.join(dir,"economy.json")});}
 finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test("P0: stale loss writer cannot erase original native ore delivery checkpoint",()=>scoped(({file})=>{
 const a=createEconomy({file,clock:()=>0}),b=createEconomy({file,clock:()=>60000});
 assert.deepEqual(a.syncNativeDeliveries({[system]:100}),{status:"UPDATED",quantity:100});
 assert.equal(a.snapshot().systems[system].goods,200);
 assert.throws(()=>b.recordLoss(30000144,2),/ECONOMY_CONCURRENT_JOURNAL_DRIFT/);
 assert.throws(()=>b.snapshot(),/ECONOMY_PERSISTENCE_UNVERIFIED/);
 assert.throws(()=>b.syncNativeDeliveries({[system]:100}),/ECONOMY_PERSISTENCE_UNVERIFIED/);
 const reopened=createEconomy({file,clock:()=>60000});
 assert.equal(reopened.snapshot().systems[system].goods,200);
 assert.equal(reopened.snapshot().systems[system].nativeDelivered,100);
 assert.deepEqual(reopened.syncNativeDeliveries({[system]:100}),{status:"UNCHANGED",quantity:0});
 assert.equal(createEconomy({file}).snapshot().systems[system].goods,200);
}));

test("P0: stale timer advance cannot overwrite COMMITTED native supply",()=>scoped(({file})=>{
 const stale=createEconomy({file,clock:()=>60000});
 const active=createEconomy({file,clock:()=>0});
 assert.equal(active.syncNativeDeliveries({[system]:100}).quantity,100);
 assert.throws(()=>stale.advance([]),/ECONOMY_CONCURRENT_JOURNAL_DRIFT/);
 assert.equal(createEconomy({file}).snapshot().systems[system].nativeDelivered,100);
 assert.equal(createEconomy({file}).snapshot().systems[system].goods,200);
}));

test("P0: second native batch after stale writer rejection applies only new delta",()=>scoped(({file})=>{
 const a=createEconomy({file,clock:()=>100}),b=createEconomy({file,clock:()=>200});
 assert.equal(a.syncNativeDeliveries({[system]:100}).quantity,100);
 assert.throws(()=>b.syncNativeDeliveries({[system]:200}),/ECONOMY_CONCURRENT_JOURNAL_DRIFT/);
 const current=createEconomy({file,clock:()=>300});
 assert.equal(current.syncNativeDeliveries({[system]:200}).quantity,100);
 assert.equal(current.snapshot().systems[system].goods,300);
 assert.equal(current.snapshot().systems[system].nativeDelivered,200);
 assert.equal(current.syncNativeDeliveries({[system]:200}).quantity,0);
 assert.equal(createEconomy({file}).snapshot().systems[system].goods,300);
}));

test("P0: active or abandoned economy lock refuses both snapshots and all mutations",()=>scoped(({file})=>{
 const economy=createEconomy({file});
 const lock=fs.openSync(file+".lock","wx");fs.closeSync(lock);
 try{
  assert.throws(()=>economy.snapshot(),/ECONOMY_WRITE_IN_PROGRESS/);
  assert.throws(()=>economy.syncNativeDeliveries({[system]:100}),/ECONOMY_PERSISTENCE_UNVERIFIED/);
  assert.throws(()=>economy.advance([]),/ECONOMY_PERSISTENCE_UNVERIFIED/);
  assert.throws(()=>economy.recordLoss(30000144,1),/ECONOMY_PERSISTENCE_UNVERIFIED/);
 }finally{fs.unlinkSync(file+".lock")}
 // Poison is sticky, regardless of the foreign lock disappearing.
 assert.throws(()=>economy.snapshot(),/ECONOMY_PERSISTENCE_UNVERIFIED/);
 const recovered=createEconomy({file});
 assert.equal(recovered.syncNativeDeliveries({[system]:100}).quantity,100);
 assert.equal(recovered.snapshot().systems[system].nativeDelivered,100);
}));

test("P0: post-rename fsync uncertainty never permits stale virtual delivery reply",()=>scoped(({dir,file})=>{
 const syntheticDirFd=99999999,io={
  ...fs,
  openSync(p,flag,...args){
   if(p===dir&&flag==="r")return syntheticDirFd;
   return fs.openSync(p,flag,...args);
  },
  fsyncSync(fd){
   if(fd===syntheticDirFd)throw Object.assign(Error("EIO"),{code:"EIO"});
   return fs.fsyncSync(fd);
  },
  closeSync(fd){if(fd!==syntheticDirFd)return fs.closeSync(fd)}
 };
 const doubtful=createEconomy({file,clock:()=>500,fsApi:io});
 assert.throws(()=>doubtful.syncNativeDeliveries({[system]:100}),/EIO/);
 assert.throws(()=>doubtful.snapshot(),/ECONOMY_PERSISTENCE_UNVERIFIED/);
 assert.throws(()=>doubtful.syncNativeDeliveries({[system]:100}),/ECONOMY_PERSISTENCE_UNVERIFIED/);
 // Rename may already be on disk, so never blindly retry the debit.
 const reopened=createEconomy({file,clock:()=>600});
 assert.equal(reopened.snapshot().systems[system].nativeDelivered,100);
 assert.equal(reopened.snapshot().systems[system].goods,200);
 assert.equal(reopened.syncNativeDeliveries({[system]:100}).quantity,0);
 assert.equal(fs.existsSync(file+".lock"),false);
}));

test("P0: no-op sync and zero-step tick never make memory diverge from disk",()=>scoped(({file})=>{
 const e=createEconomy({file,clock:()=>0});
 assert.deepEqual(e.syncNativeDeliveries({[system]:0}),{status:"UNCHANGED",quantity:0});
 assert.equal(e.advance([]).steps,0);
 assert.deepEqual(e.snapshot().systems,{});
 assert.equal(fs.existsSync(file),false);
 const p={id:"pilot-1",systemID:30000144};
 assert.equal(e.advance([p]).status,"OK");
 assert.equal(createEconomy({file}).snapshot().pilots["pilot-1"].role,"miner");
 assert.equal(e.syncNativeDeliveries({[system]:0}).quantity,0);
 assert.equal(createEconomy({file}).snapshot().systems[system].nativeDelivered,undefined);
}));
