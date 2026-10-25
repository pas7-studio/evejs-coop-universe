import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeIndustryBindings}=require("../integration/coopNpcIndustryNativeBindings.cjs");
const OWNER=1000010,JOB=970000000000000,OP="npc-manufacture:a01fca9826144cc6bb3c942c881a7e31";
function fixture(){
 const job={jobID:JOB,ownerID:OWNER,blueprintID:91,productTypeID:215,coopOperationID:OP,totalCost:11.13,status:1};
 const entry={transactionID:JOB,entryTypeID:10,ownerID1:OWNER,referenceID:JOB,accountKey:1000,amount:-11.13,balance:108.87};
 const db={industryJobs:{jobs:{[JOB]:job}},corporationRuntime:{corporations:{[OWNER]:{corporationID:OWNER,wallet:{divisions:{"1000":{transactions:[entry]}}}}}}};
 const gameStore={read:(t,p)=>{
  const parts=p.split("/").filter(Boolean);let value=db[t];for(const part of parts)value=value?.[part];
  return value===undefined?{success:false}:{success:true,data:value};
 },coopAtomicNativeRows:{transact:()=>{throw Error("NO_RUNTIME_MUTATIONS")}}};
 const itemStore={findItemById:id=>id===91?{itemID:91,ownerID:OWNER,locationID:60000001}:null};
 const authorities={resolveCanonicalQuote:()=>({ownerID:OWNER,stationID:60000001,totalCost:11.13}),
  verifyNativeQuote:()=>true,verifyNativeOwner:()=>true,verifyNativeOutput:()=>true,
  verifyNativeIdFloor:()=>true,buildNativeOutputItem:()=>({})};
 return {job,entry,db,gameStore,itemStore,authorities,binding:()=>createNativeIndustryBindings({gameStore,itemStore,...authorities})};
}
test("native job lookup and operation identity",()=>{const f=fixture(),b=f.binding();
 assert.equal(b.getJob(OP).jobID,JOB);assert.equal(b.getJob("npc-manufacture:deadbeef"),null);
});
test("actual corporate debit converted into exact cents, with no credit mutation",()=>{const f=fixture(),b=f.binding();
 assert.deepEqual(b.getIndustryDebit(JOB),{verifiedNative:true,jobID:JOB,ownerID:OWNER,amountCents:1113,transactionID:JOB});
});
test("duplicate debit entries rejected",()=>{const f=fixture();
 f.db.corporationRuntime.corporations[OWNER].wallet.divisions["1000"].transactions.push({...f.entry});
 assert.throws(()=>f.binding().getIndustryDebit(JOB),/DEBIT_DUPLICATE/);
});
test("wrong debit amount is rejected",()=>{const f=fixture();f.entry.amount=-10;
 assert.throws(()=>f.binding().getIndustryDebit(JOB),/DEBIT_MISMATCH/);
});
test("wrong wallet division/account key rejected",()=>{const f=fixture();f.entry.accountKey=1001;
 assert.throws(()=>f.binding().getIndustryDebit(JOB),/DEBIT_MISMATCH/);
});
test("native job row key mismatches cannot be promoted to verified job",()=>{const f=fixture();f.job.jobID=JOB+1;
 assert.throws(()=>f.binding().getJob(OP),/JOB_KEY_OR_OWNER/);
});
test("noncanonical SDE quote cannot be labeled verified",()=>{const f=fixture();f.authorities.verifyNativeQuote=()=>false;
 assert.equal(f.binding().quote({ownerID:OWNER,stationID:60000001}),null);
});
test("trusted quote comes only from canonical native authority",()=>{const f=fixture();
 assert.equal(f.binding().quote({ownerID:OWNER,stationID:60000001}).verifiedNative,true);
});
test("missing real authority dependencies fail at construction",()=>{const f=fixture();
 assert.throws(()=>createNativeIndustryBindings({gameStore:f.gameStore,itemStore:f.itemStore}),/BINDINGS_REQUIRED/);
});
