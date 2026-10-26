import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createIndustryRecoveryFence}=require("../integration/coopNpcIndustryRecoveryFence.cjs");
const ID="npc-manufacture:"+"a".repeat(32);
const OWNER=1000035,STATION=60010001,TYPE=215,BPO=17711,ITEM=1998001,JOB=9701,ORDER=20001;
const plan={ownerID:OWNER,stationID:STATION,productTypeID:TYPE,blueprintItemID:BPO,
 outputQuantity:500};
function fixture(phase="PREPARED"){
 const entry={operationID:ID,ownerID:OWNER,stationID:STATION,typeID:TYPE,
  createdAt:100,phase,plan:{...plan},jobID:JOB,installCostCents:1250,
  itemID:ITEM,quantity:500,orderID:ORDER};
 const job={jobID:JOB,coopOperationID:ID,ownerID:OWNER,stationID:STATION,
  activityID:1,blueprintID:BPO,productTypeID:TYPE,status:phase==="INSTALLED"?1:
   phase==="READY"?3:4,
  coopDelivery:{operationID:ID,itemID:ITEM,quantity:500}};
 const debit={verifiedNative:true,jobID:JOB,ownerID:OWNER,transactionID:JOB,
  amountCents:1250};
 const item={itemID:ITEM,ownerID:OWNER,typeID:TYPE,locationID:STATION,
  flagID:4,singleton:0,quantity:500,stacksize:500,
  customInfo:"coop-industry:v1:"+JOB};
 const order={orderID:ORDER,ownerID:OWNER,stationID:STATION,typeID:TYPE,
  sourceItemID:ITEM,originalQuantity:500,remainingQuantity:0,nativeEscrowVerified:true};
 const sales=[{orderID:ORDER,ownerID:OWNER,typeID:TYPE,quantity:500,
  transactionID:3001,price:2,nativeWalletSettled:true}];
 const wallet={verifiedNative:true,transactionID:3001,ownerID:OWNER,
  orderID:ORDER,amountCents:100000};
 const journal={version:1,entries:{[ID]:entry},history:{}};
 const called=[];
 const director={inspect:()=>{called.push("inspect");return structuredClone(journal)}};
 const native={
  getJob:id=>{called.push("job");return phase==="PREPARED"?null:job},
  getItem:id=>{called.push("item");return item},
  getIndustryDebit:id=>{called.push("debit");return debit}
 };
 const market={
  getOrder:id=>{called.push("order");return order},
  getSaleEvidence:id=>{called.push("sales");return sales},
  getWalletEntry:id=>{called.push("wallet");return wallet}
 };
 const fence=createIndustryRecoveryFence({director,native,market,clock:()=>1000});
 return{entry,job,debit,item,order,sales,wallet,journal,called,director,
  native,market,fence,
  audit:()=>fence.audit({ownerID:OWNER,stationID:STATION})};
}
test("an empty original durable journal is read-only and READY",()=>{
 const f=fixture();f.journal.entries={};
 const result=f.audit();assert.equal(result.status,"READY");
 assert.equal(result.scoped,0);assert.equal(result.readOnly,true);
 assert.equal(result.nativeMutation,false);
 assert.deepEqual(f.called,["inspect","inspect"]);
});
test("PREPARED without original job is safe to inspect, not a native debit",()=>{
 const f=fixture();const result=f.audit();
 assert.equal(result.status,"READY");assert.equal(result.prepared,1);
 assert.equal(result.verified,0);assert.deepEqual(f.called,["inspect","job","inspect"]);
});
test("PREPARED with an already installed original job is quarantined",()=>{
 const f=fixture();f.native.getJob=()=>f.job;
 assert.equal(f.audit().reason,"NPC_INDUSTRY_RECOVERY_PREPARED_HAS_JOB");
});
test("every uncertain original transaction or Rust outcome prevents new writes",()=>{
 for(const phase of ["INSTALL_UNKNOWN","DELIVERY_UNKNOWN","LIST_UNKNOWN","REPAIR_REQUIRED"]){
  const f=fixture(phase),result=f.audit();
  assert.equal(result.status,"BLOCKED");
  assert.equal(result.reason,"NPC_INDUSTRY_RECOVERY_OUTCOME_UNKNOWN");
  assert.equal(result.operationID,ID);
  assert.deepEqual(f.called,["inspect"]);
 }
});
test("INSTALLED job requires one verified native GameStore industry debit",()=>{
 const f=fixture("INSTALLED");
 assert.equal(f.audit().status,"READY");
 f.debit.amountCents++;
 assert.equal(f.audit().reason,"NPC_INDUSTRY_RECOVERY_DEBIT_NOT_ATTESTED");
});
test("PAUSED is original WIP; READY cannot be inferred from status 2",()=>{
 const f=fixture("INSTALLED");f.job.status=2;
 assert.equal(f.audit().status,"READY");
 f.entry.phase="READY";
 assert.equal(f.audit().reason,"NPC_INDUSTRY_RECOVERY_JOB_PHASE_CONFLICT");
});
test("DELIVERED must still exist as same original warehouse ItemStore stack",()=>{
 const f=fixture("DELIVERED");
 assert.equal(f.audit().status,"READY");
 f.item.ownerID++;
 assert.equal(f.audit().reason,"NPC_INDUSTRY_RECOVERY_HANGAR_ITEM_MISSING");
});
test("LISTED reconciles original Rust order and its source ItemStore ID",()=>{
 const f=fixture("LISTED");f.order.remainingQuantity=350;
 assert.equal(f.audit().status,"READY");
 f.order.sourceItemID++;
 assert.equal(f.audit().reason,"NPC_INDUSTRY_RECOVERY_MARKET_ESCROW_INVALID");
});
test("SOLD must exactly conserve quantity and original wallet settlement",()=>{
 const f=fixture("SOLD");f.entry.soldQuantity=500;f.entry.revenueCents=100000;
 const ok=f.audit();assert.equal(ok.status,"READY");assert.equal(ok.sold,1);
 f.wallet.amountCents--;
 assert.equal(f.audit().reason,"NPC_INDUSTRY_RECOVERY_WALLET_UNVERIFIED");
});
test("duplicate market fills cannot replay financial transactions",()=>{
 const f=fixture("SOLD");f.entry.soldQuantity=500;f.entry.revenueCents=100000;
 f.sales.push({...f.sales[0]});
 assert.equal(f.audit().reason,"NPC_INDUSTRY_RECOVERY_FILL_UNVERIFIED");
});
test("original journal changing during Rust/ItemStore read is not a stable proof",()=>{
 const f=fixture("INSTALLED");let n=0;
 f.director.inspect=()=>{n++;return {...structuredClone(f.journal),version:n===1?1:2}};
 assert.equal(f.audit().reason,"NPC_INDUSTRY_RECOVERY_JOURNAL_CHANGED_DURING_READ");
});
test("foreign original corporation is not mistaken for our paid station jobs",()=>{
 const f=fixture("INSTALL_UNKNOWN");f.entry.ownerID=OWNER+1;
 f.entry.plan.ownerID=OWNER+1;
 const result=f.audit();assert.equal(result.status,"READY");
 assert.equal(result.scoped,0);
});
test("missing job, malformed journal, or excessive entries block native ACT",()=>{
 const f=fixture("INSTALLED");f.native.getJob=()=>null;
 assert.equal(f.audit().reason,"NPC_INDUSTRY_RECOVERY_JOB_NOT_ATTESTED");
 const g=fixture();g.journal.version=2;
 assert.equal(g.audit().reason,"NPC_INDUSTRY_RECOVERY_JOURNAL_INVALID");
 const h=fixture();const limited=createIndustryRecoveryFence({
  director:h.director,native:h.native,market:h.market,maxEntries:1,clock:()=>1000
 });
 h.journal.entries["npc-manufacture:"+"b".repeat(32)]={...h.entry,
  operationID:"npc-manufacture:"+"b".repeat(32)};
 assert.equal(limited.audit({ownerID:OWNER,stationID:STATION}).reason,
  "NPC_INDUSTRY_RECOVERY_JOURNAL_BUDGET_EXCEEDED");
});
test("asynchronous original source getter cannot be treated as atomic observation",()=>{
 const f=fixture("INSTALLED");f.native.getIndustryDebit=()=>Promise.resolve(f.debit);
 assert.match(f.audit().reason,/NPC_INDUSTRY_RECOVERY_AUTHORITY_UNAVAILABLE/);
});
test("read-only fence contains no scheduler, SQLite transaction or native mutation path",()=>{
 const content=fs.readFileSync(new URL("../integration/coopNpcIndustryRecoveryFence.cjs",import.meta.url),"utf8");
 assert.doesNotMatch(content,/\bsetInterval\s*\(|\bsetTimeout\s*\(/);
 assert.doesNotMatch(content,/\.transact\(|\.installOnce\(|\.deliverOnce\(|\.listOnce\(/);
});
