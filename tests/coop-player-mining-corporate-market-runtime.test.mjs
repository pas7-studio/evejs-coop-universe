import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createCorporateMarketRuntime}=require("../integration/coopPlayerMiningCorporateMarketRuntime.cjs");
const SHIFT="coop-mining-shift:"+"a".repeat(32);
function make({active=false,locked=false}={}){
 const session={characterID:8011,userid:4,corporationID:5001,
  socket:{destroyed:false}};
 const steps=[],store={read(){steps.push("original-store-read");
  return {success:false,errorMsg:"ENTRY_NOT_FOUND"}},
  coopAtomicNativeRows:{mode:"SERVER_INTERNAL_FLAGGED",
   transact(){steps.push("atomic");throw Error("NOT_READY")},
   isPoisoned:()=>false}};
 const access={isMember:()=>true,canIndustry:()=>true,
  canWallet:()=>true,canTake:()=>true};
 const marketClient={async call(name){steps.push(name);throw Error("RUST_SOURCE_ABSENT")}};
 const authority=createCorporateMarketRuntime({
  gameStore:store,marketClient,access,
  readiness:{inspect:()=>({status:"BLOCKED"})},
  getActiveSessions:()=>[session],
  getDockedLocationID:()=>60001,
  getCharacterRecord:()=>({characterID:8011,corporationID:5001}),
  getMarketContext:()=>({characterID:8011,stationID:60001,
   limits:{acc:0.04},brokerCommissionRate:0.03}),
  computeSalesTaxAmount:()=>0.04,
  computeBrokerFeeInfo:()=>({amount:0.03}),
  token:"secret".repeat(7),enabledFn:()=>active,
  pnlEnabled:()=>locked
 });
 return {session,authority,steps};
}
test("default-off native market never places Rust order or debits original wallet",async()=>{
 const x=make(),r=await x.authority.sellFromEntries({session:x.session,
  itemList:[{itemID:19003,typeID:34,quantity:8,price:25}],durationDays:90});
 assert.equal(r.status,"BLOCKED");
 assert.equal(r.reason,"CORP_MARKET_OFF");
 assert.deepEqual(x.steps,[]);
});
test("default-off buyer bridge never attempts stock character FillOrder",async()=>{
 const x=make(),r=await x.authority.buyFromOrder({session:x.session,
  sellOrder:{source:"coop-corporation",station_id:60001,
    order_id:"9521",price:25,is_corp:true},
  quantity:3,maxUnitPriceCents:3000});
 assert.equal(r.reason,"CORP_MARKET_OFF");
 assert.deepEqual(x.steps,[]);
});
test("no original purchased ore title prevents creating corporate Rust SELL",async()=>{
 const x=make({active:true}),r=await x.authority.sellFromEntries({session:x.session,
  itemList:[{itemID:19003,typeID:34,quantity:8,price:25}],durationDays:90});
 assert.equal(r.reason,"CORP_MARKET_ORIGINAL_TITLE_NOT_UNIQUE");
 assert.deepEqual(x.steps,["original-store-read"]);
});
test("read-only P&L can't show fabricated profits when no original shift",async()=>{
 const x=make({locked:true}),r=await x.authority.pnlReport({session:x.session,
  corporationID:5001,operationID:SHIFT});
 assert.equal(r.status,"BLOCKED");
 assert.equal(r.realizedRevenueCents,null);
 assert.equal(r.netOperatingProfitCents,null);
});
