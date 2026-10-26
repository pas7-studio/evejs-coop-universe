import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createOriginalManufacturingStageExecutor}=require("../integration/coopNpcIndustryOriginalStageExecutor.cjs");
const {createOriginalGameStorePreflight}=require("../integration/coopNpcIndustryOriginalGameStorePreflight.cjs");
const ID="npc-manufacture:"+"a".repeat(32),OWNER=1000035,STATION=60010001,BPO=7701,TYPE=215,JOB=970000000000000;
const FLAGS={EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",EVEJS_COOP_NATIVE_NPC_TX_PROOF:"1",
 EVEJS_COOP_NATIVE_NPC_MANUAL_FACTORY_PROOF:"1"};
function fixture(env=FLAGS){
 let quoteCalls=0,installs=0,readies=0,deliveries=0,unknown=false;
 let job=null,output=null;
 const plan={ownerID:OWNER,stationID:STATION,facilityID:STATION,
  blueprintItemID:BPO,productTypeID:TYPE,outputQuantity:30};
 const quote={verifiedNative:true,totalCost:12.5,ownerID:OWNER,
  facilityID:STATION,blueprintID:BPO,productTypeID:TYPE};
 const native={mode:"MANUAL_NATIVE_GAMESTORE_ONLY",supportsLiveRuntime:false,
  quote:()=>{quoteCalls++;return quote},
  getJob:op=>op===ID?job:null,
  getItem:id=>id===output?.itemID?output:null,
  getIndustryDebit:id=>job&&id===JOB?{verifiedNative:true,jobID:JOB,
   ownerID:OWNER,transactionID:JOB,amountCents:1250}:null,
  installOnce:(p,q,op)=>{
   installs++;
   if(unknown)throw Error("NATIVE_SQLITE_COMMIT_OUTCOME_UNKNOWN");
   if(job)throw Error("DUPLICATE_NATIVE_JOB");
   job={jobID:JOB,coopOperationID:op,ownerID:OWNER,
    stationID:STATION,facilityID:STATION,activityID:1,
    blueprintID:BPO,productTypeID:TYPE,totalCost:12.5,status:1};
   return {status:"INSTALLED",jobID:JOB};
  },
  markReadyOnce:op=>{readies++;job.status=3;return{status:"READY",jobID:JOB}},
  deliverOnce:op=>{
   deliveries++;job.status=4;
   job.coopDelivery={operationID:op,itemID:1990000001,quantity:30};
   output={itemID:1990000001,ownerID:OWNER,typeID:TYPE,
    locationID:STATION,flagID:4,singleton:0,quantity:30,stacksize:30,
    customInfo:"coop-industry:v1:"+JOB};
   return {status:"DELIVERED",jobID:JOB,itemID:1990000001,quantity:30};
  }};
 let authoritative=true;
 const originalGameStore={read:(table,path)=>{
  if(!authoritative)return{success:false};
  if(table==="industryJobs"&&path==="/jobs")return{success:true,data:{}};
  if(table==="corporationRuntime"&&path==="/corporations/"+OWNER)
   return{success:true,data:{corporationID:OWNER,wallet:{divisions:{"1000":{balance:100}}}}};
  return{success:false};
 },coopAtomicNativeRows:{mode:"SERVER_INTERNAL_FLAGGED",
   transact:()=>{throw Error("DO_NOT_CALL_IN_PREFLIGHT")},isPoisoned:()=>false}};
 const witness=createOriginalGameStorePreflight({
  gameStore:originalGameStore,itemStore:{findItemById:()=>output},
  env,clock:()=>100});
 const stage=createOriginalManufacturingStageExecutor({
  native,env,assertOriginalGameStore:witness.assertOriginalGameStore,
  clock:()=>100});
 const execute=(stageName,more={})=>stage.run({
  ownerID:OWNER,stationID:STATION,operationID:ID,
  stage:stageName,plan,...more});
 return {native,plan,quote,stage,execute,originalGameStore,
  setUntrusted:()=>authoritative=false,
  setUnknown:()=>unknown=true,
  setJob:x=>job=x,
  get job(){return job},get output(){return output},
  get installs(){return installs},get readies(){return readies},
  get deliveries(){return deliveries},get quoteCalls(){return quoteCalls}};
}
test("manual native source stage is disabled without every explicit safety flag",()=>{
 for(const key of Object.keys(FLAGS)){
  const f=fixture({...FLAGS,[key]:"0"});
  assert.equal(f.execute("INSTALL").reason,"LW04C2_MANUAL_NATIVE_FINANCE_DISABLED");
  assert.equal(f.installs,0);
 }
});
test("automatic A-Life, legacy scheduler or independent NPC market conflict blocks",()=>{
 for(const key of ["EVEJS_COOP_ALIFE_ECONOMY_ACT",
  "EVEJS_COOP_NATIVE_NPC_ECONOMY_SCHEDULER","EVEJS_COOP_NATIVE_NPC_MARKET"]){
  const f=fixture({...FLAGS,[key]:"1"});
  assert.equal(f.execute("INSTALL").status,"BLOCKED");
  assert.equal(f.installs,0);
 }
});
test("native manual stage calls original install once and proves job/wallet debit",()=>{
 const f=fixture();
 assert.equal(f.execute("INSTALL").status,"INSTALLED");
 assert.equal(f.installs,1);
 assert.equal(f.execute("INSTALL").status,"ALREADY_INSTALLED");
 assert.equal(f.installs,1);
});
test("original GameStore READY and ItemStore delivery is exactly once",()=>{
 const f=fixture();
 assert.equal(f.execute("INSTALL").status,"INSTALLED");
 assert.equal(f.execute("MARK_READY").status,"READY");
 assert.equal(f.execute("MARK_READY").status,"ALREADY_READY");
 assert.equal(f.readies,1);
 assert.equal(f.execute("DELIVER").status,"DELIVERED");
 assert.equal(f.execute("DELIVER").status,"ALREADY_DELIVERED");
 assert.equal(f.deliveries,1);
 assert.equal(f.execute("INSPECT").status,"ORIGINAL_DELIVERY_ATTESTED");
});
test("non-READY original industry job cannot receive an output item",()=>{
 const f=fixture();f.execute("INSTALL");
 assert.equal(f.execute("DELIVER").reason,"LW04C2_JOB_NOT_READY");
 assert.equal(f.deliveries,0);
 f.job.status=2;
 assert.equal(f.execute("MARK_READY").reason,"LW04C2_JOB_PAUSED");
 assert.equal(f.readies,0);
});
test("unverified canonical native quote blocks actual material and wallet debit",()=>{
 const f=fixture();f.quote.ownerID++;
 assert.equal(f.execute("INSTALL").reason,"LW04C2_ORIGINAL_QUOTE_UNVERIFIED");
 assert.equal(f.installs,0);
});
test("changed original corporation wallet debit quarantines after revalidation",()=>{
 const f=fixture();f.execute("INSTALL");
 f.job.totalCost=99;
 const res=f.execute("INSPECT");
 assert.equal(res.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.execute("MARK_READY").reason,"LW04C2_STATION_QUARANTINED");
 assert.equal(f.readies,0);
});
test("unknown native COMMIT is quarantined; no automatic retry",()=>{
 const f=fixture();f.setUnknown();
 assert.equal(f.execute("INSTALL").status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.execute("INSTALL").reason,"LW04C2_STATION_QUARANTINED");
 assert.equal(f.installs,1);
});
test("original ItemStore item moved/changed after delivery cannot be duplicated",()=>{
 const f=fixture();f.execute("INSTALL");f.execute("MARK_READY");f.execute("DELIVER");
 f.output.ownerID++;
 assert.equal(f.execute("INSPECT").status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.execute("DELIVER").reason,"LW04C2_STATION_QUARANTINED");
 assert.equal(f.deliveries,1);
});
test("unavailable original source read blocks all material-consuming stages",()=>{
 const f=fixture();f.setUntrusted();
 assert.equal(f.execute("INSTALL").reason,"LW04C2_NATIVE_GAMESTORE_NOT_QUIESCENT");
 assert.equal(f.installs,0);
});
test("unknown LIST_OUTPUT stage cannot mint or list on Rust without adapter",()=>{
 const f=fixture();
 assert.equal(f.execute("LIST_OUTPUT").reason,"LW04C2_INVALID_ORIGINAL_REQUEST");
 assert.equal(f.installs,0);
});
test("executor remains manual and does not introduce timer, wallet or market database",()=>{
 const a=fs.readFileSync(new URL("../integration/coopNpcIndustryOriginalStageExecutor.cjs",import.meta.url),"utf8");
 const b=fs.readFileSync(new URL("../integration/coopNpcIndustryOriginalGameStorePreflight.cjs",import.meta.url),"utf8");
 for(const src of [a,b]){
  assert.doesNotMatch(src,/setInterval\s*\(|setTimeout\s*\(/);
  assert.doesNotMatch(src,/\.transact\(|\.listOnce\(|\bINSERT INTO\b/);
 }
});
