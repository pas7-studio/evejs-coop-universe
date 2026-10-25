import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createOriginalNpcSaleSettlementAudit}=require("../integration/coopNpcIndustryOriginalSaleAudit.cjs");
const OP="npc-manufacture:"+"a".repeat(32),OWNER=1000035,STATION=60010001;
const TYPE=215,ITEM=1990000200,ORDER=500,BUYER=90000001,JOB=970000000000000;
const KEY1="npc-partial:"+"1".repeat(32),KEY2="npc-partial:"+"2".repeat(32);
function fixture(){
 const entry={operationID:OP,phase:"LISTED",ownerID:OWNER,stationID:STATION,
  orderID:ORDER,typeID:TYPE,itemID:ITEM,quantity:100,jobID:JOB};
 const journal={version:1,entries:{[OP]:entry},history:{}};
 const items=new Map([[ITEM,{itemID:ITEM,ownerID:OWNER,typeID:TYPE,
  locationID:9200000000+ORDER,flagID:4,singleton:0,quantity:100,
  stacksize:100,customInfo:"coop-industry:v1:"+JOB}]]);
 const escrows=new Map([[ORDER,{orderId:String(ORDER),ownerId:OWNER,
  stationId:STATION,sourceItemID:ITEM,coopOperationID:OP,
  remainingQuantity:100}]]);
 const rustClaims=new Map();
 const wallets=new Map();
 let order={operation_id:OP,order_id:String(ORDER),
  owner_id:OWNER,station_id:STATION,type_id:TYPE,source_item_id:String(ITEM),
  state:"open",vol_remaining:100,is_corp:true,bid:false,source:"coop-npc"};
 let mutated=false,receipts=[];
 const controller={
  entry,journal,items,escrows,rustClaims,wallets,
  setRust:x=>{order={...order,...x}},
  moveJournalOnRead:()=>{mutated=true},
  receipts:r=>{receipts=r},
  append:r=>{receipts.push(r)},
  giveBuyer:(id,qty,buyerID=BUYER)=>items.set(id,{
   itemID:id,typeID:TYPE,ownerID:buyerID,locationID:STATION,flagID:4,
   singleton:0,quantity:qty,stacksize:qty,customInfo:"coop-industry:v1:"+JOB}),
  removeEscrow:()=>escrows.delete(ORDER),
  setEscrowRemaining:q=>{escrows.get(ORDER).remainingQuantity=q;
    const item=items.get(ITEM);item.quantity=q;item.stacksize=q},
  setBuyerWallet:r=>wallets.set(r.fillID,{verifiedNative:true,
   transactionID:r.fillID,ownerID:OWNER,buyerID:BUYER,orderID:ORDER,
   buyerDebitCents:r.grossCents,corporateCreditCents:r.grossCents}),
 };
 let reads=0;
 const audit=createOriginalNpcSaleSettlementAudit({
  director:{inspect:()=>{reads++;if(reads>1&&mutated)entry.priceCents=999;
   return structuredClone(journal)}},
  listNativeReceipts:async()=>structuredClone(receipts),
  inspectRustFill:async({fillID})=>structuredClone(rustClaims.get(fillID)),
  getNativeWalletEvidence:async(id)=>wallets.get(id)||null,
  getOriginalItem:id=>items.get(id)||null,
  getOriginalEscrow:id=>escrows.get(id)||null,
  getRustOrder:async()=>structuredClone(order)
 });
 return {...controller,audit:audit.audit,
  get reads(){return reads}};
}
function fullReceipt(){return {phase:"NATIVE_COMMITTED",fillID:2345001,
 operationID:OP,orderID:ORDER,coopSource:"NATIVE_INDUSTRY",
 itemID:ITEM,buyerID:BUYER,ownerID:OWNER,stationID:STATION,
 typeID:TYPE,quantity:100,priceCents:1250,grossCents:125000,
 buyerBeforeCents:300000,buyerAfterCents:175000,
 corpBeforeCents:10000,corpAfterCents:135000,committedAt:1000};}
function partialReceipt({key=KEY1,fillID=2345001,quantity=20,remainingBefore=100,
 buyerItemID=1990000301,at=1000}={}){return {
 phase:"NATIVE_PARTIAL_COMMITTED",claimKey:key,fillID,
 operationID:OP,orderID:ORDER,ownerID:OWNER,stationID:STATION,typeID:TYPE,
 sourceItemID:ITEM,buyerItemID,buyerID:BUYER,
 quantity,unitPriceCents:1250,grossCents:quantity*1250,
 remainingBefore,remainingAfter:remainingBefore-quantity,
 buyerBeforeCents:300000,buyerAfterCents:300000-quantity*1250,
 corpBeforeCents:10000,corpAfterCents:10000+quantity*1250,
 committedAt:at
};}
function setFull(f){
 const row=fullReceipt();f.append(row);f.giveBuyer(ITEM,100);f.removeEscrow();
 f.setRust({state:"filled",vol_remaining:0});
 f.rustClaims.set(row.fillID,{operation_id:OP,order_id:String(ORDER),
  fill_id:String(row.fillID),buyer_id:String(BUYER),state:"filled"});
 f.setBuyerWallet(row);return row;
}
function addPartial(f,row){
 f.append(row);f.giveBuyer(row.buyerItemID,row.quantity);
 f.rustClaims.set(row.fillID,{operation_id:OP,order_id:String(ORDER),
  fill_id:String(row.fillID),buyer_id:String(BUYER),
  claim_key:row.claimKey,state:row.remainingAfter?"open":"filled",
  fill_phase:"finalized",remaining_after:row.remainingAfter});
 f.setBuyerWallet(row);
 f.setRust({vol_remaining:row.remainingAfter,
  state:row.remainingAfter?"open":"filled"});
 if(row.remainingAfter)f.setEscrowRemaining(row.remainingAfter);
 else f.removeEscrow();
}
test("unfilled original order is awaiting buyer without a wallet credit",async()=>{
 const f=fixture(),r=await f.audit({ownerID:OWNER,stationID:STATION,
  operationID:OP,orderID:ORDER});
 assert.equal(r.status,"ORIGINAL_ORDER_AWAITING_BUYER");
 assert.equal(r.revenueCents,0);assert.equal(r.nativeMutation,false);
 assert.deepEqual(r.fillIDs,[]);
});
test("COOP-035 whole-stack receipt and finalized Rust fill prove original ISK and buyer item",async()=>{
 const f=fixture();setFull(f);
 const r=await f.audit({ownerID:OWNER,stationID:STATION,operationID:OP,orderID:ORDER});
 assert.equal(r.status,"ORIGINAL_FULL_SALE_ATTESTED");
 assert.equal(r.revenueCents,125000);assert.equal(r.soldQuantity,100);
 assert.equal(r.remainingQuantity,0);assert.deepEqual(r.fillIDs,[2345001]);
 assert.equal(r.journalAlreadySold,false);
});
test("COOP-047 partial receipt proves exact split and remaining physical escrow",async()=>{
 const f=fixture(),a=partialReceipt();addPartial(f,a);
 const r=await f.audit({ownerID:OWNER,stationID:STATION,operationID:OP,orderID:ORDER});
 assert.equal(r.status,"ORIGINAL_PARTIAL_SALE_ATTESTED");
 assert.equal(r.soldQuantity,20);assert.equal(r.remainingQuantity,80);
 assert.equal(r.revenueCents,25000);
});
test("two independent partial fills conserve remaining stock and credited ISK",async()=>{
 const f=fixture(),a=partialReceipt(),b=partialReceipt({
 key:KEY2,fillID:2345002,quantity:30,remainingBefore:80,
 buyerItemID:1990000302,at:2000});
 addPartial(f,a);addPartial(f,b);
 const r=await f.audit({ownerID:OWNER,stationID:STATION,operationID:OP,orderID:ORDER});
 assert.equal(r.status,"ORIGINAL_PARTIAL_SALE_ATTESTED");
 assert.equal(r.soldQuantity,50);assert.equal(r.remainingQuantity,50);
 assert.equal(r.revenueCents,62500);
});
test("unordered GameStore partial receipt scan is reconstructed by original remainingBefore",async()=>{
 const f=fixture(),a=partialReceipt(),b=partialReceipt({
 key:KEY2,fillID:2345002,quantity:30,remainingBefore:80,
 buyerItemID:1990000302,at:2000});
 addPartial(f,a);addPartial(f,b);
 f.receipts([b,a]);
 const r=await f.audit({ownerID:OWNER,stationID:STATION,operationID:OP,orderID:ORDER});
 assert.equal(r.status,"ORIGINAL_PARTIAL_SALE_ATTESTED");
 assert.equal(r.revenueCents,62500);
 assert.deepEqual(r.fillIDs,[a.fillID,b.fillID]);
});
test("terminal native partial fill requires Rust closed and zero escrow",async()=>{
 const f=fixture(),a=partialReceipt(),b=partialReceipt({
 key:KEY2,fillID:2345002,quantity:80,remainingBefore:80,
 buyerItemID:ITEM,at:2000});
 addPartial(f,a);addPartial(f,b);
 const r=await f.audit({ownerID:OWNER,stationID:STATION,operationID:OP,orderID:ORDER});
 assert.equal(r.status,"ORIGINAL_FULL_SALE_ATTESTED");
 assert.equal(r.revenueCents,125000);assert.equal(r.soldQuantity,100);
});
test("forged original wallet evidence blocks claiming NPC payment",async()=>{
 const f=fixture(),a=setFull(f);f.wallets.get(a.fillID).corporateCreditCents--;
 const r=await f.audit({ownerID:OWNER,stationID:STATION,operationID:OP,orderID:ORDER});
 assert.match(r.reason,/WALLET_RECEIPT_MISMATCH/);
});
test("Rust ACK not finalized does not prove the original payment",async()=>{
 const f=fixture(),a=setFull(f);
 f.rustClaims.get(a.fillID).state="settling";
 const r=await f.audit({ownerID:OWNER,stationID:STATION,operationID:OP,orderID:ORDER});
 assert.match(r.reason,/RUST_FILL_NOT_FINALIZED/);
});
test("different Rust fill ID or buyer identity blocks seller revenue",async()=>{
 const f=fixture(),a=setFull(f);
 f.rustClaims.get(a.fillID).buyer_id=BUYER+1;
 const r=await f.audit({ownerID:OWNER,stationID:STATION,operationID:OP,orderID:ORDER});
 assert.match(r.reason,/RUST_FILL_NOT_FINALIZED/);
});
test("duplicate original fill receipt cannot double-count revenue",async()=>{
 const f=fixture(),a=setFull(f);f.append({...a});
 const r=await f.audit({ownerID:OWNER,stationID:STATION,operationID:OP,orderID:ORDER});
 assert.match(r.reason,/DUPLICATE_NATIVE_FILL|FILL_SEQUENCE_NOT_CONSERVED/);
});
test("missing physical buyer item blocks proof rather than inventing cargo",async()=>{
 const f=fixture();setFull(f);f.items.delete(ITEM);
 const r=await f.audit({ownerID:OWNER,stationID:STATION,operationID:OP,orderID:ORDER});
 assert.match(r.reason,/BUYER_ITEM_NOT_ATTESTED/);
});
test("original seller item stock and Rust order remaining must conserve quantity",async()=>{
 const f=fixture(),a=partialReceipt();addPartial(f,a);
 f.setRust({vol_remaining:81});
 const r=await f.audit({ownerID:OWNER,stationID:STATION,operationID:OP,orderID:ORDER});
 assert.match(r.reason,/RUST_REMAINING_NOT_CONSERVED/);
});
test("missing original escrow on partially sold order blocks settlement proof",async()=>{
 const f=fixture(),a=partialReceipt();addPartial(f,a);f.removeEscrow();
 const r=await f.audit({ownerID:OWNER,stationID:STATION,operationID:OP,orderID:ORDER});
 assert.match(r.reason,/REMAINING_ESCROW_NOT_ATTESTED/);
});
test("mutating original journal during Rust reads invalidates proof",async()=>{
 const f=fixture();setFull(f);f.moveJournalOnRead();
 const r=await f.audit({ownerID:OWNER,stationID:STATION,operationID:OP,orderID:ORDER});
 assert.match(r.reason,/AUTHORITY_CHANGED_DURING_READ/);
});
test("a wrong station, foreign NPC corp or wrong operation is rejected",async()=>{
 const f=fixture();setFull(f);
 for(const args of [
  {ownerID:OWNER+1,stationID:STATION,operationID:OP,orderID:ORDER},
  {ownerID:OWNER,stationID:STATION+1,operationID:OP,orderID:ORDER},
  {ownerID:OWNER,stationID:STATION,operationID:"fake",orderID:ORDER}
 ]){
  const r=await f.audit(args);
  assert.equal(r.status,"BLOCKED");
 }
});
test("auditor cannot issue a Rust claim, mint inventory or credit a wallet",()=>{
 const source=fs.readFileSync(new URL("../integration/coopNpcIndustryOriginalSaleAudit.cjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/\bsetInterval\s*\(|\bsetTimeout\s*\(/);
 assert.doesNotMatch(source,/\.transact\s*\(|\.claimOnce\s*\(|\.finalizeOnce\s*\(/);
});
