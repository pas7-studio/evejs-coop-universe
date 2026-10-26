import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeCorporateBuyerMatch}=require("../integration/coopPlayerMiningCorporateBuyerMatch.cjs");
const ORDER="9521",BUYER=8112,SELLER=5001,CARGO=7773,ITEM=190003;
function fixture(){
 let on=true,clock=1793030000000,cycle=1,docked=true,sourceOK=true;
 const session={characterID:BUYER,corporationID:333,socket:{destroyed:false}};
 const active=[session],calls=[];
 const offer={verifiedNative:true,status:"ELIGIBLE_NOT_RESERVED",source:"coop-corporation",
  is_corp:true,bid:false,nativeMutation:false,buyerFundsReserved:false,
  orderID:ORDER,buyerCharacterID:BUYER,sellerCorpID:SELLER,cargoID:CARGO,
  sourceItemID:ITEM,stationID:60001,typeID:34,volumeBefore:8,quantity:3,
  priceCents:250,grossCents:750,buyerWalletCentsAtQuote:40000};
 const rust={async call(name,args){
  calls.push({name,args});
  assert.equal(name,"GetCorpBuyerQuote");
  assert.equal(args.access_token,"X".repeat(40));
  assert.equal(args.buyer_id,BUYER);
  assert.equal(args.order_id,ORDER);
  return sourceOK?{...offer}:null;
 }};
 const svc=createNativeCorporateBuyerMatch({
  marketClient:rust,getActiveSessions:()=>active,
  isDockedAtMarket:(_,station)=>docked&&station===60001,
  readNextFillCycle:()=>cycle,
  token:"X".repeat(40),enabled:()=>on,clock:()=>clock});
 const quote=()=>svc.quote({session,orderID:ORDER,quantity:3,maxUnitPriceCents:300});
 const match=()=>svc.getTrustedMatch({orderID:ORDER,cycle:1});
 return {svc,quote,match,session,active,calls,offer,
  enabled:v=>on=v,now:v=>clock=v,cycle:v=>cycle=v,
  docked:v=>docked=v,native:v=>sourceOK=v};
}
test("authenticated buyer gets Rust-backed quote but funds remain unreserved",async()=>{
 const x=fixture(),q=await x.quote();
 assert.equal(q.status,"ELIGIBLE_NOT_RESERVED");
 assert.equal(q.buyerFundsReserved,false);assert.equal(q.marketOrderPlaced,false);
 assert.equal(q.grossCents,750);
 assert.equal(x.calls[0].args.buyer_id,BUYER);
 assert.equal(x.svc.supportsLiveBuyerMatching,false);
});
test("source quote pins one-shot future claim with fresh Rust re-attestation",async()=>{
 const x=fixture();await x.quote();
 const m=await x.match();
 assert.equal(m.buyerCharacterID,BUYER);assert.equal(m.sellerCorpID,SELLER);
 assert.equal(m.volumeBefore,8);assert.equal(m.quantity,3);assert.equal(m.priceCents,250);
 assert.equal(await x.match(),null);
 assert.equal(x.calls.length,2);
});
test("flag OFF returns no quote and no Rust request",async()=>{
 const x=fixture();x.enabled(false);
 assert.equal((await x.quote()).reason,"CORP_BUYER_MATCH_DISABLED");
 assert.equal(x.calls.length,0);
});
test("forged or disconnected original character session cannot buy corporate stock",async()=>{
 const x=fixture();x.active.splice(0);
 assert.equal((await x.quote()).reason,"CORP_BUYER_SCOPE_INVALID_OR_UNCERTAIN");
 assert.equal(x.calls.length,0);
});
test("real original docking at corporation stock station required",async()=>{
 const x=fixture();x.docked(false);
 assert.equal((await x.quote()).reason,"CORP_BUYER_RUST_FUNDS_OR_STATION_UNVERIFIED");
});
test("forged Rust owner, original price or stock proof cannot create buyer candidate",async()=>{
 for(const mutate of [q=>q.sellerCorpID=null,q=>q.priceCents=350,
  q=>q.buyerWalletCentsAtQuote=100,q=>q.source="player",
  q=>q.is_corp=false,q=>q.sourceItemID=0,q=>q.grossCents=1]){
  const x=fixture();mutate(x.offer);
  assert.equal((await x.quote()).status,"BLOCKED");
 }
});
test("two buyers cannot overwrite same outstanding corporate order-cycle quote",async()=>{
 const x=fixture();assert.equal((await x.quote()).status,"ELIGIBLE_NOT_RESERVED");
 assert.equal((await x.quote()).reason,"CORP_BUYER_ORDER_ALREADY_QUOTED");
});
test("expired quote cannot become trusted buyer match after time advances",async()=>{
 const x=fixture();await x.quote();x.now(1793030030001);
 assert.equal(await x.match(),null);
});
test("buyer session revocation after quote cancels one-shot claim candidate",async()=>{
 const x=fixture();await x.quote();x.active.length=0;
 assert.equal(await x.match(),null);
});
test("Rust source quote unavailable after initial quote blocks buyer claim and fences order",async()=>{
 const x=fixture();await x.quote();x.native(false);
 assert.equal(await x.match(),null);
});
test("independent corporate fill cycle drift blocks stale buyer quote",async()=>{
 const x=fixture();await x.quote();x.cycle(2);
 assert.equal(await x.match(),null);
});
test("no server-proven original source can ever place stock market order",async()=>{
 const x=fixture();await x.quote();await x.match();
 assert.equal(x.calls.every(c=>c.name==="GetCorpBuyerQuote"),true);
});
