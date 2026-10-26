import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createCorporateCancelLifecycle}=require("../integration/coopPlayerMiningCorporateCancelLifecycle.cjs");
const ORDER="9521",CORP=5001,CARGO=7773,ITEM=190003,
 SHIFT="coop-mining-shift:"+"a".repeat(32);
function fixture(){
 const session={characterID:4004,corporationID:CORP,socket:{destroyed:false}};
 const calls=[];let enabled=true,broken=null,returned=0,valid=true;
 const locked={verifiedNative:true,phase:"CANCEL_LOCKED",cancelled:false,
  orderID:ORDER,corporationID:CORP,cargoID:CARGO,
  shiftID:SHIFT,sourceItemID:ITEM,remainingQuantity:5,
  settledCycles:1,stationID:60001,typeID:34};
 const done={orderID:ORDER,phase:"CANCELLED",corporationID:CORP,
  sourceItemID:ITEM,remainingReturned:5,settledCycles:1,
  verifiedGameStore:true};
 const replies={LockCorpSellCancel:locked,GetCorpSellCancel:locked,
  FinalizeCorpSellCancel:done};
 const client={async call(method,args){
  calls.push(method);assert.equal(args.order_id,ORDER);
  assert.equal(args.access_token,"X".repeat(40));
  if(method===broken)throw Error("UNKNOWN_ACK");
  return replies[method];
 }};
 const svc=createCorporateCancelLifecycle({marketClient:client,
  unsoldReturn:{returnRemaining(){
   returned++;
   return {status:"RETURNED_UNSOLD",orderID:ORDER,
    originalItemID:ITEM,returnedQuantity:5,settledCycles:1,
    refundedISK:false};
  }},token:"X".repeat(40),enabled:()=>enabled});
 const run=()=>svc.cancelOriginalUnsold({session,corporationID:CORP,
  operationID:SHIFT,cargoID:CARGO,orderID:ORDER});
 return {svc,run,calls,replies,locked,done,session,
   returned:()=>returned,enabled:x=>enabled=x,broken:x=>broken=x};
}
test("native corporate Rust lock then physical remainder return then independent finalize",async()=>{
 const x=fixture(),r=await x.run();
 assert.equal(r.status,"CORP_CANCELLED_UNSOLD_RETURNED");
 assert.equal(r.returnedQuantity,5);assert.equal(r.previousSettledCycles,1);
 assert.equal(r.refundedISK,false);
 assert.deepEqual(x.calls,["LockCorpSellCancel","GetCorpSellCancel","FinalizeCorpSellCancel"]);
 assert.equal(x.returned(),1);
});
test("replay of completed corporate cancel cannot return ore twice",async()=>{
 const x=fixture();await x.run();
 const r=await x.run();
 assert.equal(r.replayed,true);assert.equal(x.returned(),1);
 assert.equal(x.calls.length,3);
});
test("disabled cancellation cannot lock Rust or release office items",async()=>{
 const x=fixture();x.enabled(false);
 assert.equal((await x.run()).reason,"CORP_CANCEL_LIFECYCLE_DISABLED");
 assert.equal(x.calls.length,0);assert.equal(x.returned(),0);
});
test("Rust lock not matching original cargo and corporation blocks physical release",async()=>{
 for(const change of [x=>x.replies.GetCorpSellCancel={...x.locked,cargoID:CARGO+1},
  x=>x.replies.GetCorpSellCancel={...x.locked,remainingQuantity:8},
  x=>x.replies.GetCorpSellCancel={...x.locked,settledCycles:0},
  x=>x.replies.GetCorpSellCancel={...x.locked,corporationID:3000},
  x=>x.replies.GetCorpSellCancel={...x.locked,phase:"CANCELLED"}]){
  const x=fixture();change(x);
  assert.equal((await x.run()).reason,"CORP_CANCEL_LOCK_RETURN_OR_FINALIZE_UNKNOWN");
  assert.equal(x.returned(),0);
 }
});
test("lost Rust lock ACK blocks retry and never returns cargo speculatively",async()=>{
 const x=fixture();x.broken("LockCorpSellCancel");
 assert.equal((await x.run()).reason,"CORP_CANCEL_LOCK_RETURN_OR_FINALIZE_UNKNOWN");
 x.broken(null);
 assert.equal((await x.run()).reason,"CORP_CANCEL_OUTCOME_UNKNOWN");
 assert.equal(x.returned(),0);
 assert.deepEqual(x.svc.requiresOperatorReconciliation(),[ORDER]);
});
test("lost Rust finalize ACK after return cannot return the same ore again",async()=>{
 const x=fixture();x.broken("FinalizeCorpSellCancel");
 assert.equal((await x.run()).reason,"CORP_CANCEL_LOCK_RETURN_OR_FINALIZE_UNKNOWN");
 x.broken(null);
 assert.equal((await x.run()).reason,"CORP_CANCEL_OUTCOME_UNKNOWN");
 assert.equal(x.returned(),1);
});
test("forged Rust finalization lacking original GameStore proof is rejected",async()=>{
 const x=fixture();x.replies.FinalizeCorpSellCancel={...x.done,verifiedGameStore:false};
 assert.equal((await x.run()).reason,"CORP_CANCEL_LOCK_RETURN_OR_FINALIZE_UNKNOWN");
 assert.equal(x.returned(),1);
});
test("invalid session or corporation scope cannot request Rust cancellation",async()=>{
 const x=fixture();x.session.corporationID=CORP+1;
 assert.equal((await x.run()).reason,"CORP_CANCEL_SCOPE_INVALID");
 assert.equal(x.calls.length,0);
});
