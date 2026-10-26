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

test("P0: corrupted durable native-delivery checkpoint never re-credits original source ore",()=>scoped(({file})=>{
 const base={version:1,lastAt:100,systems:{[system]:{
  ore:200,goods:200,demand:100,security:50,losses:0,nativeDelivered:100
 }},pilots:{},events:[]};
 for(const bad of [-100,-1,null,"0","100",1.5,Number.MAX_SAFE_INTEGER+1]){
  const original=structuredClone(base);
  original.systems[system].nativeDelivered=bad;
  const bytes=JSON.stringify(original);
  fs.writeFileSync(file,bytes);
  assert.throws(()=>createEconomy({file,clock:()=>100}),
   /ECONOMY_NATIVE_DELIVERY_CHECKPOINT_INVALID/,String(bad));
  assert.equal(fs.readFileSync(file,"utf8"),bytes,
   "must preserve original journal untouched for operator reconciliation");
 }
}));

test("P0: corrupt economy systems cannot be accepted as legitimate native balance",()=>scoped(({file})=>{
 const base={version:1,lastAt:0,systems:{},pilots:{},events:[]};
 for(const invalid of [null,[],true,{"30000144":null},
  {"30000144":[]},{"30000144":"not-a-native-balance"}]){
  fs.writeFileSync(file,JSON.stringify({...base,systems:invalid}));
  assert.throws(()=>createEconomy({file,clock:()=>0}),
   /ECONOMY_NATIVE_DELIVERY_CHECKPOINT_INVALID/);
 }
}));

test("P0: legitimate zero, prior and absent native high-water values remain compatible",()=>scoped(({file})=>{
 const base={version:1,lastAt:100,systems:{[system]:{
  ore:200,goods:100,demand:100,security:50,losses:0
 }},pilots:{},events:[]};
 for(const marker of [undefined,0,100]){
  const state=structuredClone(base);
  if(marker!==undefined)state.systems[system].nativeDelivered=marker;
  fs.writeFileSync(file,JSON.stringify(state));
  const e=createEconomy({file,clock:()=>100});
  const response=e.syncNativeDeliveries({[system]:100});
  assert.equal(response.quantity,marker===100?0:100);
  assert.equal(e.snapshot().systems[system].nativeDelivered,100);
  assert.equal(createEconomy({file}).syncNativeDeliveries({[system]:100}).quantity,0);
 }
}));

test("P0: externally damaged native high-water fails read fence before it can be overwritten",()=>scoped(({file})=>{
 const e=createEconomy({file,clock:()=>0});
 assert.equal(e.syncNativeDeliveries({[system]:100}).quantity,100);
 const snapshot=JSON.parse(fs.readFileSync(file,"utf8"));
 snapshot.systems[system].nativeDelivered=-100;
 fs.writeFileSync(file,JSON.stringify(snapshot));
 assert.throws(()=>e.syncNativeDeliveries({[system]:100}),/ECONOMY_CONCURRENT_JOURNAL_DRIFT/);
 assert.throws(()=>e.snapshot(),/ECONOMY_PERSISTENCE_UNVERIFIED/);
 assert.throws(()=>createEconomy({file}),/ECONOMY_NATIVE_DELIVERY_CHECKPOINT_INVALID/);
}));

test("P0: malformed loss never corrupts native security or journal after durable ore credit",()=>scoped(({file})=>{
 const economy=createEconomy({file,clock:()=>101});
 assert.equal(economy.syncNativeDeliveries({[system]:100}).quantity,100);
 const before=fs.readFileSync(file,"utf8");
 for(const invalid of [NaN,Infinity,-Infinity,-1,"not-an-amount",{}]){
  assert.throws(()=>economy.recordLoss(30000144,invalid),
   /ECONOMY_INVALID_LOSS/,String(invalid));
  assert.equal(fs.readFileSync(file,"utf8"),before,
   "invalid loss must not write a new journal or clear native high-water");
  assert.equal(economy.snapshot().systems[system].security,50);
 }
 for(const invalidSystem of [0,-1,1.5,NaN,"invalid-system",null]){
  assert.throws(()=>economy.recordLoss(invalidSystem,2),
   /ECONOMY_INVALID_LOSS/,String(invalidSystem));
  assert.equal(fs.readFileSync(file,"utf8"),before);
 }
 const valid=economy.recordLoss(30000144,2);
 assert.equal(valid.type,"loss");
 assert.equal(valid.amount,2);
 assert.equal(valid.systemID,30000144);
 const saved=createEconomy({file,clock:()=>101}).snapshot().systems[system];
 assert.equal(saved.security,48);
 assert.equal(saved.nativeDelivered,100);
 assert.equal(saved.goods,200);
 assert.equal(createEconomy({file}).syncNativeDeliveries({[system]:100}).quantity,0);
}));

test("P0: an unchanged native ore delivery must not trim event history only in memory",()=>scoped(({file})=>{
 const events=Array.from({length:101},(_,i)=>({type:"prior",at:i}));
 const persisted={version:1,lastAt:100,systems:{[system]:{
  ore:200,goods:200,demand:0,security:50,losses:0,nativeDelivered:100
 }},pilots:{},events};
 fs.writeFileSync(file,JSON.stringify(persisted));
 const oldBytes=fs.readFileSync(file,"utf8");
 const economy=createEconomy({file,clock:()=>100});
 assert.deepEqual(economy.syncNativeDeliveries({[system]:100}),
  {status:"UNCHANGED",quantity:0});
 assert.equal(fs.readFileSync(file,"utf8"),oldBytes);
 assert.equal(economy.snapshot().events.length,101,
  "unchanged operation cannot leave a shorter unpersisted memory journal");
 // A real subsequent original delivery may compact the event history and
 // atomically persist both new high-water and retained events.
 assert.deepEqual(economy.syncNativeDeliveries({[system]:120}),
  {status:"UPDATED",quantity:20});
 assert.equal(economy.snapshot().events.length,100);
 const restored=createEconomy({file,clock:()=>100});
 assert.equal(restored.snapshot().events.length,100);
 assert.equal(restored.snapshot().systems[system].nativeDelivered,120);
 assert.equal(restored.syncNativeDeliveries({[system]:120}).quantity,0);
}));

test("P0: corrupted stored goods cannot erase original virtual ore during native sync",()=>scoped(({file})=>{
 const state={version:1,lastAt:100,systems:{[system]:{
  ore:200,goods:"corrupted",demand:100,security:50,losses:0,nativeDelivered:100
 }},pilots:{},events:[]};
 const bytes=JSON.stringify(state);fs.writeFileSync(file,bytes);
 assert.throws(()=>createEconomy({file,clock:()=>100}),
  /ECONOMY_SYSTEM_BALANCE_INVALID/);
 assert.equal(fs.readFileSync(file,"utf8"),bytes);
 assert.equal(JSON.parse(fs.readFileSync(file,"utf8")).systems[system].nativeDelivered,100);
 // Only an operator-verified repair can restore the original goods balance.
 state.systems[system].goods=200;
 fs.writeFileSync(file,JSON.stringify(state));
 const recovered=createEconomy({file,clock:()=>100});
 assert.equal(recovered.syncNativeDeliveries({[system]:120}).quantity,20);
 assert.equal(recovered.snapshot().systems[system].goods,220);
 assert.equal(createEconomy({file}).syncNativeDeliveries({[system]:120}).quantity,0);
}));

test("P0: invalid persisted system balances fail closed without rewriting journal",()=>scoped(({file})=>{
 const base={version:1,lastAt:100,systems:{[system]:{
  ore:200,goods:200,demand:100,security:50,losses:0,nativeDelivered:100
 }},pilots:{},events:[]};
 const corrupt=[
  ["ore",-1],["goods",null],["goods","200"],["goods",1.5],
  ["goods",1000001],["demand",Infinity],["security",-1],
  ["security",101],["security",null],["losses",-1],["losses",1000001]
 ];
 for(const [key,value] of corrupt){
  const data=structuredClone(base);
  data.systems[system][key]=value;
  const encoded=JSON.stringify(data);fs.writeFileSync(file,encoded);
  assert.throws(()=>createEconomy({file,clock:()=>100}),
   /ECONOMY_SYSTEM_BALANCE_INVALID/,key);
  assert.equal(fs.readFileSync(file,"utf8"),encoded,key);
 }
 const missing=structuredClone(base);delete missing.systems[system].goods;
 fs.writeFileSync(file,JSON.stringify(missing));
 assert.throws(()=>createEconomy({file}),/ECONOMY_SYSTEM_BALANCE_INVALID/);
}));

test("P0: valid bounded virtual balances and prior delivery checkpoint remain compatible",()=>scoped(({file})=>{
 const base={version:1,lastAt:100,systems:{[system]:{
  ore:0,goods:1000000,demand:0,security:100,losses:1000000,nativeDelivered:100
 }},pilots:{},events:[]};
 fs.writeFileSync(file,JSON.stringify(base));
 const e=createEconomy({file,clock:()=>100});
 assert.equal(e.snapshot().systems[system].goods,1000000);
 assert.equal(e.syncNativeDeliveries({[system]:100}).quantity,0);
 assert.equal(e.syncNativeDeliveries({[system]:110}).quantity,10);
 assert.equal(e.snapshot().systems[system].nativeDelivered,110);
 assert.equal(e.snapshot().systems[system].goods,1000000);
 assert.equal(createEconomy({file}).syncNativeDeliveries({[system]:110}).quantity,0);
}));
