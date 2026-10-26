import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNpcCorporateSettlement}=require("../integration/coopNpcCorporateSettlement.cjs");
const OP="npc-salvage:0123456789abcdef0123456789abcdef";
const ID={operationID:OP,orderID:456,ownerID:10001,stationID:60001,
 typeID:34,itemID:100000,quantity:5};
const BUYER=701,LOC=9200000000+ID.orderID,MANIFEST="30000144-77-1000000";
const secret="untrusted-"+MANIFEST;
function fixture(fn,{fault=null,lostFinalize=false}={}){
 let db={
  characters:{"701":{characterID:BUYER,balance:250,walletJournal:[],marketTransactions:[]}},
  corporationRuntime:{
   ["corporations\u001f"+ID.ownerID]:{corporationID:ID.ownerID,wallet:{divisions:{
    "1000":{key:1000,balance:50,journal:[],transactions:[]}}}},
   coopSalvageMarketOps:{version:1,bySource:{"9001":{
    v:1,phase:"LISTED",operationID:OP,priceCents:1200,at:1000000,
    wreckID:8001,wreckItemID:9001,manifestKey:MANIFEST,
    sourceCargoID:5501,npcCargoID:2001,entityID:801,
    nativeItemID:ID.itemID,corporationID:ID.ownerID,
    stationID:ID.stationID,typeID:ID.typeID,quantity:ID.quantity,
    orderID:ID.orderID
   }}},
   coopSalvageRivalMoves:{version:1,moves:{"9001":{
    v:1,state:"NPC_STOCK_DELIVERED",wreckID:8001,wreckItemID:9001,
    manifestKey:MANIFEST,sourceCargoID:5501,npcCargoID:2001,
    entityID:801,corporationID:ID.ownerID,
    stationID:ID.stationID,nativeItemID:ID.itemID
   }}}
  },
  items:{"100000":{itemID:100000,typeID:34,ownerID:ID.ownerID,
   locationID:LOC,flagID:4,singleton:0,quantity:5,stacksize:5,
   customInfo:"coop-salvage-rival:v1:9001:5501"}},
  marketEscrow:{"456":{orderId:"456",escrowType:"sell",isCorp:true,
   ownerId:ID.ownerID,stationId:ID.stationID,typeId:ID.typeID,
   sourceItemID:ID.itemID,remainingQuantity:ID.quantity,
   escrowLocationID:LOC,coopOperationID:OP,coopSource:"NATIVE_SALVAGE"}},
  npcMarketFills:{}
 };
 // Override op with the *real* deterministic hash of the original native
 // provenance for this fixture. Never manually forge operation identity.
 const crypto=require("node:crypto");
 const realOp="npc-salvage:"+crypto.createHash("sha256")
  .update([MANIFEST,8001,9001,ID.itemID,5501,ID.ownerID,ID.stationID].join(":"))
  .digest("hex").slice(0,32);
 db.marketEscrow["456"].coopOperationID=realOp;
 db.corporationRuntime.coopSalvageMarketOps.bySource["9001"].operationID=realOp;
 let claims=0,finals=0,reads=0,commitCount=0,clientValid=true,lost=lostFinalize;
 const claim=()=>({source:"coop-npc",state:"settling",
  operation_id:realOp,order_id:String(ID.orderID),
  source_item_id:String(ID.itemID),owner_id:ID.ownerID,
  station_id:ID.stationID,type_id:ID.typeID,quantity:ID.quantity,
  buyer_id:String(BUYER),fill_id:"900000000000001",
  price_cents:1200,is_corp:true,bid:false});
 const market={
  claimOnce:async()=>{claims++;return claim()},
  finalizeOnce:async()=>{
   finals++;const ack={state:"filled",order_id:String(ID.orderID),
    buyer_id:String(BUYER),fill_id:"900000000000001",vol_remaining:0};
   if(lost){lost=false;throw Error("RUST_FINALIZE_ACK_LOST")}
   return ack;
  },
  inspectClaim:async()=>{reads++;return {state:"filled",
   buyer_id:String(BUYER),fill_id:"900000000000001"}}
 };
 const gameStore={transact:(tables,work)=>{
  const next=structuredClone(db);
  const tx={get:(t,k)=>next[t]?.[k]??null,
   put:(t,k,v)=>{if(fault===t)throw Error("TX_FAILURE:"+t);next[t][k]=v},
   del:(t,k)=>{if(fault===t)throw Error("TX_FAILURE:"+t);delete next[t][k]},
   scan:t=>Object.entries(next[t]||{}).map(([key,value])=>({key,value}))};
  const result=work(tx);db=next;commitCount++;return result;
 }};
 const build=()=>createNpcCorporateSettlement({
  gameStore,market,verifyBuyerSession:()=>clientValid,
  verifyNpcCorporation:(owner,station)=>owner===ID.ownerID&&station===ID.stationID,
  clock:()=>1761400000000});
 const identity={...ID,operationID:realOp};
 return fn({build,identity,data:()=>structuredClone(db),
  mutate:cb=>cb(db),counts:()=>({claims,finals,reads,commits:commitCount}),
  buyerValid:v=>clientValid=v,market,claim});
}
async function run(fn,config){
 const flags=["EVEJS_COOP_NATIVE_ATOMIC_ROWS",
  "EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF",
  "EVEJS_COOP_SALVAGE_NATIVE_MARKET"];
 const old=flags.map(k=>process.env[k]);for(const k of flags)process.env[k]="1";
 try{return await fixture(fn,config)}finally{
  flags.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i]});
 }
}
const buy=f=>f.build().purchaseOnce({buyerID:BUYER,identity:f.identity,maxPriceCents:1200});
test("source backed original NPC salvage buyer pays actual ISK and corp receives one full-stack credit",()=>run(async f=>{
 const result=await buy(f),db=f.data();
 assert.equal(result.status,"PURCHASED");
 assert.equal(db.characters["701"].balance,190);
 assert.equal(db.corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance,110);
 assert.equal(db.items["100000"].ownerID,BUYER);
 assert.equal(db.items["100000"].locationID,60001);
 assert.equal(db.marketEscrow["456"],undefined);
 assert.equal(db.npcMarketFills["order\u001f456"].phase,"NATIVE_COMMITTED");
 assert.equal(db.npcMarketFills["order\u001f456"].coopSource,"NATIVE_SALVAGE");
 assert.equal(db.corporationRuntime.coopSalvageMarketOps.bySource["9001"].phase,"SOLD");
 assert.equal(f.counts().commits,2);
 assert.equal(f.counts().finals,1);
}));
test("reconnect and repeat native Rust claim never credits corp or debits buyer again",()=>run(async f=>{
 assert.equal((await buy(f)).status,"PURCHASED");
 const snapshot=f.data();
 assert.equal((await buy(f)).status,"PURCHASED");
 assert.deepEqual(f.data(),snapshot);
 assert.equal(f.counts().commits,4);
}));
test("native buyer insufficient ISK leaves original escrow and warehouse wallet untouched",()=>run(async f=>{
 f.mutate(db=>db.characters["701"].balance=40);
 const before=f.data();
 await assert.rejects(buy(f),/INSUFFICIENT_FUNDS/);
 assert.deepEqual(f.data(),before);
 assert.equal(f.counts().finals,0);
}));
test("missing salvage origin journal forbids sale despite a matching Rust claim",()=>run(async f=>{
 f.mutate(db=>delete db.corporationRuntime.coopSalvageRivalMoves.moves["9001"]);
 const snapshot=f.data();
 await assert.rejects(buy(f),/ORIGINAL_RECEIPT_CONFLICT/);
 assert.deepEqual(f.data(),snapshot);
 assert.equal(f.counts().finals,0);
}));
test("forged salvage marker forbids corporate wallet credit",()=>run(async f=>{
 f.mutate(db=>db.items["100000"].customInfo="coop-industry:v1:8001");
 await assert.rejects(buy(f),/SOURCE_MARKER_CONFLICT/);
 assert.equal(f.data().characters["701"].balance,250);
}));
test("forged market escrow source type cannot buy original salvage",()=>run(async f=>{
 f.mutate(db=>db.marketEscrow["456"].coopSource="NATIVE_INDUSTRY");
 await assert.rejects(buy(f),/SOURCE_MARKER_CONFLICT/);
 assert.equal(f.data().corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance,50);
}));
test("duplicated original salvage marker after listing cannot earn a second wallet credit",()=>run(async f=>{
 f.mutate(db=>db.items["100002"]={
  ...db.items["100000"],itemID:100002,locationID:60001});
 const before=f.data();
 await assert.rejects(buy(f),/DUPLICATE_SOURCE_ITEM/);
 assert.deepEqual(f.data(),before);
 assert.equal(f.counts().finals,0);
}));
test("source item moved or double-claimed cannot be charged twice",()=>run(async f=>{
 f.mutate(db=>db.items["100000"].locationID=60001);
 await assert.rejects(buy(f),/OUTPUT_CUSTODY_INVALID/);
 assert.equal(f.counts().finals,0);
}));
test("tampered salvage source journal identity cannot claim Rust fill",()=>run(async f=>{
 f.mutate(db=>db.corporationRuntime.coopSalvageMarketOps.bySource["9001"].orderID=100);
 await assert.rejects(buy(f),/ORIGINAL_OPERATION_CONFLICT/);
 assert.equal(f.data().npcMarketFills["order\u001f456"],undefined);
}));
test("failure at final ledger receipt rolls back native buyer/corp/item together",()=>run(async f=>{
 const before=f.data();
 await assert.rejects(buy(f),/TX_FAILURE:npcMarketFills/);
 assert.deepEqual(f.data(),before);
 assert.equal(f.counts().finals,0);
},{fault:"npcMarketFills"}));
test("lost Rust finalize ACK preserves committed native wallets and replays without double debit",()=>run(async f=>{
 await assert.rejects(buy(f),/RUST_FINALIZE_ACK_LOST/);
 const after=f.data();
 assert.equal(after.corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance,110);
 assert.equal((await buy(f)).status,"PURCHASED");
 const resolved=f.data();
 assert.deepEqual(resolved.characters,after.characters);
 assert.deepEqual(resolved.items,after.items);
 assert.deepEqual(resolved.npcMarketFills,after.npcMarketFills);
 assert.equal(resolved.corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance,110);
 assert.equal(resolved.corporationRuntime.coopSalvageMarketOps.bySource["9001"].phase,"SOLD");
},{lostFinalize:true}));
test("salvage settlement disabled independently of manufacturing settlement",()=>run(async f=>{
 delete process.env.EVEJS_COOP_SALVAGE_NATIVE_MARKET;
 const result=await buy(f);
 assert.equal(result.error,"SALVAGE_SETTLEMENT_DISABLED");
 assert.equal(f.counts().claims,0);
 assert.equal(f.counts().finals,0);
 assert.equal(f.counts().commits,0);
}));
test("unverified buyer session cannot acquire native Rust claim",()=>run(async f=>{
 f.buyerValid(false);
 const result=await buy(f);
 assert.equal(result.error,"NPC_BUYER_SESSION_OR_DOCK_INVALID");
 assert.equal(f.counts().claims,0);
}));


test("noncanonical fractional-cent player wallet never funds native NPC goods",()=>run(async f=>{
 f.mutate(db=>db.characters["701"].balance=250.004);
 const before=f.data();
 await assert.rejects(buy(f),/NPC_BUYER_INSUFFICIENT_FUNDS/);
 assert.deepEqual(f.data(),before);
 assert.equal(f.counts().finals,0);
}));
test("noncanonical fractional-cent NPC corporation balance cannot receive rounded ISK",()=>run(async f=>{
 f.mutate(db=>db.corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance=50.004);
 const before=f.data();
 await assert.rejects(buy(f),/NPC_CORPORATE_WALLET_INVALID/);
 assert.deepEqual(f.data(),before);
 assert.equal(f.counts().finals,0);
}));
test("legitimate two-decimal native balances retain every cent after salvage sale",()=>run(async f=>{
 f.mutate(db=>{
  db.characters["701"].balance=250.05;
  db.corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance=50.05;
 });
 const result=await buy(f),db=f.data();
 assert.equal(result.status,"PURCHASED");
 assert.equal(db.characters["701"].balance,190.05);
 assert.equal(db.corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance,110.05);
 assert.equal(db.npcMarketFills["order\u001f456"].buyerBeforeCents,25005);
 assert.equal(db.npcMarketFills["order\u001f456"].corpBeforeCents,5005);
}));
