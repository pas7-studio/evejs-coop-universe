import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createOriginalCorporateSellCustody,originalLocation}=require("../integration/coopPlayerMiningCorporateSellCustody.cjs");
const SEP="\u001f",CORP=5001,NPC=5002,STATION=60001,OFFICE=64001,ITEM=190003,
 CARGO=7773,ORDER="9521",SYSTEM=30000144,SHIFT="coop-mining-shift:"+"a".repeat(32);
function setup(){
 const session={characterID:42,corporationID:CORP,userid:13,socket:{destroyed:false}};
 const original={itemID:ITEM,ownerID:CORP,locationID:OFFICE,flagID:115,
  typeID:34,quantity:80,stacksize:80,singleton:0,
  customInfo:"coop-warehouse:v1:cargo:"+CARGO};
 const title={version:1,status:"COMMITTED",shiftID:SHIFT,buyerCorpID:CORP,
  itemID:ITEM,typeID:34,quantity:80,stationID:STATION,
  officeFolderID:OFFICE,division:115};
 const records={
  items:new Map([[String(ITEM),structuredClone(original)]]),
  corporationRuntime:new Map([["coopPlayerMiningOreTitle"+SEP+CARGO,title]]),
  marketEscrow:new Map()
 };
 let mutate=0,enabled=true,role=true,cancelled=true,filled=0,
  validNative=true,poisoned=false,commitUnknown=false,clock=1793030000100;
 const ore={cargoID:CARGO,itemID:ITEM,typeID:34,quantity:80,
  stationID:STATION,officeFolderID:OFFICE,division:115};
 const order={order_id:ORDER,is_corp:true,owner_id:CORP,bid:false,
  station_id:STATION,type_id:34,vol_remaining:80,vol_entered:80,
  source:"coop-corporation",price_cents:1500,escrowed:false,state:"prepared"};
 const gameStore={coopAtomicNativeRows:{
  mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>poisoned,
  transact(tables,fn){
   assert.deepEqual(tables,["items","corporationRuntime","marketEscrow"]);
   const snapshots=Object.fromEntries(tables.map(t=>[t,structuredClone([...records[t]])]));
   const tx={
    get:(table,key)=>records[table].get(key)??null,
    put(table,key,value){records[table].set(key,structuredClone(value));mutate++},
    scan:(table)=>[...records[table]].map(([key,value])=>({key,value}))
   };
   try{
    const r=fn(tx);
    if(commitUnknown)throw Error("UNKNOWN_ACK_AFTER_WRITE");
    return r;
   }catch(e){
    if(!commitUnknown)for(const t of tables)records[t]=new Map(snapshots[t]);
    throw e;
   }
  }}
 };
 const svc=createOriginalCorporateSellCustody({gameStore,
  access:{isMember:()=>role,canIndustry:()=>role,
   canWallet:()=>role,canTake:()=>role},
  readiness:{inspect:()=>({status:"NATIVE_CORPORATE_SELL_UNSUPPORTED",
   marketOrderCreated:false,originalCorporateOre:[ore]})},
  verifyNativeSellOrder:()=>validNative?{verifiedNative:true,phase:"PREPARED_UNPUBLISHED",
   isPublished:false,totalFilled:0,totalPaidCents:0,
   orderID:ORDER,order:{...order}}:null,
  readCancelProof:()=>({verifiedNative:true,orderID:ORDER,ownerID:CORP,
   phase:cancelled?"CANCELLED":"OPEN",totalFilled:filled,totalPaidCents:filled*1500}),
  clock:()=>clock,enabled:()=>enabled});
 const input={session,corporationID:CORP,operationID:SHIFT,cargoID:CARGO,orderID:ORDER};
 return {input,svc,records,order,original,title,ore,
  reserve:()=>svc.reserve(input),returnUnsold:()=>svc.returnUnsold(input),
  item:()=>records.items.get(String(ITEM)),
  escrow:()=>records.marketEscrow.get(ORDER),
  receipt:()=>records.corporationRuntime.get("coopPlayerMiningCorpSell"+SEP+CARGO),
  mutations:()=>mutate,flag:x=>enabled=x,role:x=>role=x,
  cancel:x=>cancelled=x,fill:x=>filled=x,
  native:x=>validNative=x,poison:x=>poisoned=x,
  unknown:x=>commitUnknown=x,now:x=>clock=x};
}
test("native Rust orderID derives exact stock escrow location without unsafe integer alias",()=>{
 assert.equal(originalLocation(ORDER),9200000000+Number(ORDER));
 assert.equal(originalLocation("0001"),null);
 assert.equal(originalLocation("0"),null);
 assert.equal(originalLocation("999999999999999999"),null);
});
test("default OFF never moves corporation ore or emits original escrow",()=>{
 const x=setup();x.flag(false);const r=x.reserve();
 assert.equal(r.reason,"CORP_SELL_CUSTODY_DISABLED");
 assert.deepEqual(x.item(),x.original);
 assert.equal(x.escrow(),undefined);assert.equal(x.mutations(),0);
});
test("verified original corporate order binds same itemID to native escrow, no ISK credit",()=>{
 const x=setup(),r=x.reserve();
 assert.equal(r.status,"ESCROW_BOUND_UNSETTLED");
 assert.equal(r.realizedRevenueCents,null);
 assert.equal(r.marketOrderCreated,false);
 assert.equal(x.item().itemID,ITEM);assert.equal(x.item().ownerID,CORP);
 assert.equal(x.item().locationID,originalLocation(ORDER));
 assert.equal(x.item().flagID,4);
 assert.equal(x.receipt().phase,"ESCROW_BOUND_UNSETTLED");
 assert.equal(x.escrow().orderId,ORDER);
 assert.equal(x.escrow().isCorp,true);
 assert.deepEqual(x.escrow().sourceItemIDs,[ITEM]);
 assert.equal(x.mutations(),3);
});
test("double reserve never changes original stock a second time",()=>{
 const x=setup();assert.equal(x.reserve().status,"ESCROW_BOUND_UNSETTLED");
 const result=x.reserve();
 assert.equal(result.reason,"CORP_SELL_NATIVE_ESCROW_COMMIT_UNCERTAIN");
 assert.equal(x.item().ownerID,CORP);
 assert.equal(x.mutations(),3);
});
test("original native market order absent or tampered cannot reserve corporate stock",()=>{
 for(const mutate of [x=>x.native(false),
  x=>x.order.owner_id=NPC,x=>x.order.is_corp=false,
  x=>x.order.bid=true,x=>x.order.source="player",
  x=>x.order.vol_remaining=20,x=>x.order.station_id=STATION+1]){
  const x=setup();mutate(x);
  assert.equal(x.reserve().reason,"CORP_SELL_NATIVE_ORDER_NOT_ATTESTED");
  assert.deepEqual(x.item(),x.original);
  assert.equal(x.mutations(),0);
 }
});
test("authentic corporation wallet, warehouse TAKE and Industry rights required",()=>{
 const x=setup();x.role(false);
 assert.equal(x.reserve().reason,"CORP_SELL_CORPORATE_ROLE_REVOKED");
 assert.equal(x.mutations(),0);
});
test("native market escrow collision forbids overwriting another owner's order",()=>{
 const x=setup();x.records.marketEscrow.set(ORDER,{orderId:ORDER,ownerId:NPC});
 assert.equal(x.reserve().reason,"CORP_SELL_NATIVE_ESCROW_COMMIT_UNCERTAIN");
 assert.deepEqual(x.item(),x.original);
});
test("different original item already at same escrow-location blocks new order",()=>{
 const x=setup();x.records.items.set("999",{itemID:999,
  locationID:originalLocation(ORDER),ownerID:9009});
 assert.equal(x.reserve().reason,"CORP_SELL_NATIVE_ESCROW_COMMIT_UNCERTAIN");
 assert.deepEqual(x.item(),x.original);
});
test("different original title or owner cannot be silently reserved",()=>{
 for(const change of [x=>x.title.itemID+=1,
  x=>x.title.shiftID="coop-mining-shift:"+"b".repeat(32),
  x=>x.records.items.get(String(ITEM)).ownerID=NPC,
  x=>x.records.items.get(String(ITEM)).quantity=10]){
  const x=setup();change(x);
  assert.equal(x.reserve().reason,"CORP_SELL_NATIVE_ESCROW_COMMIT_UNCERTAIN");
  assert.equal(x.mutations(),0);
 }
});
test("verified native CANCELLED zero-fill returns same item to same office and flags",()=>{
 const x=setup();x.reserve();
 const r=x.returnUnsold();
 assert.equal(r.status,"RETURNED_UNFILLED");
 assert.deepEqual(x.item(),x.original);
 assert.equal(x.receipt().phase,"RETURNED_UNFILLED");
 assert.equal(x.escrow().phase,"RETURNED_UNFILLED");
 assert.equal(x.escrow().remainingQuantity,0);
});
test("unfilled original EXPIRED order can also return only after verified expiry",()=>{
 const x=setup();x.reserve();x.cancel(false);
 assert.equal(x.returnUnsold().reason,"CORP_SELL_ORIGINAL_MARKET_CANCEL_NOT_PROVEN");
});
test("even partial native Rust fill blocks unfilled return without wallet/title settlement",()=>{
 const x=setup();x.reserve();x.fill(1);
 assert.equal(x.returnUnsold().reason,"CORP_SELL_ORIGINAL_MARKET_CANCEL_NOT_PROVEN");
 assert.equal(x.item().locationID,originalLocation(ORDER));
});
test("no native order cancellation means no escrow release and no free cargo",()=>{
 const x=setup();x.reserve();x.cancel(false);
 assert.equal(x.returnUnsold().reason,"CORP_SELL_ORIGINAL_MARKET_CANCEL_NOT_PROVEN");
 assert.equal(x.receipt().phase,"ESCROW_BOUND_UNSETTLED");
});
test("repeated return cannot replay the original item mutation",()=>{
 const x=setup();x.reserve();x.returnUnsold();
 const count=x.mutations();
 assert.equal(x.returnUnsold().reason,"CORP_SELL_RETURN_COMMIT_UNCERTAIN");
 assert.equal(x.mutations(),count);
});
test("original corporate role revoked after reserve cannot withdraw the escrow item",()=>{
 const x=setup();x.reserve();x.role(false);
 assert.equal(x.returnUnsold().reason,"CORP_SELL_RETURN_COMMIT_UNCERTAIN");
 assert.equal(x.item().locationID,originalLocation(ORDER));
});
test("unknown native GameStore ACK preserves uncertain fence without blind item return",()=>{
 const x=setup();x.unknown(true);
 assert.equal(x.reserve().reason,"CORP_SELL_NATIVE_ESCROW_COMMIT_UNCERTAIN");
 assert.deepEqual(x.svc.requiresOperatorReconciliation(),[CARGO]);
 assert.equal(x.returnUnsold().reason,"CORP_SELL_RETURN_SCOPE_INVALID_OR_UNCERTAIN");
});
test("poisoned native GameStore blocks all corporate escrow operations",()=>{
 const x=setup();x.poison(true);
 assert.equal(x.reserve().reason,"CORP_SELL_NATIVE_ATOMIC_STORE_POISONED");
 assert.equal(x.returnUnsold().reason,"CORP_SELL_RETURN_SCOPE_INVALID_OR_UNCERTAIN");
});
test("no corporate sell can claim received revenue until original Rust claim and corporate wallet settlement",()=>{
 const x=setup();const r=x.reserve();
 assert.equal(r.realizedRevenueCents,null);
 assert.equal(x.receipt().marketRevenueCents,null);
 assert.equal(x.receipt().marketOrderCreated,false);
 assert.equal(x.escrow().phase,"ESCROW_BOUND_UNSETTLED");
});

test("an already OPEN native Rust order cannot reserve corporate cargo after buyers might fill",()=>{
 const x=setup();x.order.state="open";
 assert.equal(x.reserve().reason,"CORP_SELL_NATIVE_ORDER_NOT_ATTESTED");
 assert.equal(x.item().locationID,OFFICE);assert.equal(x.mutations(),0);
});
