import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNpcCorporateSettlement,TABLES}=require("../integration/coopNpcCorporateSettlement.cjs");
const OP="npc-manufacture:0123456789abcdef0123456789abcdef";
const x={operationID:OP,orderID:456,ownerID:1000010,stationID:60000001,
 typeID:215,itemID:1990000200,quantity:100};
const buyer=90000001,escrowLocation=9200000000+x.orderID;
function fixture({buyerBalance=1200,failAt=null,priceCents=1200}={}){
 const keyCorp="corporations\u001f"+x.ownerID,fillKey="order\u001f"+x.orderID;
 const data={
  characters:{[buyer]:{characterID:buyer,balance:buyerBalance,walletJournal:[],marketTransactions:[]}},
  corporationRuntime:{[keyCorp]:{corporationID:x.ownerID,wallet:{divisions:{"1000":{key:1000,balance:100,journal:[],transactions:[]}}}}},
  items:{[x.itemID]:{itemID:x.itemID,ownerID:x.ownerID,locationID:escrowLocation,
   flagID:4,singleton:0,quantity:100,stacksize:100,typeID:x.typeID,customInfo:"coop-industry:v1:970000000000000"}},
  marketEscrow:{[x.orderID]:{orderId:String(x.orderID),escrowType:"sell",isCorp:true,
   ownerId:x.ownerID,stationId:x.stationID,sourceItemID:x.itemID,
   coopOperationID:OP,escrowLocationID:escrowLocation,remainingQuantity:100}},
  npcMarketFills:{}
 };
 let state="open",claimCalls=0,finalizeCalls=0,verifiedBuyer=true;
 const clone=v=>structuredClone(v);
 const gameStore={transact:(tables,fn)=>{
  assert.deepEqual(tables,TABLES);
  const backup=clone(data);
  try{return fn({get:(t,k)=>data[t][k]??null,put:(t,k,v)=>{
   if(failAt===t)throw Error("INJECTED_TX_FAULT:"+t);data[t][k]=v;
  },del:(t,k)=>{if(failAt===t)throw Error("INJECTED_TX_FAULT:"+t);delete data[t][k]},
   scan:()=>[]})}
  catch(e){for(const t of TABLES)data[t]=backup[t];throw e}
 }};
 const order=()=>({source:"coop-npc",state:"settling",operation_id:OP,order_id:String(x.orderID),
   source_item_id:String(x.itemID),owner_id:x.ownerID,station_id:x.stationID,
   type_id:x.typeID,quantity:100,buyer_id:String(buyer),fill_id:"1234567",
   price_cents:priceCents,is_corp:true,bid:false});
 const market={
  claimOnce:async()=>{claimCalls++;state="settling";return order()},
  finalizeOnce:async()=>{finalizeCalls++;state="filled";
   return {state:"filled",order_id:String(x.orderID),buyer_id:String(buyer),
    fill_id:"1234567",vol_remaining:0}},
  inspectClaim:async()=>({state,buyer_id:String(buyer),fill_id:"1234567"})
 };
 const bridge=createNpcCorporateSettlement({gameStore,market,
  verifyBuyerSession:()=>verifiedBuyer,verifyNpcCorporation:()=>true,clock:()=>1761390000000});
 return {data,bridge,market,order,x,fillKey,setBuyerValid:v=>{verifiedBuyer=v},
  get claims(){return claimCalls},get finalizes(){return finalizeCalls}};
}
async function run(cb,options){const a=process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS,b=process.env.EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF;
 process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS="1";process.env.EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF="1";
 try{return await cb(fixture(options))}finally{
  if(a===undefined)delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS=a;
  if(b===undefined)delete process.env.EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF;else process.env.EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF=b;
 }}
test("one full stack purchase conserves physical stock and exactly 1200 ISK",()=>run(async f=>{
 const result=await f.bridge.purchaseOnce({buyerID:buyer,identity:x,maxPriceCents:1200});
 assert.equal(result.status,"PURCHASED");
 assert.equal(f.data.characters[buyer].balance,0);
 assert.equal(f.data.corporationRuntime["corporations\u001f"+x.ownerID].wallet.divisions["1000"].balance,1300);
 assert.equal(f.data.items[x.itemID].ownerID,buyer);
 assert.equal(f.data.items[x.itemID].locationID,x.stationID);
 assert.equal(f.data.marketEscrow[x.orderID],undefined);
 assert.equal(f.data.npcMarketFills[f.fillKey].phase,"NATIVE_COMMITTED");
 assert.equal(f.claims,1);assert.equal(f.finalizes,1);
}));
test("same Rust fill can replay after native commit without second ISK debit",()=>run(async f=>{
 const a=await f.bridge.purchaseOnce({buyerID:buyer,identity:x,maxPriceCents:1200});
 const after=structuredClone(f.data);
 const b=await f.bridge.purchaseOnce({buyerID:buyer,identity:x,maxPriceCents:1200});
 assert.equal(a.status,"PURCHASED");assert.equal(b.status,"PURCHASED");
 assert.deepEqual(f.data,after);
}));
test("native insufficient buyer funds leaves item and both wallets unchanged",()=>run(async f=>{
 const before=structuredClone(f.data);
 await assert.rejects(f.bridge.purchaseOnce({buyerID:buyer,identity:x,maxPriceCents:1200}),/INSUFFICIENT_FUNDS/);
 assert.deepEqual(f.data,before);assert.equal(f.finalizes,0);
},{buyerBalance:0}));
test("injected late receipt failure rolls back both wallets and physical item",()=>run(async f=>{
 const before=structuredClone(f.data);
 await assert.rejects(f.bridge.purchaseOnce({buyerID:buyer,identity:x,maxPriceCents:1200}),/INJECTED_TX_FAULT/);
 assert.deepEqual(f.data,before);assert.equal(f.finalizes,0);
},{failAt:"npcMarketFills"}));
test("zero / unknown buyer session blocks Rust claim",()=>run(async f=>{
 f.setBuyerValid(false);const result=await f.bridge.purchaseOnce({buyerID:buyer,identity:x,maxPriceCents:1200});
 assert.equal(result.error,"NPC_BUYER_SESSION_OR_DOCK_INVALID");assert.equal(f.claims,0);
}));
test("price and identity can only come from canonical Rust claim",()=>run(async f=>{
 f.market.claimOnce=async()=>({...f.order(),price_cents:1200,source_item_id:"999"});
 await assert.rejects(f.bridge.purchaseOnce({buyerID:buyer,identity:x,maxPriceCents:1200}),/CLAIM_IDENTITY_MISMATCH/);
}));
test("partial purchases remain prohibited until native itemID split protocol exists",()=>run(async f=>{
 const bad={...x,quantity:50};
 await assert.rejects(f.bridge.purchaseOnce({buyerID:buyer,identity:bad,maxPriceCents:1200}),/CLAIM_IDENTITY_MISMATCH/);
 assert.equal(f.finalizes,0);
}));
test("bad escrow provenance refuses native wallet and item changes",()=>run(async f=>{
 const before=structuredClone(f.data);f.data.marketEscrow[x.orderID].ownerId=999;
 const snapshot=structuredClone(f.data);
 await assert.rejects(f.bridge.purchaseOnce({buyerID:buyer,identity:x,maxPriceCents:1200}),/ESCROW_MISSING/);
 assert.deepEqual(f.data,snapshot);
}));
test("default OFF blocks all Rust and native mutations",()=>run(async f=>{
 delete process.env.EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF;
 assert.equal((await f.bridge.purchaseOnce({buyerID:buyer,identity:x,maxPriceCents:1200})).error,
  "NPC_CORPORATE_SETTLEMENT_DISABLED");
 assert.equal(f.claims,0);
}));

test("lost Rust finalization acknowledgment recovers without a second debit",()=>run(async f=>{
 const old=f.market.finalizeOnce;let lost=true;
 f.market.finalizeOnce=async x=>{const result=await old(x);if(lost){lost=false;throw Error("LOST_RUST_FINALIZE_ACK")}return result};
 await assert.rejects(f.bridge.purchaseOnce({buyerID:buyer,identity:x,maxPriceCents:1200}),/LOST_RUST_FINALIZE_ACK/);
 const snapshot=structuredClone(f.data);
 const again=await f.bridge.purchaseOnce({buyerID:buyer,identity:x,maxPriceCents:1200});
 assert.equal(again.status,"PURCHASED");assert.deepEqual(f.data,snapshot);
 assert.equal(f.data.characters[buyer].balance,0);assert.equal(f.finalizes,2);
}));
test("native Rust price cannot exceed buyer quoted maximum",()=>run(async f=>{
 const initial=structuredClone(f.data);
 await assert.rejects(f.bridge.purchaseOnce({buyerID:buyer,identity:x,maxPriceCents:1199}),
   /PRICE_EXCEEDS_PLAYER_LIMIT/);
 assert.deepEqual(f.data,initial);assert.equal(f.finalizes,0);
}));
test("different buyer cannot replay Rust-claimed escrow settlement",()=>run(async f=>{
 const initial=structuredClone(f.data);
 await assert.rejects(f.bridge.purchaseOnce({buyerID:buyer+1,identity:x,maxPriceCents:1200}),
   /CLAIM_NOT_CANONICAL/);
 assert.deepEqual(f.data,initial);
}));
