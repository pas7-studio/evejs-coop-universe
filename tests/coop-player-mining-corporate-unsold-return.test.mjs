import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createCorporateUnsoldReturn}=require("../integration/coopPlayerMiningCorporateUnsoldReturn.cjs");
const SEP="\u001f",CORP=5001,BUYER=8123,ITEM=190003,CARGO=7773,
 ORDER="9521",SYSTEM=30000144,STATION=60001,OFFICE=64001,
 SHIFT="coop-mining-shift:"+"a".repeat(32),ESCROW=9200000000+9521;
function fixture({sold=3}={}){
 const left=8-sold,session={characterID:155,corporationID:CORP,socket:{destroyed:false}};
 let enabled=true,valid=true,role=true,poison=false,unknown=false,writes=0;
 const physical={itemID:ITEM,ownerID:CORP,locationID:ESCROW,
  flagID:4,typeID:34,quantity:left,stacksize:left,singleton:0,
  customInfo:"coop-warehouse:v1:cargo:"+CARGO};
 const receipt={version:1,phase:sold?"ACTIVE_SELL":"ESCROW_BOUND_UNSETTLED",
  operationID:SHIFT,cargoID:CARGO,orderID:ORDER,corporationID:CORP,
  itemID:ITEM,typeID:34,stationID:STATION,originalLocationID:OFFICE,
  originalFlagID:115,escrowLocationID:ESCROW,quantity:8,
  ...(sold?{remainingQuantity:left,settledCycles:1,lastSettledCycle:1}:{})};
 const escrow={orderId:ORDER,isCorp:true,escrowType:"sell",ownerId:CORP,
  escrowLocationID:ESCROW,remainingQuantity:left,sourceItemIDs:[ITEM],
  phase:sold?"ACTIVE_SELL":"ESCROW_BOUND_UNSETTLED"};
 const records={items:new Map([[String(ITEM),physical]]),
  corporationRuntime:new Map([["coopPlayerMiningCorpSell"+SEP+CARGO,receipt]]),
  marketEscrow:new Map([[ORDER,escrow]])};
 const proof={verifiedNative:true,phase:"CANCEL_LOCKED",cancelled:false,
  orderID:ORDER,corporationID:CORP,cargoID:CARGO,shiftID:SHIFT,
  sourceItemID:ITEM,remainingQuantity:left,
  stationID:STATION,typeID:34,settledCycles:sold?1:0};
 const atom={mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>poison,
  transact(tables,fn){
   assert.deepEqual(tables,["items","marketEscrow","corporationRuntime"]);
   const copy=Object.fromEntries(tables.map(t=>[t,structuredClone([...records[t]])]));
   const tx={get:(t,k)=>records[t].get(k)||null,
    scan:t=>[...records[t]].map(([key,value])=>({key,value})),
    put(t,k,v){records[t].set(k,structuredClone(v));writes++}};
   try{const result=fn(tx);if(unknown)throw Error("ACK_LOST");return result}
   catch(e){if(!unknown)for(const t of tables)records[t]=new Map(copy[t]);throw e}
  }};
 const svc=createCorporateUnsoldReturn({gameStore:{coopAtomicNativeRows:atom},
  access:{isMember:()=>role,canIndustry:()=>role,
   canWallet:()=>role,canTake:()=>role},
  readNativeCancelLock:()=>valid?proof:null,
  enabled:()=>enabled,clock:()=>1793030000000});
 const run=()=>svc.returnRemaining({session,corporationID:CORP,
  operationID:SHIFT,cargoID:CARGO,orderID:ORDER});
 return {run,records,svc,session,proof,receipt,escrow,physical,
  item:()=>records.items.get(String(ITEM)),
  getReceipt:()=>records.corporationRuntime.get("coopPlayerMiningCorpSell"+SEP+CARGO),
  getEscrow:()=>records.marketEscrow.get(ORDER),
  writes:()=>writes,enabled:v=>enabled=v,valid:v=>valid=v,
  role:v=>role=v,poison:v=>poison=v,unknown:v=>unknown=v};
}
test("returns only 5 unsold units after prior released 3-unit sale",()=>{
 const x=fixture(),result=x.run();
 assert.equal(result.status,"RETURNED_UNSOLD");
 assert.equal(result.returnedQuantity,5);assert.equal(result.settledCycles,1);
 assert.equal(result.refundedISK,false);
 assert.equal(x.item().ownerID,CORP);assert.equal(x.item().itemID,ITEM);
 assert.equal(x.item().locationID,OFFICE);assert.equal(x.item().flagID,115);
 assert.equal(x.item().quantity,5);
 assert.equal(x.getReceipt().returnedQuantity,5);
 assert.equal(x.getReceipt().remainingQuantity,0);
 assert.equal(x.getEscrow().remainingQuantity,0);
 assert.equal(x.writes(),3);
});
test("zero-fill cancellation returns all eight original units, never sale proceeds",()=>{
 const x=fixture({sold:0}),r=x.run();
 assert.equal(r.status,"RETURNED_UNSOLD");assert.equal(r.returnedQuantity,8);
 assert.equal(r.settledCycles,0);assert.equal(r.refundedISK,false);
});
test("disabled feature does not touch original stock or wallet",()=>{
 const x=fixture();x.enabled(false);
 assert.equal(x.run().reason,"CORP_UNSOLD_RETURN_DISABLED");
 assert.equal(x.writes(),0);assert.equal(x.item().locationID,ESCROW);
});
test("no real independent Rust cancellation lock => no return",()=>{
 const x=fixture();x.valid(false);
 assert.equal(x.run().reason,"CORP_UNSOLD_RUST_LOCK_INVALID");
 assert.equal(x.writes(),0);
});
test("Rust cancellation lock must match exact original corp, order and source",()=>{
 for(const change of [x=>x.proof.orderID="9522",
  x=>x.proof.corporationID=BUYER,
  x=>x.proof.cargoID=CARGO+1,
  x=>x.proof.shiftID="coop-mining-shift:"+"b".repeat(32),
  x=>x.proof.remainingQuantity=6,
  x=>x.proof.settledCycles=2,
  x=>x.proof.phase="CANCELLED"]){
  const x=fixture();change(x);
  assert.ok(x.run().status==="BLOCKED");
  assert.equal(x.writes(),0);
 }
});
test("unknown, altered or transferred native source cargo cannot return",()=>{
 for(const change of [
   x=>x.item().quantity=4,
   x=>x.item().ownerID=BUYER,
   x=>x.item().locationID=OFFICE,
   x=>x.getEscrow().remainingQuantity=8,
   x=>x.getReceipt().lastSettledCycle=0,
   x=>x.item().customInfo="fake-origin",
   x=>x.getReceipt().phase="FULLY_SOLD"
 ]){
  const x=fixture();change(x);
  assert.equal(x.run().reason,"CORP_UNSOLD_ATOMIC_RETURN_OUTCOME_UNKNOWN");
  assert.equal(x.writes(),0);
 }
});
test("duplicate cargo marker in another original item prevents unsold title release",()=>{
 const x=fixture();
 x.records.items.set(String(ITEM+1),{...x.item(),itemID:ITEM+1});
 assert.equal(x.run().reason,"CORP_UNSOLD_ATOMIC_RETURN_OUTCOME_UNKNOWN");
 assert.equal(x.writes(),0);
});
test("revoked corporate office TAKE rights block return",()=>{
 const x=fixture();x.role(false);
 assert.equal(x.run().reason,"CORP_UNSOLD_ATOMIC_RETURN_OUTCOME_UNKNOWN");
 assert.equal(x.item().locationID,ESCROW);
});
test("repeated return never creates more than one physical stack",()=>{
 const x=fixture();assert.equal(x.run().status,"RETURNED_UNSOLD");
 const n=x.writes();
 assert.equal(x.run().reason,"CORP_UNSOLD_ATOMIC_RETURN_OUTCOME_UNKNOWN");
 assert.equal(x.writes(),n);
 assert.equal(x.item().quantity,5);
});
test("unknown SQLite COMMIT fences retries and keeps original cargo identity",()=>{
 const x=fixture();x.unknown(true);
 assert.equal(x.run().reason,"CORP_UNSOLD_ATOMIC_RETURN_OUTCOME_UNKNOWN");
 assert.deepEqual(x.svc.requiresOperatorReconciliation(),[ORDER]);
 x.unknown(false);
 assert.equal(x.run().reason,"CORP_UNSOLD_SCOPE_OR_OUTCOME_UNKNOWN");
 assert.equal(x.item().itemID,ITEM);
});
test("poisoned GameStore prevents return without checking a client-supplied status",()=>{
 const x=fixture();x.poison(true);
 assert.equal(x.run().reason,"CORP_UNSOLD_SCOPE_OR_OUTCOME_UNKNOWN");
 assert.equal(x.writes(),0);
});
test("successful return never changes earlier paid fill evidence in GameStore",()=>{
 const x=fixture();const key="coopPlayerMiningCorpFill"+SEP+ORDER+":1";
 x.records.corporationRuntime.set(key,{version:1,phase:"GAMESTORE_COMMITTED",
  quantity:3,netRevenueCents:705});
 x.run();assert.deepEqual(x.records.corporationRuntime.get(key),
  {version:1,phase:"GAMESTORE_COMMITTED",quantity:3,netRevenueCents:705});
});
