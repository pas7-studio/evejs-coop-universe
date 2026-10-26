import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createCorporateFillLifecycle}=require("../integration/coopPlayerMiningCorporateFillLifecycle.cjs");
const ORDER="9521",CORP=5001,BUYER=8022,CARGO=7211,ITEM=190009,KEY="coopPlayerMiningCorpFill\u001f9521:1";
function fixture(){
 let enabled=true,attested=true,poison=null,callCount=0,commitCount=0;
 const seq=[],events=[];
 const match={verifiedNative:true,source:"coop-corporation",is_corp:true,
  bid:false,orderID:ORDER,cycle:1,buyerCharacterID:BUYER,
  sellerCorpID:CORP,volumeBefore:8,quantity:3,priceCents:250};
 const claim={...match,phase:"claimed",state:"settling",
  cargoID:CARGO,sourceItemID:ITEM,stationID:60001,typeID:34,
  volumeAfter:5,escrowLocationID:9200000000+9521};
 const receipt={phase:"GAMESTORE_COMMITTED",receiptKey:KEY,orderID:ORDER,
  cycle:1,buyerCharacterID:BUYER,sellerCorpID:CORP,
  cargoID:CARGO,sourceItemID:ITEM,quantity:3,volumeAfter:5,
  priceCents:250,buyerJournalID:5100000000000000,
  sellerJournalID:5100000000000001,
  grossCents:750,netRevenueCents:705};
 const finale={phase:"finalized",orderID:ORDER,cycle:1,
  receiptKey:KEY,volumeAfter:5,verifiedGameStore:true,requiresRelease:true};
 const released={phase:"released",orderID:ORDER,cycle:1,receiptKey:KEY,
  volumeAfter:5,verifiedGameStore:true,invalidated:true,state:"open"};
 const replies={ClaimCorpFill:claim,GetCorpFillClaim:claim,
  FinalizeCorpFill:finale,ReleaseCorpFill:released};
 const client={async call(method,args){
  seq.push(method);callCount++;
  assert.equal(args.access_token,"secret".repeat(7));
  assert.equal(args.order_id,ORDER);
  assert.equal(args.cycle,1);
  if(method===poison)throw Error("RUST_ACK_UNKNOWN");
  return replies[method];
 }};
 const settled={settle({orderID,cycle}){
  seq.push("GameStoreAtomicCommit");
  assert.equal(orderID,ORDER);assert.equal(cycle,1);commitCount++;
  return receipt;
 }};
 const svc=createCorporateFillLifecycle({
  marketClient:client,getTrustedMatch:async()=>attested?match:null,
  settlement:settled,token:"secret".repeat(7),
  enabled:()=>enabled,observe:(kind,data)=>events.push({kind,data})
 });
 return {svc,match,claim,receipt,replies,seq,events,
  exec:()=>svc.processVerifiedMatch({orderID:ORDER,cycle:1}),
  setEnabled:v=>enabled=v,setTrusted:v=>attested=v,
  rejectAt:v=>poison=v,calls:()=>callCount,commits:()=>commitCount};
}
test("trusted Rust Claim then durable original GameStore, Finalize, Release in exact order",async()=>{
 const x=fixture(),r=await x.exec();
 assert.equal(r.status,"CORP_SELL_FILL_RELEASED");
 assert.equal(r.verifiedGrossCents,750);
 assert.equal(r.verifiedNetRevenueCents,705);
 assert.deepEqual(x.seq,["ClaimCorpFill","GetCorpFillClaim","GameStoreAtomicCommit",
  "FinalizeCorpFill","ReleaseCorpFill"]);
 assert.equal(x.commits(),1);
 assert.equal(x.events.length,1);
 assert.equal(x.svc.supportsPublicMarket,false);
});
test("same released fill returns cached receipt, never second ISK debit or claim",async()=>{
 const x=fixture(),a=await x.exec(),count=x.calls();
 const b=await x.exec();
 assert.equal(b.replayed,true);assert.equal(b.receiptKey,a.receiptKey);
 assert.equal(x.commits(),1);assert.equal(x.calls(),count);
});
test("OFF flag prevents all Rust RPC and original wallet writes",async()=>{
 const x=fixture();x.setEnabled(false);
 assert.equal((await x.exec()).reason,"CORP_FILL_LIFECYCLE_DISABLED");
 assert.equal(x.calls(),0);assert.equal(x.commits(),0);
});
test("untrusted or unavailable original match never claims a Rust corporate order",async()=>{
 const x=fixture();x.setTrusted(false);
 assert.equal((await x.exec()).reason,"CORP_FILL_NATIVE_MATCH_NOT_ATTESTED");
 assert.equal(x.calls(),0);
});
test("native Rust source ID, order or quantity mismatch stops before money transfer",async()=>{
 for(const mutate of [x=>x.replies.GetCorpFillClaim={...x.claim,quantity:8},
  x=>x.replies.GetCorpFillClaim={...x.claim,source:"player"},
  x=>x.replies.GetCorpFillClaim={...x.claim,is_corp:false},
  x=>x.replies.ClaimCorpFill={...x.claim,buyerCharacterID:CORP}]){
  const x=fixture();mutate(x);
  assert.equal((await x.exec()).reason,"CORP_FILL_CLAIM_COMMIT_OR_RELEASE_UNCERTAIN");
  assert.equal(x.commits(),0);assert.equal(x.events.length,0);
 }
});
test("missing native buyer/corporate ledger receipt blocks Rust finalize and release",async()=>{
 const x=fixture();x.receipt.buyerJournalID=undefined;
 assert.equal((await x.exec()).reason,"CORP_FILL_CLAIM_COMMIT_OR_RELEASE_UNCERTAIN");
 assert.equal(x.seq.includes("FinalizeCorpFill"),false);
});
test("lost native Rust claim ACK fences all retry before any GameStore mutation",async()=>{
 const x=fixture();x.rejectAt("ClaimCorpFill");
 assert.equal((await x.exec()).reason,"CORP_FILL_CLAIM_COMMIT_OR_RELEASE_UNCERTAIN");
 x.rejectAt(null);
 assert.equal((await x.exec()).reason,"CORP_FILL_OUTCOME_UNKNOWN");
 assert.deepEqual(x.svc.requiresOperatorReconciliation(),[ORDER]);
 assert.equal(x.commits(),0);
});
test("lost Rust finalize ACK after GameStore COMMIT never double-debits buyer",async()=>{
 const x=fixture();x.rejectAt("FinalizeCorpFill");
 assert.equal((await x.exec()).reason,"CORP_FILL_CLAIM_COMMIT_OR_RELEASE_UNCERTAIN");
 assert.equal(x.commits(),1);x.rejectAt(null);
 assert.equal((await x.exec()).reason,"CORP_FILL_OUTCOME_UNKNOWN");
 assert.equal(x.commits(),1);
 assert.equal(x.seq.includes("ReleaseCorpFill"),false);
});
test("lost Rust release ACK after commit never restarts match or GameStore settlement",async()=>{
 const x=fixture();x.rejectAt("ReleaseCorpFill");
 assert.equal((await x.exec()).reason,"CORP_FILL_CLAIM_COMMIT_OR_RELEASE_UNCERTAIN");
 assert.equal(x.commits(),1);x.rejectAt(null);
 assert.equal((await x.exec()).reason,"CORP_FILL_OUTCOME_UNKNOWN");
 assert.equal(x.commits(),1);
});
test("only finalized Rust native source permits release, never bare GameStore status",async()=>{
 const x=fixture();x.replies.FinalizeCorpFill.verifiedGameStore=false;
 assert.equal((await x.exec()).reason,"CORP_FILL_CLAIM_COMMIT_OR_RELEASE_UNCERTAIN");
 assert.equal(x.seq.includes("ReleaseCorpFill"),false);
});
test("Rust release must reopen only partial order, not claim fill complete prematurely",async()=>{
 const x=fixture();x.replies.ReleaseCorpFill.state="filled";
 assert.equal((await x.exec()).reason,"CORP_FILL_CLAIM_COMMIT_OR_RELEASE_UNCERTAIN");
});
