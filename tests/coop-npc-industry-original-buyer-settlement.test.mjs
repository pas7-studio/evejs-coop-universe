import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createOriginalNpcIndustryBuyerSettlement}=require("../integration/coopNpcIndustryOriginalBuyerSettlement.cjs");
const OP="npc-manufacture:"+"a".repeat(32),CLAIM="npc-partial:"+"1".repeat(32);
const OWNER=1000035,STATION=60010001,ORDER=500,ITEM=1990000200,BUYER=90000001,TYPE=215;
const FLAGS={EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",
 EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF:"1",
 EVEJS_COOP_NATIVE_NPC_MANUAL_FACTORY_PROOF:"1",
 EVEJS_COOP_NATIVE_NPC_ECONOMY:"1",
 EVEJS_COOP_NATIVE_NPC_PARTIAL_FILL:"1"};
function fixture({env=FLAGS,settleThrows=false,auditBroken=false}={}){
 const e={operationID:OP,ownerID:OWNER,stationID:STATION,
  typeID:TYPE,itemID:ITEM,quantity:100,phase:"LISTED",orderID:ORDER};
 const journal={version:1,entries:{[OP]:e},history:{}};
 const item={itemID:ITEM,ownerID:OWNER,locationID:9200000000+ORDER,
  typeID:TYPE,flagID:4,singleton:0,quantity:100,stacksize:100};
 const escrow={escrowType:"sell",isCorp:true,ownerId:OWNER,stationId:STATION,
  sourceItemID:ITEM,remainingQuantity:100,escrowLocationID:item.locationID,
  coopOperationID:OP};
 const order={operation_id:OP,order_id:String(ORDER),owner_id:OWNER,
  station_id:STATION,type_id:TYPE,source_item_id:String(ITEM),
  source:"coop-npc",state:"open",vol_remaining:100,is_corp:true,bid:false};
 let wholeCalls=0,partialCalls=0,session=true,fillID=70001;
 const native=async ({identity})=>{
  if(settleThrows)throw Error("RUST_FINALIZE_ACK_LOST");
  order.vol_remaining-=identity.quantity;
  order.state=order.vol_remaining?"open":"filled";
  escrow.remainingQuantity=order.vol_remaining;
  item.quantity=order.vol_remaining;item.stacksize=order.vol_remaining;
  if(order.vol_remaining===0){
   // This test isolates the manual wrapper. COOP-035/047 own real custody.
   item.ownerID=BUYER;item.locationID=STATION;
  }
  return {status:identity.claimKey?"PURCHASED_PARTIAL":"PURCHASED",
   fillID:fillID++};
 };
 const whole={mode:"WHOLE_STACK_PROOF_ONLY",supportsLiveSettlement:false,
  purchaseOnce:async args=>{wholeCalls++;return native(args)}};
 const partial={mode:"RUST_CLAIMED_NATIVE_PARTIAL",supportsLiveSettlement:false,
  purchaseOnce:async args=>{partialCalls++;return native(args)}};
 const saleAudit={audit:async()=>{
  if(auditBroken)return {status:"BLOCKED"};
  return {status:order.vol_remaining?"ORIGINAL_PARTIAL_SALE_ATTESTED":
   "ORIGINAL_FULL_SALE_ATTESTED",
   fillIDs:[fillID-1],soldQuantity:100-order.vol_remaining,
   remainingQuantity:order.vol_remaining,revenueCents:(100-order.vol_remaining)*1250};
 }};
 const args={operationID:OP,ownerID:OWNER,stationID:STATION,
  orderID:ORDER,buyerID:BUYER,quantity:100,maxPriceCents:1250};
 const bridge=createOriginalNpcIndustryBuyerSettlement({
  director:{inspect:()=>structuredClone(journal)},
  whole,partial,saleAudit,getOriginalItem:()=>item,
  getOriginalEscrow:()=>escrow,getRustOrder:async()=>structuredClone(order),
  verifyAuthenticatedBuyer:()=>session,env});
 return {bridge,args,e,journal,item,escrow,order,
  setSession:v=>{session=v},get wholeCalls(){return wholeCalls},
  get partialCalls(){return partialCalls}};
}
test("whole original corporate source settlement delegates exactly once",async()=>{
 const f=fixture();
 const result=await f.bridge.purchase({...f.args,mode:"whole"});
 assert.equal(result.status,"ORIGINAL_NATIVE_PAYMENT_ATTESTED");
 assert.equal(result.originalGameStoreAndRustSettled,true);
 assert.equal(result.soldQuantity,100);assert.equal(result.remainingQuantity,0);
 assert.equal(f.wholeCalls,1);assert.equal(f.partialCalls,0);
});
test("partial original NPC buyer settlement preserves remaining escrow",async()=>{
 const f=fixture();
 const r=await f.bridge.purchase({...f.args,mode:"partial",
  quantity:20,claimKey:CLAIM});
 assert.equal(r.status,"ORIGINAL_NATIVE_PAYMENT_ATTESTED");
 assert.equal(r.soldQuantity,20);assert.equal(r.remainingQuantity,80);
 assert.equal(f.partialCalls,1);assert.equal(f.wholeCalls,0);
});
test("wrong owner or not yet LISTED original factory must not claim Rust",async()=>{
 const f=fixture();f.e.phase="DELIVERED";
 assert.match((await f.bridge.purchase({...f.args,mode:"whole"})).reason,
  /OUTCOME_UNKNOWN/);
 assert.equal(f.wholeCalls,0);
});
test("wrong native buyer session denies before issuing Rust CLAIM",async()=>{
 const f=fixture();f.setSession(false);
 assert.equal((await f.bridge.purchase({...f.args,mode:"whole"})).reason,
  "LW04C3B_NATIVE_BUYER_SESSION_REQUIRED");
 assert.equal(f.wholeCalls,0);
});
test("partially sold Rust order cannot be re-bought as whole stack",async()=>{
 const f=fixture();f.order.vol_remaining=80;f.item.quantity=80;
 f.item.stacksize=80;f.escrow.remainingQuantity=80;
 assert.equal((await f.bridge.purchase({...f.args,mode:"whole",quantity:80})).reason,
  "LW04C3B_RUST_ORIGINAL_OPEN_ORDER_UNVERIFIED");
 assert.equal(f.wholeCalls,0);
});
test("Rust SETTLING order refuses any new buyer before original source repair",async()=>{
 const f=fixture();f.order.state="settling";
 assert.equal((await f.bridge.purchase({...f.args,mode:"partial",
  quantity:10,claimKey:CLAIM})).reason,
  "LW04C3B_RUST_ORIGINAL_OPEN_ORDER_UNVERIFIED");
 assert.equal(f.partialCalls,0);
});
test("unknown Rust finalized ACK requires operator, never another debit",async()=>{
 const f=fixture({settleThrows:true});
 assert.match((await f.bridge.purchase({...f.args,mode:"whole"})).reason,
  /OUTCOME_UNKNOWN/);
 assert.equal((await f.bridge.purchase({...f.args,mode:"whole"})).reason,
  "LW04C3B_OPERATOR_RECOVERY_REQUIRED");
 assert.equal(f.wholeCalls,1);
 assert.equal(f.bridge.repairRequired().length,1);
});
test("committed payment without matching read-only Rust/GameStore audit never retries",async()=>{
 const f=fixture({auditBroken:true});
 assert.equal((await f.bridge.purchase({...f.args,mode:"whole"})).reason,
  "LW04C3B_PAYMENT_COMMITTED_AUDIT_REQUIRED");
 assert.equal((await f.bridge.purchase({...f.args,mode:"whole"})).reason,
  "LW04C3B_OPERATOR_RECOVERY_REQUIRED");
 assert.equal(f.wholeCalls,1);
});
test("mutated original market escrow blocks buyer settlement before Rust claim",async()=>{
 const f=fixture();f.escrow.ownerId++;
 assert.equal((await f.bridge.purchase({...f.args,mode:"whole"})).reason,
  "LW04C3B_GAMESTORE_ESCROW_CUSTODY_UNVERIFIED");
 assert.equal(f.wholeCalls,0);
});
test("partial requires source-issued nonce claimKey, not buyer invented ID",async()=>{
 const f=fixture();
 assert.equal((await f.bridge.purchase({...f.args,mode:"partial",quantity:20,
  claimKey:"fake"})).reason,"LW04C3B_REQUEST_INVALID");
 assert.equal(f.partialCalls,0);
});
test("manual source settlement OFF by default and incompatible with A-Life ACT",async()=>{
 for(const key of Object.keys(FLAGS)){
  const f=fixture({env:{...FLAGS,[key]:"0"}});
  const mode=key==="EVEJS_COOP_NATIVE_NPC_PARTIAL_FILL"?"partial":"whole";
  const r=await f.bridge.purchase({...f.args,mode,claimKey:mode==="partial"?CLAIM:undefined});
  assert.equal(r.reason,"LW04C3B_MANUAL_FINANCE_DISABLED");
 }
 for(const key of ["EVEJS_COOP_ALIFE_ECONOMY_ACT",
  "EVEJS_COOP_NATIVE_NPC_ECONOMY_SCHEDULER","EVEJS_COOP_NATIVE_NPC_MARKET"]){
  const f=fixture({env:{...FLAGS,[key]:"1"}});
  const r=await f.bridge.purchase({...f.args,mode:"whole"});
  assert.equal(r.reason,"LW04C3B_MANUAL_FINANCE_DISABLED");
 }
});
test("manual bridge adds no GameStore/Rust writers, timers, or item mint",()=>{
 const source=fs.readFileSync(new URL("../integration/coopNpcIndustryOriginalBuyerSettlement.cjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/\bsetInterval\s*\(|\bsetTimeout\s*\(/);
 assert.doesNotMatch(source,/\.transact\s*\(|\.put\s*\(|\.grantItem\s*\(/);
});
