import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeCorporateSellBridge}=require("../integration/coopPlayerMiningCorporateSellBridge.cjs");
const SEP="\u001f",CORP=5001,NPC=5002,STATION=60001,OFFICE=64001,ITEM=190003,
 CARGO=7773,ORDER="9521",SHIFT="coop-mining-shift:"+"a".repeat(32);
function setup(){
 const session={characterID:42,corporationID:CORP,userid:13,socket:{destroyed:false}};
 const original={itemID:ITEM,ownerID:CORP,locationID:OFFICE,flagID:115,
  typeID:34,quantity:80,stacksize:80,singleton:0,
  customInfo:"coop-warehouse:v1:cargo:"+CARGO};
 const ore={cargoID:CARGO,itemID:ITEM,typeID:34,quantity:80,
  stationID:STATION,officeFolderID:OFFICE,division:115};
 const tables={
  items:new Map([[String(ITEM),structuredClone(original)]]),
  corporationRuntime:new Map([["coopPlayerMiningOreTitle"+SEP+CARGO,
   {status:"COMMITTED",shiftID:SHIFT,buyerCorpID:CORP,itemID:ITEM,
    typeID:34,quantity:80,stationID:STATION,officeFolderID:OFFICE,division:115}]]),
  marketEscrow:new Map()
 };
 const calls=[],events=[];let enabled=true,authorized=true,price=1500,
  rustValid=true,verifyValid=true,failAfter=null,writes=0;
 const op="coop-corp-sell:"+"f".repeat(32);
 const native={
  verifiedNative:true,phase:"PREPARED_UNPUBLISHED",isPublished:false,
  totalFilled:0,totalPaidCents:0,operationID:op,shiftID:SHIFT,
  cargoID:CARGO,itemID:ITEM,orderID:ORDER,
  order:{order_id:ORDER,owner_id:CORP,is_corp:true,bid:false,
   station_id:STATION,type_id:34,vol_remaining:80,vol_entered:80,
   source:"coop-corporation",state:"prepared",price_cents:1500}
 };
 const marketClient={async call(name,params){
  calls.push({name,params});
  if(name===failAfter)throw Error("LOST_RUST_ACK");
  if(name==="PrepareCorpSell"||name==="GetCorpSell"){
   return rustValid?{...native,operationID:params.operation_id}:null;
  }
  if(name==="VerifyCorpSellEscrow")
   return verifyValid?{status:"ESCROW_PROVEN_NOT_PUBLISHED",orderID:ORDER,
    itemID:ITEM,cargoID:CARGO,corporationID:CORP,
    nativeMarketMutation:false,verifiedGameStore:true}:null;
  throw Error("NO_CORPORATE_MARKET_PUBLISH_ALLOWS_"+name);
 }};
 const gameStore={coopAtomicNativeRows:{
  mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>false,
  transact(requested,fn){
   assert.deepEqual(requested,["items","corporationRuntime","marketEscrow"]);
   const backup=Object.fromEntries(requested.map(t=>[t,structuredClone([...tables[t]])]));
   const tx={
    get:(t,k)=>tables[t].get(k)??null,
    put(t,k,v){tables[t].set(k,structuredClone(v));writes++},
    scan:t=>[...tables[t]].map(([key,value])=>({key,value}))
   };
   try{return fn(tx)}
   catch(e){for(const t of requested)tables[t]=new Map(backup[t]);throw e}
  }}
 };
 const access={isMember:()=>authorized,canIndustry:()=>authorized,
  canWallet:()=>authorized,canTake:()=>authorized};
 const readiness={inspect:()=>authorized?{status:"NATIVE_CORPORATE_SELL_UNSUPPORTED",
  marketOrderCreated:false,originalCorporateOre:[ore]}:{status:"BLOCKED"}};
 const svc=createNativeCorporateSellBridge({marketClient,gameStore,access,readiness,
  token:"X".repeat(40),quotePrice:()=>price,clock:()=>1793030000000,
  enabled:()=>enabled,observe:(name,data)=>events.push({name,data})});
 return {svc,session,calls,events,original,tables,ore,native,
  run:()=>svc.prepareAndBind({session,corporationID:CORP,operationID:SHIFT,cargoID:CARGO}),
  item:()=>tables.items.get(String(ITEM)),receipt:()=>tables.corporationRuntime.get("coopPlayerMiningCorpSell"+SEP+CARGO),
  escrow:()=>tables.marketEscrow.get(ORDER),written:()=>writes,
  enable:x=>enabled=x,role:x=>authorized=x,price:x=>price=x,
  native:x=>rustValid=x,verify:x=>verifyValid=x,failAt:x=>failAfter=x};
}
test("Rust-private prepare -> Get -> native escrow -> independent read-only Rust verification",async()=>{
 const x=setup(),r=await x.run();
 assert.equal(r.status,"ESCROW_PROVEN_NOT_PUBLISHED");
 assert.deepEqual(x.calls.map(c=>c.name),
  ["PrepareCorpSell","GetCorpSell","VerifyCorpSellEscrow"]);
 assert.equal(x.calls[0].params.owner_id,CORP);
 assert.equal(x.calls[0].params.source_item_id,ITEM);
 assert.equal(x.calls[0].params.price_cents,1500);
 assert.equal(x.item().itemID,ITEM);assert.equal(x.item().ownerID,CORP);
 assert.equal(x.escrow().isCorp,true);
 assert.equal(x.receipt().phase,"ESCROW_BOUND_UNSETTLED");
 assert.equal(x.events[0].data.status,"ESCROW_PROVEN_NOT_PUBLISHED");
 assert.equal(r.marketOrderCreated,false);assert.equal(r.realizedRevenueCents,null);
});
test("source-only bridge never provides live corporate publish or wallet settlement",async()=>{
 const x=setup();const r=await x.run();
 assert.equal(x.svc.supportsNativeCorporatePublish,false);
 assert.equal(x.svc.supportsNativeCorporateSettlement,false);
 assert.equal(x.calls.some(c=>c.name==="PublishCorpSell"),false);
 assert.equal(x.tables.corporationRuntime.size,2);
 assert.equal(r.netProfitCents,null);
});
test("feature OFF cannot create an original Rust market order or lock corporate ore",async()=>{
 const x=setup();x.enable(false);
 assert.equal((await x.run()).reason,"CORP_SELL_PREPARE_DISABLED");
 assert.equal(x.calls.length,0);assert.equal(x.written(),0);
});
test("revoked current membership or warehouse rights are fail-closed",async()=>{
 const x=setup();x.role(false);
 assert.equal((await x.run()).reason,"CORP_SELL_ORIGINAL_TITLE_OR_ROLE_NOT_VERIFIED");
 assert.equal(x.calls.length,0);
});
test("server-approved price is mandatory, client has no price or seller field",async()=>{
 const x=setup();x.price(0);
 assert.equal((await x.run()).reason,"CORP_SELL_NATIVE_PRICE_INVALID");
 assert.equal(x.calls.length,0);
});
test("forged Rust order prepare and Get cannot move physical corporate inventory",async()=>{
 const x=setup();x.native(false);
 assert.equal((await x.run()).reason,"CORP_SELL_PREPARE_OR_ESCROW_OUTCOME_UNKNOWN");
 assert.equal(x.item().locationID,OFFICE);assert.equal(x.escrow(),undefined);
});
test("unknown original Rust Prepare ACK never causes blind retry or physical move",async()=>{
 const x=setup();x.failAt("PrepareCorpSell");
 assert.equal((await x.run()).reason,"CORP_SELL_PREPARE_OR_ESCROW_OUTCOME_UNKNOWN");
 assert.deepEqual(x.svc.inspectUncertain(),[CARGO]);
 x.failAt(null);await x.run();
 assert.equal(x.calls.length,1);assert.equal(x.item().locationID,OFFICE);
});
test("failed Rust read-only escrow witness locks uncertain original stock but never fabricates sale",async()=>{
 const x=setup();x.verify(false);
 assert.equal((await x.run()).reason,"CORP_SELL_PREPARE_OR_ESCROW_OUTCOME_UNKNOWN");
 assert.equal(x.item().ownerID,CORP);
 assert.equal(x.escrow().phase,"ESCROW_BOUND_UNSETTLED");
 assert.equal(x.svc.inspectUncertain()[0],CARGO);
 assert.equal(x.calls.some(c=>c.name==="PublishCorpSell"),false);
});
test("repeating the same corporate request never creates another item or fresh Rust order",async()=>{
 const x=setup();await x.run();const last=x.written();
 assert.equal((await x.run()).reason,"CORP_SELL_PREPARE_OR_ESCROW_OUTCOME_UNKNOWN");
 assert.equal(x.written(),last);
 assert.equal(x.item().itemID,ITEM);assert.equal(x.escrow().sourceItemIDs[0],ITEM);
});
