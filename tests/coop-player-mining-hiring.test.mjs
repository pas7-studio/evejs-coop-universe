import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createMiningHiring,readServerWagePolicy}=require("../integration/coopPlayerMiningHiring.cjs");
const SEP="\u001f",BUYER=8010,EMPLOYER=8011,SYSTEM=30000144,FLEET=9001,AGENT=80003;
function fixture(){
 const session={characterID:2001,userid:13,corporationID:BUYER,socket:{destroyed:false}};
 let allowed=true,enabled=true,correctEmployer=true,expiresAt=200000,
  now=100000,changePolicy=false,badRead=false,verified=true,writes=0;
 const records=new Map(),original={systemID:SYSTEM,fleetID:FLEET,ownerID:EMPLOYER,minerIDs:[21,22],haulerIDs:[23]},
  policy={revision:1,minerCycleCents:10000,haulerCycleCents:5000,maxCycles:6};
 const corp=(id,balance)=>({corporationID:id,wallet:{divisions:{
  "1000":{balance,transactions:[],journal:[]}}}});
 records.set("corporations"+SEP+BUYER,corp(BUYER,1200));
 records.set("corporations"+SEP+EMPLOYER,corp(EMPLOYER,0));
 const originalStore={
  read(table,key){
   assert.equal(table,"corporationRuntime");
   if(badRead)return {success:false,errorMsg:"READ_ERROR"};
   const row=records.get(key.slice(1).replace("/",SEP));
   return row?{success:true,data:structuredClone(row)}:{success:false,errorMsg:"ENTRY_NOT_FOUND"};
  },
  coopAtomicNativeRows:{mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>false,
   transact(tables,fn){
    assert.deepEqual(tables,["corporationRuntime"]);
    const snapshot=structuredClone([...records]);
    const tx={get(_table,key){return records.get(key)||null;},
     put(_table,key,value){records.set(key,structuredClone(value));writes++;},
     scan(){return [...records].map(([key,value])=>({key,value}));}};
    try{return fn(tx)}
    catch(e){records.clear();for(const [k,v]of snapshot)records.set(k,v);throw e}
   }}
 };
 const access={isMember:()=>allowed,canIndustry:()=>allowed,canWallet:()=>allowed};
 const getFleet=({systemID,fleetID})=>systemID===SYSTEM&&fleetID===FLEET?structuredClone(original):null;
 const base={gameStore:originalStore,access,getFleet,
  verifyNativeFleet:f=>verified&&f?.ownerID===EMPLOYER&&
   f.minerIDs.join(",")===original.minerIDs.join(","),
  isNpcCorporation:id=>id===EMPLOYER&&correctEmployer,
  getPolicy:id=>id===EMPLOYER?{...policy,minerCycleCents:changePolicy?11000:policy.minerCycleCents}:null,
  clock:()=>now,enabled:()=>enabled};
 let svc=createMiningHiring(base);
 const args={session,agentID:AGENT,corporationID:BUYER,
  employerCorpID:EMPLOYER,systemID:SYSTEM,fleetID:FLEET};
 const wallet=id=>records.get("corporations"+SEP+id).wallet.divisions["1000"];
 return {session,original,policy,records,base,args,wallet,
  preview:(view=true)=>svc.preview(args,{view}),accept:()=>svc.accept(args),
  reinit:()=>svc=createMiningHiring(base),writeCount:()=>writes,
  allow:x=>allowed=x,enable:x=>enabled=x,npc:x=>correctEmployer=x,
  clock:x=>now=x,changeRate:x=>changePolicy=x,badRead:x=>badRead=x,verified:x=>verified=x};
}
test("default-off hiring cannot display or purchase native NPC labour",()=>{
 const x=fixture();x.enable(false);assert.equal(x.preview().status,"NO_NATIVE_EMPLOYER_OFFER");
 assert.equal(x.accept().status,"NO_NATIVE_EMPLOYER_OFFER");assert.equal(x.writeCount(),0);
});
test("original ship counts and server policy determine one visible paid price",()=>{
 const x=fixture();const p=x.preview();
 assert.equal(p.status,"AVAILABLE");assert.equal(p.quote.minerCount,2);
 assert.equal(p.quote.haulerCount,1);assert.equal(p.quote.wageCents,75000);
 assert.equal(p.quote.cycles,3);assert.match(p.quote.operationID,/^coop-mining-shift:[0-9a-f]{32}$/);
 assert.equal(x.writeCount(),0);
});
test("a genuine View then Accept debits real corp wallet once, credits NPC and persists fleet binding",()=>{
 const x=fixture();x.preview();const result=x.accept();
 assert.equal(result.status,"FUNDED");assert.equal(x.wallet(BUYER).balance,450);
 assert.equal(x.wallet(EMPLOYER).balance,750);
 assert.equal(x.wallet(BUYER).journal.length,1);
 assert.equal(x.wallet(EMPLOYER).transactions.length,1);
 assert.equal(x.records.get("coopPlayerMiningFleet"+SEP+SYSTEM+":"+FLEET).operationID,result.operationID);
});
test("direct Accept without agent View cannot debit or hire",()=>{
 const x=fixture();assert.equal(x.accept().status,"REOPEN_AGENT_TO_CONFIRM_WAGE");
 assert.equal(x.wallet(BUYER).balance,1200);assert.equal(x.writeCount(),0);
});
test("second Accept from same opened conversation cannot debit again",()=>{
 const x=fixture();x.preview();assert.equal(x.accept().status,"FUNDED");
 assert.equal(x.accept().status,"NO_NATIVE_EMPLOYER_OFFER");
 assert.equal(x.wallet(BUYER).balance,450);assert.equal(x.wallet(EMPLOYER).balance,750);
});
test("new login/server instance forgets quote and requires Agent reopening",()=>{
 const x=fixture();x.preview();x.reinit();assert.equal(x.accept().status,"REOPEN_AGENT_TO_CONFIRM_WAGE");
});
test("an expired quote never submits a payment",()=>{
 const x=fixture();x.preview();x.clock(230000);
 assert.equal(x.accept().status,"REOPEN_AGENT_TO_CONFIRM_WAGE");assert.equal(x.writeCount(),0);
});
test("revoked native corporate membership or wallet role blocks after View",()=>{
 const x=fixture();x.preview();x.allow(false);
 assert.equal(x.accept().status,"NO_NATIVE_EMPLOYER_OFFER");
 assert.equal(x.writeCount(),0);
});
test("changed NPC employer wage price with same version cannot charge different amount",()=>{
 const x=fixture();x.preview();x.changeRate(true);
 assert.equal(x.accept().status,"REOPEN_AGENT_TO_CONFIRM_WAGE");assert.equal(x.writeCount(),0);
});
test("missing original native fleet, wrong NPC corporation or corrupt GameStore is refused",()=>{
 for(const mutate of [x=>x.npc(false),x=>x.verified(false),x=>x.badRead(true)]){
  const x=fixture();mutate(x);
  assert.equal(x.preview().status,"NO_NATIVE_EMPLOYER_OFFER");assert.equal(x.writeCount(),0);
 }
});
test("original NPC employer cannot change pilot’s server-chosen shift identity",()=>{
 const x=fixture();x.preview();const p=x.preview(false);
 assert.equal(p.quote.operationID,x.preview().quote.operationID);
});
test("locked native fleet is not advertised for another wage payment",()=>{
 const x=fixture();x.records.set("coopPlayerMiningFleet"+SEP+SYSTEM+":"+FLEET,
  {operationID:"foreign",corporationID:BUYER+1});
 assert.equal(x.preview().status,"NO_NATIVE_EMPLOYER_OFFER");
});
test("operator policy rejects unconfigured employer or invalid cycles and overflow",()=>{
 const x=fixture();x.policy.maxCycles=1;
 assert.equal(x.preview().status,"NO_NATIVE_EMPLOYER_OFFER");
 x.policy.maxCycles=6;x.policy.minerCycleCents=1000000000000;
 assert.equal(x.preview().status,"NO_NATIVE_EMPLOYER_OFFER");
});
test("seller policy is explicitly configured server-side and never inferred from a market quote",()=>{
 const file="/world/coop-npc-mining/wage-policy.json";
 const data={version:1,employers:{[EMPLOYER]:{
  enabled:true,revision:1,minerCycleCents:10000,haulerCycleCents:5000,maxCycles:6}}};
 const source=readServerWagePolicy({root:"/world",
  io:{readFileSync:(p)=>{assert.equal(p,file);return JSON.stringify(data)}}});
 assert.equal(source(EMPLOYER).revision,1);
 assert.equal(source(BUYER),null);
 data.employers[EMPLOYER].enabled=false;assert.equal(source(EMPLOYER),null);
});
