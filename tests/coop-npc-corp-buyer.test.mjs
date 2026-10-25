import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {TABLES,createNpcCorporateBuyer}=require("../integration/coopNpcCorporateBuyerAtomic.cjs");
const BUYER=1000010,SELLER=90000001,STATION=60000001,TYPE=215,ORDER=456,ITEM=1990000200;
const FILL=930000000000001,KEY="npc-corpbuy:0123456789abcdef0123456789abcdef";
const CKEY="corporations\u001f"+BUYER,RECEIPT="corp-buy\u001f"+FILL;
const request={claimKey:KEY,buyerCorpID:BUYER,sellerID:SELLER,
 stationID:STATION,typeID:TYPE,orderID:ORDER,quantity:20,
 maxUnitPriceCents:125,minReserveCents:10000};
function fixture({buyerISK=1000,failAt=null}={}){
 const data={
  corporationRuntime:{[CKEY]:{corporationID:BUYER,wallet:{divisions:{"1000":{
   balance:buyerISK,journal:[],transactions:[]}}}}},
  characters:{[SELLER]:{characterID:SELLER,balance:100,
   walletJournal:[],marketTransactions:[]}},
  items:{[ITEM]:{itemID:ITEM,typeID:TYPE,ownerID:SELLER,
   locationID:9200000000+ORDER,flagID:4,singleton:0,categoryID:8,
   quantity:20,stacksize:20}},
  marketEscrow:{[ORDER]:{orderId:String(ORDER),ownerId:SELLER,isCorp:false,
   escrowType:"sell",typeId:TYPE,stationId:STATION,
   escrowLocationID:9200000000+ORDER,remainingQuantity:20}},
  npcMarketFills:{}
 };
 const copy=v=>structuredClone(v);
 const gameStore={transact:(tables,mutation)=>{
  assert.deepEqual(tables,TABLES);
  const backup=copy(data);
  try{return mutation({
   get:(t,k)=>data[t]?.[k]??null,
   scan:t=>Object.entries(data[t]).map(([key,value])=>({key,value})),
   put:(t,k,v)=>{if(failAt===t)throw Error("INJECTED_ATOMIC_FAULT:"+t);data[t][k]=v},
   del:(t,k)=>{if(failAt===t)throw Error("INJECTED_ATOMIC_FAULT:"+t);delete data[t][k]}
  })}catch(e){for(const t of TABLES)data[t]=backup[t];throw e}
 }};
 let quoteMode="valid",taxRate=0.08;
 let state="settling",phase="claimed",claims=0,finalizations=0,
  loseFinal=false,buyerValid=true,sellerValid=true,releaseClaim=null;
 const claim=()=>({source:"player",state,fill_phase:phase,is_corp:false,bid:false,
  claim_key:KEY,fill_id:String(FILL),order_id:String(ORDER),
  owner_id:String(SELLER),buyer_corp_id:String(BUYER),
  station_id:STATION,type_id:TYPE,quantity:20,price_cents:125,vol_remaining:state==="filled"?0:20});
 const market={
  claimOnce:async()=>{claims++;if(releaseClaim)await releaseClaim;return claim()},
  finalizeOnce:async()=>{finalizations++;state="filled";phase="finalized";
   if(loseFinal){loseFinal=false;throw Error("LOST_RUST_FINALIZE_ACK")}
   return claim()},
  inspectClaim:async()=>claim()
 };
 const create=()=>createNpcCorporateBuyer({gameStore,market,
  verifyBuyerCorporation:()=>buyerValid,
  verifyPlayerSeller:()=>sellerValid,
  quoteSellerTax:({sellerID,stationID,grossCents})=>({
   sellerID,stationID,grossCents,
   taxCents:quoteMode==="malformed"?-1:Math.round(grossCents*taxRate),
   policy:quoteMode==="unauthorized"?"FAKE_MARKET":"EVEJS_NATIVE_MARKET_RULES"}),
  clock:()=>1761390000000});
 const bridge=create();
 return {data,bridge,market,request,claim,create,
  get claims(){return claims},get finalizes(){return finalizations},
  fault:t=>{failAt=t},loseAck:()=>{loseFinal=true},
  setBuyer:v=>{buyerValid=v},setSeller:v=>{sellerValid=v},
  setTaxMode:v=>{quoteMode=v},setTaxRate:v=>{taxRate=v},
  setMarketDone:()=>{state="filled";phase="finalized"},
  async stallClaim(){let unlock;releaseClaim=new Promise(r=>{unlock=r});return unlock}
 };
}
async function run(callback,options){
 const keys=["EVEJS_COOP_NATIVE_ATOMIC_ROWS","EVEJS_COOP_NPC_BUY_PLAYER_ASK"],
  originals=keys.map(k=>process.env[k]);
 for(const k of keys)process.env[k]="1";
 try{return await callback(fixture(options))}
 finally{keys.forEach((k,i)=>{if(originals[i]===undefined)delete process.env[k];
  else process.env[k]=originals[i]})}
}
const buy=f=>f.bridge.purchaseOnce(f.request);
test("native corporation buys real player escrow: goods and ISK conserved",()=>run(async f=>{
 const result=await buy(f);
 assert.equal(result.status,"NPC_PURCHASED_PLAYER_GOODS");
 assert.equal(result.itemID,ITEM);assert.equal(result.quantity,20);
 assert.equal(f.data.corporationRuntime[CKEY].wallet.divisions["1000"].balance,975);
 assert.equal(f.data.characters[SELLER].balance,123);
 assert.equal(f.data.items[ITEM].ownerID,BUYER);
 assert.equal(f.data.items[ITEM].locationID,STATION);
 assert.equal(f.data.marketEscrow[ORDER],undefined);
 assert.equal(f.data.npcMarketFills[RECEIPT].phase,"NATIVE_NPC_BUY_COMMITTED");
 assert.equal(f.data.characters[SELLER].walletJournal.length,2);
 assert.equal(f.data.characters[SELLER].walletJournal[0].entryTypeID,54);
 assert.equal(f.data.npcMarketFills[RECEIPT].taxCents,200);
 assert.equal(f.data.npcMarketFills[RECEIPT].netCents,2300);
 assert.equal(f.data.corporationRuntime[CKEY].wallet.divisions["1000"].journal.length,1);
 assert.equal(f.claims,1);assert.equal(f.finalizes,1);
}));
test("completed Rust claim can replay without a second debit",()=>run(async f=>{
 await buy(f);const before=structuredClone(f.data);
 const again=await f.create().purchaseOnce(f.request);
 assert.equal(again.status,"NPC_PURCHASED_PLAYER_GOODS");
 assert.deepEqual(f.data,before);assert.equal(f.finalizes,2);
}));
test("lost Rust finalization acknowledgement is recoverable after restart",()=>run(async f=>{
 f.loseAck();
 await assert.rejects(buy(f),/LOST_RUST_FINALIZE_ACK/);
 const after=structuredClone(f.data);
 assert.equal((await f.create().purchaseOnce(f.request)).status,"NPC_PURCHASED_PLAYER_GOODS");
 assert.deepEqual(f.data,after);
}));
test("corporation must retain exact cash reserve",()=>run(async f=>{
 const before=structuredClone(f.data);
 await assert.rejects(f.bridge.purchaseOnce({...f.request,minReserveCents:98000}),
  /ISK_RESERVE_OR_FUNDS_EXCEEDED/);
 assert.deepEqual(f.data,before);
}));
test("corporation with zero ISK cannot mint purchase cash",()=>run(async f=>{
 const before=structuredClone(f.data);
 await assert.rejects(buy(f),/ISK_RESERVE_OR_FUNDS_EXCEEDED/);
 assert.deepEqual(f.data,before);
},{buyerISK:0}));
test("sale with multiple separate escrow stacks fails closed",()=>run(async f=>{
 f.data.items[1990000201]={...f.data.items[ITEM],itemID:1990000201,quantity:1,stacksize:1};
 const before=structuredClone(f.data);
 await assert.rejects(buy(f),/SINGLE_ESCROW_STACK_REQUIRED/);
 assert.deepEqual(f.data,before);
}));
test("foreign owner or wrong escrow item quantity prevents transfer",()=>run(async f=>{
 f.data.items[ITEM].ownerID=SELLER+1;
 await assert.rejects(buy(f),/SINGLE_ESCROW_STACK_REQUIRED/);
 assert.equal(f.data.corporationRuntime[CKEY].wallet.divisions["1000"].balance,1000);
}));
test("changed Rust claim seller identity cannot redirect cash",()=>run(async f=>{
 f.market.claimOnce=async()=>({...f.claim(),owner_id:String(SELLER+5)});
 const before=structuredClone(f.data);
 await assert.rejects(buy(f),/RUST_IDENTITY_CHANGED/);
 assert.deepEqual(f.data,before);
}));
test("fake Rust fill price greater than native policy max is blocked",()=>run(async f=>{
 f.market.claimOnce=async()=>({...f.claim(),price_cents:50000});
 await assert.rejects(buy(f),/RUST_IDENTITY_CHANGED/);
}));
test("injected last-table write failure restores all native rows",()=>run(async f=>{
 const before=structuredClone(f.data);f.fault("npcMarketFills");
 await assert.rejects(buy(f),/INJECTED_ATOMIC_FAULT/);
 assert.deepEqual(f.data,before);
}));
test("Rust finalized without matching GameStore receipt is quarantined",()=>run(async f=>{
 f.setMarketDone();
 const before=structuredClone(f.data);
 await assert.rejects(buy(f),/FINALIZED_WITHOUT_GAMESTORE_RECEIPT/);
 assert.deepEqual(f.data,before);
}));
test("unverified player or NPC corporation cannot claim or spend",()=>run(async f=>{
 f.setBuyer(false);
 assert.equal((await buy(f)).reason,"NPC_CORP_BUY_AUTHORITY_UNVERIFIED");
 f.setBuyer(true);f.setSeller(false);
 assert.equal((await buy(f)).reason,"NPC_CORP_BUY_AUTHORITY_UNVERIFIED");
 assert.equal(f.claims,0);
}));
test("default OFF prevents any market claim and native wallet changes",()=>run(async f=>{
 delete process.env.EVEJS_COOP_NPC_BUY_PLAYER_ASK;
 assert.equal((await buy(f)).reason,"NPC_CORP_BUY_DISABLED");
 assert.equal(f.claims,0);
}));
test("same order cannot be purchased twice concurrently",()=>run(async f=>{
 const unlock=await f.stallClaim(),pending=buy(f);
 // yield microtask so claim is in-flight
 await Promise.resolve();
 assert.equal((await buy(f)).reason,"NPC_CORP_BUY_ORDER_BUSY");
 unlock();assert.equal((await pending).status,"NPC_PURCHASED_PLAYER_GOODS");
}));
test("a committed native receipt remains idempotent if later ammo was consumed",()=>run(async f=>{
 await buy(f);
 delete f.data.items[ITEM];
 const balances={buyer:f.data.corporationRuntime[CKEY].wallet.divisions["1000"].balance,
  seller:f.data.characters[SELLER].balance};
 const again=await f.create().purchaseOnce(f.request);
 assert.equal(again.status,"NPC_PURCHASED_PLAYER_GOODS");
 assert.equal(f.data.corporationRuntime[CKEY].wallet.divisions["1000"].balance,balances.buyer);
 assert.equal(f.data.characters[SELLER].balance,balances.seller);
}));
test("malformed or forged seller tax aborts all five native tables",()=>run(async f=>{
 for(const taxMode of ["malformed","unauthorized"]){
  const before=structuredClone(f.data);f.setTaxMode(taxMode);
  await assert.rejects(buy(f),/NATIVE_SELLER_TAX_UNVERIFIED/);
  assert.deepEqual(f.data,before);
 }
}));
test("legitimate zero tax keeps the sale paid without a fake tax journal",()=>run(async f=>{
 f.setTaxRate(0);
 const result=await buy(f);
 assert.equal(result.status,"NPC_PURCHASED_PLAYER_GOODS");
 assert.equal(result.taxCents,0);assert.equal(result.netCents,2500);
 assert.equal(f.data.characters[SELLER].balance,125);
 assert.equal(f.data.characters[SELLER].walletJournal.length,1);
 assert.equal(f.data.npcMarketFills[RECEIPT].taxCents,0);
}));
test("lost native finalize ACK never charges seller tax twice",()=>run(async f=>{
 f.loseAck();
 await assert.rejects(buy(f),/LOST_RUST_FINALIZE_ACK/);
 assert.equal(f.data.characters[SELLER].walletJournal.length,2);
 assert.equal((await f.create().purchaseOnce(f.request)).status,
  "NPC_PURCHASED_PLAYER_GOODS");
 assert.equal(f.data.characters[SELLER].balance,123);
 assert.equal(f.data.characters[SELLER].walletJournal.length,2);
 assert.equal(f.data.npcMarketFills[RECEIPT].taxCents,200);
}));
