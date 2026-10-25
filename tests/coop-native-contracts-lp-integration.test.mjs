import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch}=require("../scripts/coop-native-contract-routing-patch.cjs");
const {specs,transform}=require("../scripts/patch-evejs-coop.cjs");
const native=process.env.EVEJS_COOP_CODE_PATH || "";

const supported=[
 "server/index.js",
 "server/src/services/machoNet/machoNetService.js",
 "server/src/services/contracts/contractRuntimeState.js"
];
function originalSource(file){
 if(!native)return null;
 const spec=specs.find(s=>s.file===file);
 assert.ok(spec,"Native file missing from transactional overlay spec: "+file);
 const src=fs.readFileSync(path.join(native,file),"utf8");
 // Accept both pinned-pristine and already-patched checked-out code.
 return transform(src,spec,true);
}
function fragmentFor(method){
 const fixture=[
  "function completeCourierContract(contract, session) {\n  if (contract.status !== CONTRACT_STATUS.IN_PROGRESS) {",
  "function failCourierContract(contract, session) {\n  if (contract.status !== CONTRACT_STATUS.IN_PROGRESS) {"
 ].join("\n");
 const src=patch(fixture,"server/src/services/contracts/contractRuntimeState.js");
 const start=src.indexOf("function "+method+"(contract, session) {");
 const end=src.indexOf("  if (contract.status",start);
 assert.ok(start>=0&&end>start);
 return src.slice(start,end)+"return true;\n}";
}
function callGuard(method,contract,session,enabled=true){
 const body=fragmentFor(method);
 const fn=new Function("contract","session","process","toPositiveInteger",
   "getSessionCharacterID","getSessionCorporationID","throwContractError",
   body+";return "+method+"(contract,session);");
 return fn(contract,session,{env:{EVEJS_COOP_NATIVE_CONTRACTS:enabled?"1":"0"}},
   v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):0,
   s=>s?.characterID||0,s=>s?.corporationID||0,
   error=>{throw Error(error)});
}
test("native contract service alias is opt-in and dispatches to real proxy",()=>{
 const s=patch("log.success(`registered ${serviceManager.count} services`);","server/index.js");
 const start=s.indexOf('if (process.env.EVEJS_COOP_NATIVE_CONTRACTS === "1")');
 assert.ok(start>=0);
 const end=s.indexOf("log.success(",start);
 const code=s.slice(start,end);
 const run=new Function("serviceManager","process",code);
 const stub={Handle_CreateContract:()=>null};
 const proxy={
  Handle_CreateContract:()=>["real-contract-created"],
  Handle_AcceptContract:()=>["real-contract-accepted"],
  Handle_CompleteContract:()=>true
 };
 const services=new Map([["contractMgr",stub],["contractProxy",proxy]]);
 const manager={lookup:name=>services.get(name),registerAlias:(alias,source)=>{
  services.set(alias,services.get(source));
 }};
 run(manager,{env:{EVEJS_COOP_NATIVE_CONTRACTS:"0"}});
 assert.equal(manager.lookup("contractMgr"),stub);
 run(manager,{env:{EVEJS_COOP_NATIVE_CONTRACTS:"1"}});
 assert.equal(manager.lookup("contractMgr"),proxy);
 assert.deepEqual(manager.lookup("contractMgr").Handle_CreateContract(),["real-contract-created"]);
 assert.deepEqual(manager.lookup("contractMgr").Handle_AcceptContract(),["real-contract-accepted"]);
 services.delete("contractProxy");
 assert.throws(()=>run(manager,{env:{EVEJS_COOP_NATIVE_CONTRACTS:"1"}}),/COOP_NATIVE_CONTRACT_PROXY_UNAVAILABLE/);
});
test("native courier completion and failure reject third party, stale or forged owner",()=>{
 for(const action of ["completeCourierContract","failCourierContract"]){
  const contract={acceptorID:102,acceptorWallet:{kind:"character",ownerID:102}};
  const captain={characterID:101,corporationID:4};
  const courier={characterID:102,corporationID:4};
  assert.throws(()=>callGuard(action,contract,captain),/Only the original courier acceptor/);
  assert.equal(callGuard(action,contract,courier),true);
  assert.throws(()=>callGuard(action,{...contract,acceptorWallet:{kind:"character",ownerID:101}},courier),
    /Only the original courier acceptor/);
  assert.throws(()=>callGuard(action,{...contract,acceptorID:0},courier),
    /Only the original courier acceptor/);
  assert.throws(()=>callGuard(action,contract,captain,false),/Only the original courier acceptor/,
    "Direct contractProxy must remain protected even when contractMgr alias is OFF");
  const corp={acceptorID:88,acceptorWallet:{kind:"corporation",ownerID:88}};
  assert.equal(callGuard(action,corp,{characterID:101,corporationID:88}),true);
  assert.throws(()=>callGuard(action,corp,{characterID:102,corporationID:44}),
    /Only the original courier acceptor/);
 }
});
test("contract service discovery advertises proxy only with opt-in flag",()=>{
 const src='        ["contractMgr", null],';
 const patched=patch(src,"server/src/services/machoNet/machoNetService.js");
 assert.match(patched,/EVEJS_COOP_NATIVE_CONTRACTS/);
 assert.match(patched,/\["contractProxy", null\]/);
 assert.equal(patch(patched,"server/src/services/machoNet/machoNetService.js",true),src);
});
test("source overlays are reversible and idempotent against pinned EveJS",t=>{
 if(!native){t.skip("Set EVEJS_COOP_CODE_PATH to pinned EveJS Code");return;}
 for(const file of supported){
  const src=originalSource(file);
  const applied=patch(src,file);
  assert.notEqual(applied,src,file);
  assert.equal(patch(applied,file),applied,file+" second apply");
  assert.equal(patch(applied,file,true),src,file+" exact rollback");
  assert.equal(patch(src,file,true),src,file+" remove pristine");
  new vm.Script(applied,{filename:file});
  const spec=specs.find(x=>x.file===file);
  assert.equal(transform(transform(src,spec,false),spec,true),src,file+" full overlay rollback");
 }
});
test("LP Store uses genuine character purchase with native LP, ISK and item debit",t=>{
 if(!native){t.skip("Set EVEJS_COOP_CODE_PATH to pinned EveJS Code");return;}
 const read=f=>fs.readFileSync(path.join(native,f),"utf8");
 const lp=read("server/src/services/evermarks/lpStoreMgrService.js");
 const bank=read("server/src/services/corporation/lpService.js");
 const service=read("server/src/services/machoNet/machoNetService.js");
 assert.match(lp,/Handle_TakeOfferForCharacter\(args, session\)/);
 assert.match(lp,/takeStaticOfferForCharacter\(/);
 assert.match(lp,/adjustCharacterWalletLPBalance\(/);
 assert.match(lp,/adjustCharacterBalance\(/);
 assert.match(lp,/grantItemToCharacterLocation\(/);
 assert.match(lp,/rollbackStaticLpStorePurchase\(/);
 assert.match(service,/\["LPStoreMgr", "station"\]/);
 assert.match(bank,/Handle_TakeOffer\(\) \{\s*log.debug\(/);
});
