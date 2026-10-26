import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeIndustryBindings}=require("../integration/coopNpcIndustryNativeBindings.cjs");
const {createOriginalManufacturingStageExecutor}=require("../integration/coopNpcIndustryOriginalStageExecutor.cjs");
const {createOriginalGameStorePreflight}=require("../integration/coopNpcIndustryOriginalGameStorePreflight.cjs");

const OWNER=1000035,STATION=60010001,SYSTEM=30000142;
const TYPE=215,BP_TYPE=9001,BP_ID=7701,ORE_ID=7702;
const OP="npc-manufacture:"+"a".repeat(32);
const SEP="\u001f",FLAGS={EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",
 EVEJS_COOP_NATIVE_NPC_TX_PROOF:"1",
 EVEJS_COOP_NATIVE_NPC_MANUAL_FACTORY_PROOF:"1"};
function fixture(){
 const previous={};
 for(const [key,val] of Object.entries(FLAGS)){previous[key]=process.env[key];process.env[key]=val;}
 let now=1000000,commits=0,poisoned=false;
 const rows={
  items:new Map(),
  corporationRuntime:new Map(),
  industryBlueprintState:new Map(),
  industryJobs:new Map(),
  identityState:new Map()
 };
 const clone=x=>structuredClone(x);
 const put=(t,k,v)=>rows[t].set(String(k),clone(v));
 const get=(t,k)=>{const v=rows[t].get(String(k));return v===undefined?null:clone(v)};
 put("items",BP_ID,{itemID:BP_ID,typeID:BP_TYPE,categoryID:9,
  ownerID:OWNER,locationID:STATION,flagID:4,singleton:1,quantity:1,stacksize:1});
 put("items",ORE_ID,{itemID:ORE_ID,typeID:34,categoryID:4,
  ownerID:OWNER,locationID:STATION,flagID:4,singleton:0,quantity:50,stacksize:50});
 put("industryBlueprintState","records"+SEP+BP_ID,{
  original:true,jobID:null,typeID:BP_TYPE});
 put("corporationRuntime","corporations"+SEP+OWNER,{corporationID:OWNER,
  wallet:{divisions:{"1000":{balance:100,transactions:[],journal:[]}}}});
 put("industryJobs","_meta",{nextJobID:970000000000000});
 put("identityState","nextItemID",1990000000);
 const plan={ownerID:OWNER,stationID:STATION,facilityID:STATION,
  systemID:SYSTEM,blueprintItemID:BP_ID,blueprintTypeID:BP_TYPE,
  productTypeID:TYPE,runs:1,outputQuantity:30,
  materials:[{typeID:34,quantity:10}]};
 const quote={activityID:1,ownerID:OWNER,blueprintID:BP_ID,
  facilityID:STATION,productTypeID:TYPE,runs:1,timeInSeconds:2,
  materials:clone(plan.materials),outputs:[{typeID:TYPE,quantity:30}],
  cost:10,tax:2.5,totalCost:12.5};
 const txOwner={mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>poisoned,
  transact:(tables,mutation)=>{
   if(poisoned)throw Error("ORIGINAL_WRITER_POISONED");
   const temporary={};
   for(const t of tables)temporary[t]=new Map([...rows[t]].map(([k,v])=>[k,clone(v)]));
   const scoped={
    get(t,k){return temporary[t].has(k)?clone(temporary[t].get(k)):null},
    scan(t){return [...temporary[t]].map(([key,value])=>({key,value:clone(value)}))},
    put(t,k,v){temporary[t].set(String(k),clone(v))},
    del(t,k){temporary[t].delete(String(k))}
   };
   const result=mutation(scoped);
   if(result&&typeof result.then==="function")throw Error("ASYNC_NOT_ALLOWED");
   for(const t of tables)rows[t]=temporary[t];
   commits++;
   return result;
  }};
 const gameStore={coopAtomicNativeRows:txOwner,
  read:(table,key)=>{
   if(table==="industryJobs"&&key==="/jobs"){
    const jobs={};
    for(const [k,v] of rows.industryJobs)
     if(k.startsWith("jobs"+SEP))jobs[String(v.jobID)]=clone(v);
    return{success:true,data:jobs};
   }
   if(table==="corporationRuntime"&&key==="/corporations/"+OWNER)
    return{success:true,data:get("corporationRuntime","corporations"+SEP+OWNER)};
   return{success:false,errorMsg:"ENTRY_NOT_FOUND"};
  }};
 const itemStore={findItemById:id=>get("items",id)};
 const native=createNativeIndustryBindings({gameStore,itemStore,
  resolveCanonicalQuote:()=>clone(quote),
  verifyNativeQuote:()=>true,verifyNativeOwner:()=>true,
  verifyNativeOutput:()=>true,verifyNativeIdFloor:()=>true,
  buildNativeOutputItem:({itemID,typeID,ownerID,locationID,flagID,quantity})=>({
   itemID,typeID,ownerID,locationID,flagID,quantity,stacksize:quantity,
   singleton:0,categoryID:8}),
  clock:()=>now});
 const preflight=createOriginalGameStorePreflight({gameStore,itemStore,
  env:process.env,clock:()=>now});
 const createStage=()=>createOriginalManufacturingStageExecutor({
  native,env:process.env,clock:()=>now,
  assertOriginalGameStore:preflight.assertOriginalGameStore});
 const run=(stage,s=createStage())=>s.run({stage,ownerID:OWNER,stationID:STATION,
  operationID:OP,plan});
 const wallet=()=>get("corporationRuntime","corporations"+SEP+OWNER)
  .wallet.divisions["1000"].balance;
 return{run,createStage,native,plan,rows,get,put,wallet,
  setNow:v=>now=v,setPoisoned:v=>poisoned=v,
  get commits(){return commits},
  close(){for(const [k,v] of Object.entries(previous))
    if(v===undefined)delete process.env[k];else process.env[k]=v}};
}
test("real source native kernels debit original minerals+ISK once then survive restart",()=>{
 const f=fixture();try{
  const stage=f.createStage();
  const first=f.run("INSTALL",stage);
  assert.equal(first.status,"INSTALLED");
  assert.equal(f.get("items",ORE_ID).quantity,40);
  assert.equal(f.wallet(),87.5);
  const jobs=f.get("industryJobs","jobs"+SEP+first.jobID);
  assert.equal(jobs.coopOperationID,OP);
  assert.equal(jobs.status,1);
  // Real COOP-032B/E source now persists exact physical material debits in
  // the SAME native industry job SQLite commit as the wallet/BPO charge.
  assert.deepEqual(jobs.coopMaterialDebits,[{
   itemID:ORE_ID,typeID:34,ownerID:OWNER,stationID:STATION,
   beforeQuantity:50,consumedQuantity:10,afterQuantity:40,
   sourceCustomInfo:null
  }]);
  // Cold-process simulation: a new stage helper reads the ORIGINAL
  // GameStore operation ID; it must never allocate another job or charge.
  const restarted=f.createStage();
  assert.equal(f.run("INSTALL",restarted).status,"ALREADY_INSTALLED");
  assert.equal(f.wallet(),87.5);
  assert.equal(f.get("items",ORE_ID).quantity,40);
  assert.deepEqual(f.get("industryJobs","jobs"+SEP+first.jobID).coopMaterialDebits,
   jobs.coopMaterialDebits);
  assert.equal([...f.rows.industryJobs.keys()].filter(k=>k.startsWith("jobs"+SEP)).length,1);
  assert.equal(f.get("industryBlueprintState","records"+SEP+BP_ID).jobID,first.jobID);
 }finally{f.close()}
});
test("real native READY respects original endDate and delivers one ItemStore output",()=>{
 const f=fixture();try{
  const first=f.run("INSTALL");
  assert.equal(first.status,"INSTALLED");
  const early=f.run("MARK_READY");
  assert.equal(early.status,"BLOCKED");
  assert.equal(early.detail,"NATIVE_JOB_NOT_YET_READY");
  f.setNow(1005000);
  const ready=f.run("MARK_READY");assert.equal(ready.status,"READY");
  const delivered=f.run("DELIVER");
  assert.equal(delivered.status,"DELIVERED");
  assert.equal(delivered.quantity,30);
  const output=f.get("items",delivered.itemID);
  assert.equal(output.typeID,TYPE);assert.equal(output.quantity,30);
  assert.equal(output.customInfo,"coop-industry:v1:"+first.jobID);
  assert.equal(f.get("industryBlueprintState","records"+SEP+BP_ID).jobID,null);
  assert.equal(f.get("items",BP_ID).locationID,STATION);
  assert.equal(f.wallet(),87.5);
  const restarted=f.createStage();
  assert.equal(f.run("DELIVER",restarted).status,"ALREADY_DELIVERED");
  assert.equal([...f.rows.items.values()].filter(x=>x.typeID===TYPE).length,1);
  assert.equal(f.get("identityState","nextItemID"),output.itemID+1);
 }finally{f.close()}
});
test("original SQLite poison/probe blocks manual native writing without a debit",()=>{
 const f=fixture();try{
  f.setPoisoned(true);
  const result=f.run("INSTALL");
  assert.equal(result.reason,"LW04C2_NATIVE_GAMESTORE_NOT_QUIESCENT");
  assert.equal(f.wallet(),100);
  assert.equal(f.get("items",ORE_ID).quantity,50);
  assert.equal(f.commits,0);
 }finally{f.close()}
});
test("actual original source job with changed wallet transaction fails source readback",()=>{
 const f=fixture();try{
  const first=f.run("INSTALL");assert.equal(first.status,"INSTALLED");
  const corp=f.get("corporationRuntime","corporations"+SEP+OWNER);
  corp.wallet.divisions["1000"].transactions[0].amount=-999;
  f.put("corporationRuntime","corporations"+SEP+OWNER,corp);
  const result=f.run("INSPECT");
  assert.equal(result.status,"NEEDS_OPERATOR_REPAIR");
  assert.equal(result.reason,"NATIVE_INDUSTRY_DEBIT_MISMATCH");
 }finally{f.close()}
});
